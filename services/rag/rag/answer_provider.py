"""PRD-F26 / SDD-C21 / QAD-TC44: explicit answering transport, no fallback."""
import copy
import os

from fastapi import HTTPException


DEEPINFRA_ORIGIN = 'https://api.deepinfra.com'
DEEPINFRA_MODEL = 'Qwen/Qwen3-32B'
# PRD-F26 / QAD-TC46: maintainer approved benchmark and conditional adoption.
DEEPINFRA_MODELS = {DEEPINFRA_MODEL, 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen/Qwen3.6-35B-A3B'}
# Maintainer-authorized $1 benchmark. Defaults remain the original Qwen model.
BENCHMARK_MODELS = {'google/gemini-3.1-flash-lite', 'google/gemini-3.5-flash', 'deepseek-ai/DeepSeek-V4-Flash'}
FAST_RELEASE_MODEL = 'google/gemini-3.1-flash-lite'


def released_model(model):
    # Explicit deployment action after maintainer approval; never a fallback.
    return model == FAST_RELEASE_MODEL and os.environ.get('RAG_FAST_MODEL_RELEASE') == 'true'


def allowed_model(model):
    return model in DEEPINFRA_MODELS or released_model(model) or (model in BENCHMARK_MODELS
        and os.environ.get('RAG_BENCHMARK_ENABLED') == 'true' and not os.environ.get('K_SERVICE'))


def provider():
    value = os.environ.get('RAG_MODEL_PROVIDER', 'ollama')
    if value not in ('ollama', 'deepinfra'):
        raise HTTPException(503, detail='INVALID_MODEL_PROVIDER')
    return value


def answer_model():
    model = os.environ.get('RAG_ANSWER_MODEL', DEEPINFRA_MODEL if provider() == 'deepinfra' else 'qwen3:4b')
    if provider() == 'deepinfra' and not allowed_model(model):
        raise HTTPException(503, detail='MODEL_REVISION_MISMATCH')
    return model


def document_model():
    model = os.environ.get('RAG_DOCUMENT_ANSWER_MODEL', answer_model())
    if provider() == 'deepinfra' and not allowed_model(model):
        raise HTTPException(503, detail='MODEL_REVISION_MISMATCH')
    return model


def document_limits():
    model = document_model()
    byte_tokens = model == 'Qwen/Qwen3.6-35B-A3B' or model in BENCHMARK_MODELS
    return {'context_tokens': 262144 if byte_tokens else 131072 if model == 'Qwen/Qwen3-235B-A22B-Instruct-2507' else 32768,
            'model_request_bytes': 240000, 'byte_tokens': byte_tokens}


def deepinfra_headers():
    key = os.environ.get('DEEPINFRA_API_KEY', '')
    if not key.strip() or any(char.isspace() for char in key):
        raise HTTPException(503, detail='MISSING_MODEL_CREDENTIAL')
    return {'Authorization': 'Bearer ' + key}


def deepinfra_payload(payload, schema_name):
    # OpenAI strict schemas require every object property to be required.
    # Nullable fields stay nullable; local Pydantic validation remains final.
    schema = copy.deepcopy(payload['format'])

    def strict_objects(node):
        if isinstance(node, dict):
            node.pop('default', None)
            if node.get('type') == 'object':
                node['additionalProperties'] = False
                node['required'] = list(node.get('properties', {}))
            for value in node.values():
                strict_objects(value)
        elif isinstance(node, list):
            for value in node:
                strict_objects(value)

    strict_objects(schema)
    messages = copy.deepcopy(payload['messages'])
    # Qwen3 also supports the explicit prompt switch used in the maintainer's
    # successful API probe. Keep it in trusted instructions, outside evidence.
    if payload['model'] == DEEPINFRA_MODEL and messages and messages[0].get('role') == 'system':
        messages[0]['content'] += '\n/no_think'
    tier = os.environ.get('RAG_DEEPINFRA_SERVICE_TIER', 'standard')
    if tier not in ('standard', 'priority'):
        raise HTTPException(503, detail='INVALID_SERVICE_TIER')
    return {
        'model': payload['model'], 'stream': False, 'reasoning_effort': 'none',
        **({'service_tier': tier} if tier == 'priority' and payload['model'] not in BENCHMARK_MODELS else {}),
        'max_tokens': payload['options']['num_predict'], 'temperature': 0,
        'messages': messages,
        'response_format': {'type': 'json_schema', 'json_schema': {
            'name': schema_name, 'strict': True, 'schema': schema}},
    }


def normalize_deepinfra(response, model):
    try:
        if not isinstance(response, dict) or response.get('model') != model:
            raise ValueError()
        choices = response['choices']
        if not isinstance(choices, list) or len(choices) != 1:
            raise ValueError()
        choice = choices[0]
        message = choice['message']
        content = message.get('content')
        if choice.get('finish_reason') != 'stop' or message.get('refusal') or message.get('tool_calls'):
            raise ValueError()
        if not isinstance(content, str) or not content.strip():
            raise ValueError()
        usage = response.get('usage', {})
        if not isinstance(usage, dict):
            raise ValueError()
        counts = [usage.get('prompt_tokens'), usage.get('completion_tokens')]
        if any(value is not None and (type(value) is not int or value < 0) for value in counts):
            raise ValueError()
        return {'message': {'content': content}, 'done_reason': 'stop',
                'prompt_eval_count': counts[0], 'eval_count': counts[1]}
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(503, detail='INVALID_MODEL_OUTPUT') from None
