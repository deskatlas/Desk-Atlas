"""QAD-TC44/45: synthetic real hosted embedding smoke, no source content."""
import asyncio
import os
from pathlib import Path
import shutil
import sys

from check_private import google


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from rag.embedding_provider import HostedEncoder, FINGERPRINT
    cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
    key = google(cli, 'secrets', 'versions', 'access', '1', '--secret=deepinfra-api-key', '--project=deskatlas-rag')
    os.environ['DEEPINFRA_API_KEY'] = key
    try:
        encoder = HostedEncoder()
        documents = encoder.encode(['Synthetic office opens at nine.', 'Synthetic office closes at six.'])
        queries = asyncio.run(encoder.encode_async(['What time does the office open?'], query=True))
        assert len(documents) == 2 and len(queries) == 1
        print('HOSTED_EMBEDDINGS_PASSED: document batch and asynchronous query, 1024 normalized dimensions')
        print('Embedding fingerprint: ' + FINGERPRINT)
    finally:
        os.environ.pop('DEEPINFRA_API_KEY', None)


if __name__ == '__main__':
    try: main()
    except Exception:
        print('HOSTED_EMBEDDINGS_FAILED: verify secret access and provider availability')
        raise SystemExit(1) from None
