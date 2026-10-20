"""SDD-C21 / QAD-TC46: prepare a reviewed revision from the live service.

Reads only service configuration. Does not access secret values or deploy.
"""
import argparse
import copy
import json
from pathlib import Path
import re
import shutil
import subprocess


SERVICE = 'deskatlas-rag-chat-staging'
PROJECT = 'deskatlas-rag'
REGION = 'us-central1'
IMAGE_PREFIX = 'us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-deepinfra@sha256:'


def prepare(service, image, secret_version='1', hosted_embeddings=False):
    image_prefix = IMAGE_PREFIX.replace('api-deepinfra@', 'api-hosted@') if hosted_embeddings else IMAGE_PREFIX
    if not re.fullmatch(re.escape(image_prefix) + r'[a-f0-9]{64}', image):
        raise ValueError('IMMUTABLE_DEEPINFRA_IMAGE_REQUIRED')
    if not re.fullmatch(r'[1-9][0-9]*', secret_version):
        raise ValueError('NUMBERED_SECRET_VERSION_REQUIRED')
    result = copy.deepcopy(service)
    if result.get('metadata', {}).get('name') != SERVICE:
        raise ValueError('UNEXPECTED_SERVICE')
    result.pop('status', None)
    metadata = result['metadata']
    for key in ('uid', 'resourceVersion', 'generation', 'creationTimestamp', 'selfLink', 'managedFields'):
        metadata.pop(key, None)
    for key in list(metadata.get('annotations', {})):
        if key.startswith('serving.knative.dev/') or key in ('run.googleapis.com/operation-id', 'run.googleapis.com/urls', 'run.googleapis.com/ingress-status'):
            metadata['annotations'].pop(key)
    template = result['spec']['template']
    template.setdefault('metadata', {}).pop('name', None)
    template['metadata'].get('annotations', {}).pop('run.googleapis.com/container-dependencies', None)
    containers = template['spec']['containers']
    if sorted(item.get('name', '') for item in containers) not in (['api'], ['api', 'ollama']):
        raise ValueError('UNEXPECTED_CONTAINERS')
    api = next(item for item in containers if item['name'] == 'api')
    api['image'] = image
    removed = {'OLLAMA_URL', 'RAG_ANSWER_DIGEST', 'RAG_MODEL_GPU_LAYERS',
               'RAG_MODEL_KEEP_ALIVE', 'RAG_MODEL_BATCH_SIZE', 'RAG_PRELOAD_MODEL',
               'RAG_MODEL_PROVIDER', 'RAG_ANSWER_MODEL', 'DEEPINFRA_API_KEY'}
    env = [item for item in api.get('env', []) if item['name'] not in removed]
    # Existing service credentials must already be secret references.
    for name in ('RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET'):
        item = next((item for item in env if item['name'] == name), {})
        if not item.get('valueFrom', {}).get('secretKeyRef'):
            raise ValueError('SERVICE_SECRET_REFERENCE_REQUIRED')
    env.extend([
        {'name': 'RAG_MODEL_PROVIDER', 'value': 'deepinfra'},
        {'name': 'RAG_ANSWER_MODEL', 'value': 'Qwen/Qwen3-32B'},
        {'name': 'DEEPINFRA_API_KEY', 'valueFrom': {'secretKeyRef': {
            'name': 'deepinfra-api-key', 'key': secret_version}}},
    ])
    api['env'] = env
    if hosted_embeddings:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from rag.embedding_provider import FINGERPRINT
        api['env'] = [item for item in api['env'] if item['name'] not in ('RAG_EMBEDDING_PROVIDER', 'RAG_EMBEDDING_FINGERPRINT')]
        api['env'].extend([{'name': 'RAG_EMBEDDING_PROVIDER', 'value': 'deepinfra'},
                           {'name': 'RAG_EMBEDDING_FINGERPRINT', 'value': FINGERPRINT}])
    template['spec']['containers'] = [api]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--secret-version', default='1')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--hosted-embeddings', action='store_true')
    args = parser.parse_args()
    cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
    if not cli:
        raise ValueError('GCLOUD_NOT_FOUND')
    response = subprocess.run([cli, 'run', 'services', 'describe', SERVICE,
        '--project=' + PROJECT, '--region=' + REGION, '--format=json'],
        capture_output=True, text=True, check=False)
    if response.returncode:
        raise ValueError('SERVICE_CONFIGURATION_READ_FAILED')
    manifest = prepare(json.loads(response.stdout), args.image, args.secret_version, args.hosted_embeddings)
    # Exclusive creation protects any previously reviewed deployment artifact.
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
        output.write('\n')
    print('DEEPINFRA_MANIFEST_PREPARED: no deployment performed')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, StopIteration, TypeError):
        print('MANIFEST_PREPARATION_FAILED: check image digest, service configuration and output path')
        raise SystemExit(1) from None
