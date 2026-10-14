"""Local MS-44 service launcher. Reuses gateway credentials without printing them."""
import argparse
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument('--gateway-env', type=Path, required=True)
    parser.add_argument('--gpu', action='store_true', help='Use isolated installed Vulkan Ollama on loopback port 11435')
    args = parser.parse_args()
    # Only service configuration is copied. No shell expansion or code evaluation.
    allowed = {'RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'RAG_SCOPE_ID', 'RAG_ANSWER_MODEL',
               'RAG_ANSWER_DIGEST', 'RAG_EMBEDDING_FINGERPRINT', 'KB_ENABLED', 'OLLAMA_URL',
               'RAG_PLAN_MAX_TOKENS', 'RAG_ANSWER_MAX_TOKENS', 'RAG_SELECTION_MAX_TOKENS',
               'RAG_COMPACT_SELECTION', 'RAG_MODEL_GPU_LAYERS', 'RAG_MODEL_KEEP_ALIVE', 'RAG_PRELOAD_MODEL'}
    for line in args.gateway_env.read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() in allowed:
            os.environ[key.strip()] = value.strip().strip('\"').strip("'")
    model = json.loads((root / 'answer-model.json').read_text(encoding='utf-8'))
    os.environ.setdefault('RAG_ANSWER_MODEL', model['model'])
    os.environ.setdefault('RAG_ANSWER_DIGEST', model['manifest_digest'])
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    if args.gpu:
        os.environ['OLLAMA_URL'] = 'http://127.0.0.1:11435'
        os.environ['RAG_MODEL_GPU_LAYERS'] = '-1'
        os.environ['RAG_MODEL_KEEP_ALIVE'] = '-1'
        os.environ['RAG_PRELOAD_MODEL'] = 'true'
        try:
            with urlopen('http://127.0.0.1:11435/api/version', timeout=2):
                pass
        except (URLError, TimeoutError):
            executable = Path(os.environ['LOCALAPPDATA']) / 'Programs' / 'Ollama' / 'ollama.exe'
            environment = {**os.environ, 'OLLAMA_HOST': '127.0.0.1:11435', 'OLLAMA_VULKAN': '1',
                           'OLLAMA_DEBUG': '0', 'OLLAMA_NOHISTORY': '1'}
            subprocess.Popen([str(executable), 'serve'], env=environment, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for _ in range(30):
                try:
                    with urlopen('http://127.0.0.1:11435/api/version', timeout=1):
                        break
                except (URLError, TimeoutError):
                    time.sleep(.25)
            else:
                raise ValueError('LOCAL_GPU_RUNTIME_UNAVAILABLE')
    import uvicorn
    uvicorn.run('app:app', host='127.0.0.1', port=8000, workers=1, access_log=False, log_level='critical')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('LOCAL_SERVICE_START_FAILED') from None
