"""MS-44: request-local monotonic numeric spans, no input/output retention."""
from contextvars import ContextVar
from contextlib import contextmanager
from time import perf_counter
import math

current: ContextVar[dict | None] = ContextVar('rag_timing', default=None)
tokens: ContextVar[dict | None] = ContextVar('rag_token_counts', default=None)
metrics: ContextVar[dict | None] = ContextVar('rag_model_metrics', default=None)
work: ContextVar[dict | None] = ContextVar('rag_model_work', default=None)
STAGES = {'queue', 'verify', 'inference', 'schema', 'load', 'prompt', 'generation', 'deterministic'}


def model_metric(key, value):
    """MS54-TC04/08: last model request sizes/budgets, without prompt retention."""
    values = metrics.get()
    if (values is not None and key in {'aggregate_model_bytes', 'aggregate_output_reserved', 'system_bytes', 'serialized_model_bytes', 'context_tokens', 'output_budget', 'template_headroom', 'evidence_packed', 'evidence_supported'}
            and type(value) is int and 0 <= value <= 10_000_000):
        values[key] = value


def reserve_model_work(serialized_bytes, output_tokens):
    """MS65: actual transport serialization, checked BEFORE inference starts."""
    state = work.get()
    if state is None:
        return True
    if (state['calls'] + 1 > state['max_calls']
            or state['bytes'] + serialized_bytes > state['max_bytes']
            or state['output'] + output_tokens > state['max_output']):
        return False
    state['calls'] += 1
    state['bytes'] += serialized_bytes
    state['output'] += output_tokens
    model_metric('aggregate_model_bytes', state['bytes'])
    model_metric('aggregate_output_reserved', state['output'])
    return True


def token_count(key, value):
    counts = tokens.get()
    if counts is not None and key in {'input', 'output'} and type(value) is int and 0 <= value <= 10_000_000:
        counts[key] = counts.get(key, 0) + value


def add(stage, milliseconds):
    spans = current.get()
    if (spans is not None and stage in STAGES and type(milliseconds) in (int, float)
            and math.isfinite(milliseconds) and milliseconds >= 0):
        spans[stage] = spans.get(stage, 0) + milliseconds


@contextmanager
def measure(stage):
    start = perf_counter()
    try:
        yield
    finally:
        add(stage, (perf_counter() - start) * 1000)


def header(spans, start):
    total = (perf_counter() - start) * 1000
    # Ollama load/prompt/generation are nested within inference, never added twice.
    exclusive = sum(spans.get(key, 0) for key in ('queue', 'verify', 'inference', 'schema', 'deterministic'))
    return ', '.join(f'{key};dur={value:.3f}' for key, value in
                     {**spans, 'residual': max(0, total - exclusive), 'total': total}.items())
