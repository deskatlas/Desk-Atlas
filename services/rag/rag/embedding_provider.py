"""PRD-F26/F27 / SDD-C21/C23: explicit hosted encoder, fixed contract."""
import hashlib
import json
import math
import os

import httpx

from rag.answer_provider import deepinfra_headers


CONTRACT = {
    'provider': 'deepinfra', 'model': 'Qwen/Qwen3-Embedding-4B',
    'endpoint': 'https://api.deepinfra.com/v1/openai/embeddings',
    'dimensions': 1024, 'normalization': 'l2-client-v1', 'encoding_format': 'float',
    'query_instruction': 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:',
    'max_input_bytes': 30000, 'contract_version': 1,
}
FINGERPRINT = hashlib.sha256(json.dumps(CONTRACT, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def embedding_provider():
    value = os.environ.get('RAG_EMBEDDING_PROVIDER', 'local')
    if value not in ('local', 'deepinfra'):
        raise ValueError('INVALID_EMBEDDING_PROVIDER')
    return value


def embedding_fingerprint(manifest):
    if embedding_provider() == 'deepinfra':
        return FINGERPRINT
    return hashlib.sha256(json.dumps(manifest['embedding'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class ByteTokenizer:
    """Conservative token upper bound for new chunks; no model weights."""
    def encode(self, text, add_special_tokens=True):
        return list(text.encode('utf-8')) + ([0, 0] if add_special_tokens else [])


def payload(texts, query):
    if not isinstance(texts, list) or not 1 <= len(texts) <= 4:
        raise ValueError('INVALID_EMBEDDING_BATCH')
    inputs = []
    for text in texts:
        if not isinstance(text, str) or not text.strip():
            raise ValueError('EMPTY_EMBEDDING_INPUT')
        value = (CONTRACT['query_instruction'] if query else '') + text
        if len(value.encode('utf-8')) > CONTRACT['max_input_bytes']:
            raise ValueError('EMBEDDING_INPUT_TOO_LONG')
        inputs.append(value)
    return {'model': CONTRACT['model'], 'input': inputs,
            'dimensions': 1024, 'encoding_format': 'float'}


def vectors_from_response(body, count):
    try:
        if not isinstance(body, dict) or body.get('model') != CONTRACT['model']:
            raise ValueError()
        rows = body['data']
        if not isinstance(rows, list) or len(rows) != count:
            raise ValueError()
        ordered = {}
        for row in rows:
            index, vector = row['index'], row['embedding']
            if type(index) is not int or index not in range(count) or index in ordered:
                raise ValueError()
            if not isinstance(vector, list) or len(vector) != 1024:
                raise ValueError()
            if not all(type(value) in (float, int) and math.isfinite(value) for value in vector):
                raise ValueError()
            norm = math.hypot(*vector)
            if not math.isfinite(norm) or norm <= 0:
                raise ValueError()
            ordered[index] = [value / norm for value in vector]
        return [ordered[index] for index in range(count)]
    except (ValueError, KeyError, TypeError, OverflowError):
        raise ValueError('INVALID_EMBEDDING_OUTPUT') from None


class HostedEmbeddingFailure(ValueError):
    def __init__(self, status=None, transient=False):
        super().__init__('EMBEDDING_FAILED')
        self.status, self.transient = status, transient


class HostedEncoder:
    tokenizer = ByteTokenizer()

    def __init__(self):
        deepinfra_headers()  # Validate configuration before claiming jobs.
        self._async_client = None

    def encode(self, texts, *, query=False):
        data = payload(texts, query)
        try:
            with httpx.Client(timeout=httpx.Timeout(45, connect=5),
                              follow_redirects=False, trust_env=False) as client:
                response = client.post(CONTRACT['endpoint'], headers=deepinfra_headers(), json=data)
                response.raise_for_status()
                return vectors_from_response(response.json(), len(texts))
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise HostedEmbeddingFailure(status, status == 429 or status >= 500) from None
        except httpx.RequestError:
            raise HostedEmbeddingFailure(transient=True) from None
        except ValueError:
            raise HostedEmbeddingFailure() from None

    async def encode_async(self, texts, *, query=False):
        data = payload(texts, query)
        try:
            if self._async_client is None:
                self._async_client = httpx.AsyncClient(timeout=httpx.Timeout(45, connect=5),
                                                       follow_redirects=False, trust_env=False)
            response = await self._async_client.post(CONTRACT['endpoint'], headers=deepinfra_headers(), json=data)
            response.raise_for_status()
            return vectors_from_response(response.json(), len(texts))
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise HostedEmbeddingFailure(status, status == 429 or status >= 500) from None
        except httpx.RequestError:
            raise HostedEmbeddingFailure(transient=True) from None
        except ValueError:
            raise HostedEmbeddingFailure() from None

    async def aclose(self):
        if self._async_client is not None:
            await self._async_client.aclose()
            self._async_client = None
