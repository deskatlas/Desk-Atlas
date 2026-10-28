"""PRD-F27 / SDD-C23,C24: durable preparation runs outside chat requests."""
import asyncio
import json
import threading
import time
import os

import httpx
from fastapi import HTTPException

from rag.document_support import wire
from .support_runtime import prepare_generation, compiler_fingerprint

SAFE_FAILURES = {'PREPARATION_CAPACITY', 'PREPARATION_INVALID', 'PREPARATION_INCOMPLETE',
                 'PREPARATION_UNVERIFIED', 'PREPARATION_MODEL_FAILURE', 'MANIFEST_INVALID'}


def process_support_claim(gateway, claim):
    job = claim['job']
    lease = {key: job[key] for key in ('lease_token', 'generation')}
    stopped, lost = threading.Event(), threading.Event()
    def heartbeat():
        while not stopped.wait(25):
            try:
                gateway.call(job['id'] + '/heartbeat', lease)
            except ValueError:
                lost.set()
                return
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    metrics = {}
    try:
        artifact, stats = asyncio.run(prepare_generation(claim['sources'], metrics=metrics))
        if lost.is_set() or stats['compiler_fingerprint'] != job['compiler_fingerprint']:
            raise ValueError('LEASE_LOST')
        completion = {**lease, 'artifact_text': wire(artifact.model_dump()).decode(),
                      **{key: stats[key] for key in ('model', 'calls', 'bytes', 'input_tokens', 'output_tokens', 'compiler_fingerprint')}}
        gateway.call(job['id'] + '/complete', completion)
        return 'READY'
    except (HTTPException, httpx.HTTPError, ValueError) as error:
        print(json.dumps({'event':'kb_support_failure', 'error_type':type(error).__name__,
            'provider_status':error.response.status_code if isinstance(error,httpx.HTTPStatusError) else None,
            'calls':metrics.get('calls',0), 'input_tokens':metrics.get('input_tokens',0),
            'output_tokens':metrics.get('output_tokens',0),
            'validation_types':[item['type'] for item in error.errors(include_input=False,include_context=False)]
                if hasattr(error,'errors') else []}), flush=True)
        if lost.is_set():
            return 'LEASE_LOST'
        reason = error.detail if isinstance(error, HTTPException) and isinstance(error.detail, str) else 'PREPARATION_MODEL_FAILURE'
        reason = reason if reason in SAFE_FAILURES else 'PREPARATION_MODEL_FAILURE'
        gateway.call(job['id'] + '/fail', {**lease, 'error_code': reason})
        return reason
    finally:
        stopped.set()
        thread.join(timeout=50)


def run_support_lane(gateway, stop=None):
    stop = stop or threading.Event()
    delay = 1
    fingerprint = compiler_fingerprint()
    while not stop.is_set():
        try:
            claim = gateway.call('claim', {'compiler_fingerprint': fingerprint})
            if not claim:
                stop.wait(delay)
                delay = min(delay * 2, 10)
                continue
            delay = 1
            started = time.monotonic()
            outcome = process_support_claim(gateway, claim)
            print(json.dumps({'event': 'kb_support_preparation', 'outcome': outcome,
                              'duration_ms': round((time.monotonic() - started) * 1000)}), flush=True)
            if os.environ.get('KB_SUPPORT_ONCE') == 'true':
                return
        except ValueError:
            stop.wait(5)
