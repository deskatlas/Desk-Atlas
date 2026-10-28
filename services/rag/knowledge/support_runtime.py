"""PRD-F27 / SDD-C23: bounded offline compilation with approved transport."""
import hashlib
import json
import os
from pathlib import Path
import sys
import asyncio

import httpx
from fastapi import HTTPException

from rag.answer_provider import (deepinfra_headers, deepinfra_payload,
                                 document_limits, document_model, normalize_deepinfra, provider)
from rag.document_support import wire
from rag.hosted_tokenizer import token_count
from rag.prepared_support import compile_support

PREPARATION_OUTPUT_TOKENS = 4800
ROOT = Path(__file__).resolve().parents[1]
LOADED_COMPILER_SOURCE = hashlib.sha256(b''.join((ROOT / name).read_bytes() for name in (
    'knowledge/support_runtime.py', 'rag/prepared_support.py', 'rag/document_support.py', 'rag/source_transport.py',
    'rag/answer_provider.py', 'rag/hosted_tokenizer.py'))).hexdigest()


def compiler_fingerprint():
    return hashlib.sha256(wire({'source': LOADED_COMPILER_SOURCE,
                               'model': document_model(), 'format': preparation_format(),
                               'contract': 'ragfix-prepared-v1'})).hexdigest()


def preparation_format():
    value = os.environ.get('RAG_PREPARATION_FORMAT', 'json_schema')
    if value not in ('json_schema', 'json_object', 'bounded_schema'):
        raise HTTPException(503, detail='INVALID_PREPARATION_FORMAT')
    return value


def preparation_payload(model, prompt, data, schema, output_budget):
    payload = deepinfra_payload({'model': model, 'format': schema.model_json_schema(),
        'messages': [{'role': 'system', 'content': prompt},
                     {'role': 'user', 'content': wire(data).decode()}],
        'options': {'num_predict': output_budget}}, schema.__name__)
    mode = preparation_format()
    if mode == 'json_object' or (mode == 'bounded_schema' and data.get('stage') not in ('ASSIGNMENTS', 'DEPENDENCIES')):
        payload['response_format'] = {'type': 'json_object'}
        payload['messages'][0]['content'] += '\nReturn a JSON object matching this exact schema. Local strict validation rejects extra/missing fields or invalid addresses:\n' + wire(schema.model_json_schema()).decode()
    return payload


def decode_preparation(content, schema):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('DUPLICATE_PREPARATION_FIELD')
            result[key] = value
        return result
    return schema.model_validate(json.loads(content, object_pairs_hook=unique))


async def prepare_generation(sources, metrics=None, audit=None):
    if provider() != 'deepinfra':
        raise HTTPException(503, detail='INVALID_MODEL_PROVIDER')
    model = document_model()
    limits = document_limits()
    stats = metrics if metrics is not None else {}
    stats.update({'calls': 0, 'bytes': 0, 'input_tokens': 0, 'output_tokens': 0, 'usage_reports': 0})
    stats['compiler_fingerprint'] = compiler_fingerprint()
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=5),
                                 follow_redirects=False, trust_env=False) as client:
        async def generate(prompt, data, schema):
            output_budget = 640 if data.get('stage') == 'ASSIGNMENTS' else 1024 if data.get('stage') == 'DEPENDENCIES' else 1200 if 'trusted_closures' in data else PREPARATION_OUTPUT_TOKENS
            payload = preparation_payload(model, prompt, data, schema, output_budget)
            serialized = wire(payload)
            count = len(serialized) if limits['byte_tokens'] else token_count(serialized.decode())
            stats['calls'] += 1
            stats['bytes'] += len(serialized)
            if (stats['calls'] > 47 or stats['bytes'] > 2000000
                    or len(serialized) > limits['model_request_bytes']
                    or count + output_budget + 512 > limits['context_tokens']):
                raise HTTPException(400, detail='PREPARATION_CAPACITY')
            response = await client.post('https://api.deepinfra.com/v1/openai/chat/completions',
                content=serialized, headers={**deepinfra_headers(), 'Content-Type': 'application/json'})
            response.raise_for_status()
            body = response.json()
            usage = body.get('usage', {})
            if isinstance(usage, dict):
                for key, source in [('input_tokens','prompt_tokens'),('output_tokens','completion_tokens')]:
                    if type(usage.get(source)) is int and usage[source] >= 0:
                        stats[key] += usage[source]
                stats['usage_reports'] += 1
            if body.get('choices', [{}])[0].get('finish_reason') == 'length':
                content = body.get('choices', [{}])[0].get('message', {}).get('content', '')
                if isinstance(content, str):
                    stats['truncated_condition_lists'] = content.count('"required_units"')
                    stats['truncated_workflow_scopes'] = content.count('"WORKFLOW"')
                    stats['truncated_global_scopes'] = content.count('"GLOBAL"')
                    stats['truncated_document_scopes'] = content.count('"DOCUMENT"')
                raise HTTPException(400, detail='PREPARATION_OUTPUT_CAPACITY')
            normalized = normalize_deepinfra(body, model)
            input_tokens = normalized.get('prompt_eval_count') or 0
            output_tokens = normalized.get('eval_count') or 0
            if input_tokens + output_budget + 512 > limits['context_tokens']:
                raise HTTPException(400, detail='PREPARATION_CAPACITY')
            return decode_preparation(normalized['message']['content'], schema)
        artifact = await compile_support(sources, generate, metrics=stats, audit=audit)
    return artifact, {**stats, 'model': model}


def main():
    # Local preview exchanges policy only through stdin and an ignored cache.
    # Credentials remain in process memory. Serving never trusts this cache.
    sources = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    metrics = {}
    try:
        artifact, stats = asyncio.run(prepare_generation(sources, metrics))
        serialized = wire(artifact.model_dump())
        directory = Path(__file__).resolve().parents[1] / '.cache' / 'prepared-support'
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / (artifact.source_binding + '.json')
        target.write_bytes(serialized)
        print(json.dumps({'status': 'VERIFIED_COMPONENT', 'path': str(target),
            'artifact_sha256': hashlib.sha256(serialized).hexdigest(),
            'units': len(artifact.units), 'groups': len(artifact.groups), **stats}))
    except (HTTPException, httpx.HTTPError, ValueError) as error:
        print(json.dumps({'status': 'FAILED', 'reason': error.detail if isinstance(error, HTTPException)
                          else 'PREPARATION_MODEL_FAILURE', 'metrics': metrics}))
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
