"""SDD-C23 / QAD-TC45: content-free worker transport and sandbox canaries.

Run as root on the worker VM. Never prints credentials or remote response bodies.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path('/opt/deskatlas/rag')
sys.path.insert(0, str(ROOT))


def main():
    import httpx
    values = dict(line.split('=', 1) for line in Path('/etc/deskatlas-worker.env').read_text().splitlines() if '=' in line)
    with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
        # Invalid operation is intentional: authorization runs first, but this
        # path never claims a job, writes a checkpoint or performs cleanup.
        result = client.post(values['KB_GATEWAY_URL'] + '/api/internal/knowledge/jobs/probe',
            headers={'Authorization': 'Bearer ' + values['KB_WORKER_TOKEN']}, json={})
        try:
            code = result.json().get('error', {}).get('code')
        except (ValueError, AttributeError):
            code = None
        if result.status_code != 404 or code != 'NOT_FOUND':
            safe = code if code in {'FORBIDDEN', 'KB_DISABLED', 'NOT_CONFIGURED'} else 'UNEXPECTED_RESPONSE'
            print(f'Gateway check failed: HTTP {result.status_code}, {safe}', flush=True)
            raise ValueError()
    print('WORKER_GATEWAY_AUTH_PASSED', flush=True)
    with tempfile.TemporaryDirectory(prefix='kb-synthetic-') as directory:
        source = Path(directory) / 'source'
        source.write_text('# Synthetic test\n\nSynthetic office opens at nine.\n', encoding='utf-8')
        source.chmod(0o444)
        result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128',
            '--memory', '2g', '--cpus', '2', '--tmpfs', '/tmp:rw,noexec,nosuid,size=1073741824',
            '--mount', f'type=bind,source={source},target=/input/source,readonly',
            values['KB_PARSER_IMAGE'], '--source', '/input/source', '--type', 'MD'],
            capture_output=True, timeout=120, check=False)
        body = json.loads(result.stdout) if result.returncode == 0 else {}
        if not body.get('data', {}).get('sections'):
            raise ValueError()
    print('WORKER_OFFLINE_PARSER_PASSED', flush=True)
    os.environ['DEEPINFRA_API_KEY'] = values['DEEPINFRA_API_KEY']
    try:
        from rag.embedding_provider import HostedEncoder
        vectors = HostedEncoder().encode(['Synthetic office opens at nine.'])
        if len(vectors) != 1 or len(vectors[0]) != 1024:
            raise ValueError()
    finally:
        os.environ.pop('DEEPINFRA_API_KEY', None)
    print('WORKER_HOSTED_EMBEDDING_PASSED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('WORKER_PREFLIGHT_FAILED: inspect the last completed stage; no source content or secrets displayed')
        raise SystemExit(1) from None
