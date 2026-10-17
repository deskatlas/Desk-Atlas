"""MS-50 / SDD-C21 / QAD-TC46: private, bounded startup with safe diagnostics."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import errno
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
from urllib.request import urlopen
from urllib.error import URLError


class StartupFailure(Exception):
    """Only fixed codes and operator guidance may cross the console boundary."""


GUIDANCE = {
    'API_PORT_IN_USE': 'Port 8000 is occupied. Use the existing API or stop its owning process intentionally before retrying.',
    'API_BIND_FAILED': 'Cannot bind the loopback API port. Check local socket permissions.',
    'API_IMPORT_FAILED': 'Verify the approved isolated service dependencies; see services/rag/README.md.',
    'API_INITIALIZATION_FAILED': 'Check saved credentials, pinned model digest, embedding fingerprint and offline model artifacts.',
    'API_STARTUP_TIMEOUT': 'Initialization exceeded 180 seconds. Check local model runtime and artifact availability.',
    'GPU_RUNTIME_UNAVAILABLE': 'Verify the approved local Ollama installation and loopback port 11435; no fallback was selected.',
    'GPU_MODEL_NOT_RESIDENT': 'The pinned model is not resident on GPU. Check approved GPU runtime support and memory.',
    'MODEL_REVISION_MISMATCH': 'The installed answer model differs from the pinned digest. Restore the approved artifact.',
    'MODEL_UNAVAILABLE': 'The configured local model runtime is unavailable. Start the approved runtime and retry.',
    'MODEL_TIMEOUT': 'The local model did not finish preloading within its request deadline.',
    'API_RUNTIME_FAILED': 'The API stopped unexpectedly. Check local runtime availability and retry.',
}


def diagnostic(code):
    print(f'RAG {code}: {GUIDANCE[code]}', file=sys.stderr, flush=True)


def reserve_api_socket(port=8000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # Exclusive Windows ownership; do not reuse or evict another listener.
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(('127.0.0.1', port))
        sock.listen(128)
        sock.setblocking(False)
        return sock
    except OSError as error:
        sock.close()
        raise StartupFailure('API_PORT_IN_USE' if error.errno == errno.EADDRINUSE
                             or getattr(error, 'winerror', None) == 10048 else 'API_BIND_FAILED') from None


def gpu_available():
    try:
        with urlopen('http://127.0.0.1:11435/api/version', timeout=1) as response:
            return response.status == 200
    except (URLError, TimeoutError, OSError):
        return False


def start_gpu():
    if gpu_available():
        return None
    executable = (Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'Ollama' / 'ollama.exe'
                  if sys.platform == 'win32' else shutil.which('ollama'))
    if not executable or not Path(executable).is_file():
        raise StartupFailure('GPU_RUNTIME_UNAVAILABLE')
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith(('RAG_', 'KB_', 'SUPABASE_', 'NEXT_PUBLIC_'))}
    environment.update({'OLLAMA_HOST': '127.0.0.1:11435', 'OLLAMA_VULKAN': '1',
                        'OLLAMA_DEBUG': '0', 'OLLAMA_NOHISTORY': '1'})
    try:
        child = subprocess.Popen([str(executable), 'serve'], env=environment,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except OSError:
        raise StartupFailure('GPU_RUNTIME_UNAVAILABLE') from None
    try:
        for _ in range(30):
            if child.poll() is not None:
                break
            if gpu_available():
                return child
            time.sleep(.25)
        raise StartupFailure('GPU_RUNTIME_UNAVAILABLE')
    except BaseException:
        stop_owned(child)
        raise


def stop_owned(child):
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)


def startup_watchdog(completed, owned_runtime, *, timeout=180):
    # Encoder imports/loading are synchronous native work and can block the
    # asyncio deadline. An independent thread bounds that phase as well.
    if not completed.wait(timeout):
        diagnostic('API_STARTUP_TIMEOUT')
        try:
            stop_owned(owned_runtime())
        finally:
            os._exit(1)


def preload_encoder_runtime():
    if os.environ.get('KB_ENABLED') == 'true':
        print('RAG startup stage: native embedding runtime.', flush=True)
        from rag.encoder import preload_runtime
        preload_runtime()
        print('RAG startup stage: native embedding runtime ready.', flush=True)


async def serve(application, sock, *, timeout=180, controlled=False, ready_event=None):
    import uvicorn
    failure = []
    original_lifespan = application.router.lifespan_context

    @asynccontextmanager
    async def guarded_lifespan(app):
        initialized = False
        try:
            async with original_lifespan(app):
                initialized = True
                yield
        except Exception as error:
            # Never render exception text, URLs, model output or tracebacks.
            code = getattr(error, 'detail', None)
            if code not in ('MODEL_REVISION_MISMATCH', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'):
                code = 'GPU_MODEL_NOT_RESIDENT' if error.args == ('GPU_MODEL_NOT_RESIDENT',) else 'API_INITIALIZATION_FAILED'
            if initialized:
                code = 'API_RUNTIME_FAILED'
            failure.append(code)
            raise

    application.router.lifespan_context = guarded_lifespan
    server = uvicorn.Server(uvicorn.Config(application, host='127.0.0.1', port=8000,
                            workers=1, access_log=False, log_config=None,
                            log_level='critical', timeout_graceful_shutdown=5))
    # The inherited control pipe is private to this invocation. EOF also stops
    # the API if the Node parent disappears. Standalone invocations use signals.
    if controlled:
        def control():
            sys.stdin.readline()
            server.should_exit = True
        threading.Thread(target=control, daemon=True).start()
    task = asyncio.create_task(server.serve(sockets=[sock]))
    deadline = time.monotonic() + timeout
    try:
        while not server.started and not task.done() and not server.should_exit:
            if time.monotonic() >= deadline:
                task.cancel()
                raise StartupFailure('API_STARTUP_TIMEOUT')
            await asyncio.sleep(.05)
        if server.started:
            if ready_event is not None:
                ready_event.set()
            print(f'RAG API Ready: application initialization completed on 127.0.0.1:{sock.getsockname()[1]}.', flush=True)
        await task
        if failure:
            raise StartupFailure(failure[0])
        if not server.started and not server.should_exit:
            raise StartupFailure('API_INITIALIZATION_FAILED')
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        application.router.lifespan_context = original_lifespan


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument('--gateway-env', type=Path)
    parser.add_argument('--gpu', action='store_true')
    parser.add_argument('--controlled', action='store_true')
    args = parser.parse_args()
    # Reserve before model loading; the same owned socket is handed to Uvicorn.
    sock = reserve_api_socket()
    gpu = None
    completed = threading.Event()
    threading.Thread(target=startup_watchdog, args=(completed, lambda: gpu), daemon=True).start()
    try:
        allowed = {'RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'RAG_SCOPE_ID', 'RAG_ANSWER_MODEL',
                   'RAG_ANSWER_DIGEST', 'RAG_EMBEDDING_FINGERPRINT', 'KB_ENABLED', 'OLLAMA_URL',
                   'RAG_PLAN_MAX_TOKENS', 'RAG_ANSWER_MAX_TOKENS', 'RAG_SELECTION_MAX_TOKENS',
                   'RAG_COMPACT_SELECTION', 'RAG_MODEL_GPU_LAYERS', 'RAG_MODEL_KEEP_ALIVE', 'RAG_PRELOAD_MODEL', 'RAG_MODEL_BATCH_SIZE'}
        for line in args.gateway_env.read_text(encoding='utf-8-sig').splitlines() if args.gateway_env else []:
            key, separator, value = line.partition('=')
            if separator and key.strip() in allowed:
                os.environ[key.strip()] = value.strip().strip('\"').strip("'")
        model = json.loads((root / 'answer-model.json').read_text(encoding='utf-8'))
        os.environ.setdefault('RAG_ANSWER_MODEL', model['model'])
        os.environ.setdefault('RAG_ANSWER_DIGEST', model['manifest_digest'])
        os.environ.update({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'})
        if args.gpu:
            # Retain the approved GPU profile's preload and residency checks.
            os.environ['OLLAMA_URL'] = 'http://127.0.0.1:11435'
            os.environ['RAG_MODEL_GPU_LAYERS'] = '-1'
            os.environ['RAG_MODEL_KEEP_ALIVE'] = '-1'
            os.environ['RAG_PRELOAD_MODEL'] = 'true'
            os.environ.setdefault('RAG_MODEL_BATCH_SIZE', '64')
            print('RAG startup stage: GPU runtime.', flush=True)
            gpu = start_gpu()
        print('RAG startup stage: application import.', flush=True)
        try:
            from app import app
            # Fixed stage names only: no source, credentials or model responses.
            app.state.startup_progress = lambda stage: print(f'RAG startup stage: {stage}.', flush=True)
            import uvicorn  # noqa: F401 - validate dependency before initialization
        except Exception:
            raise StartupFailure('API_IMPORT_FAILED') from None
        # Avoid first-time native NumPy/Torch imports in the Windows ASGI loop.
        # Full pinned weights and fingerprints are still verified in lifespan.
        preload_encoder_runtime()
        print('RAG startup stage: application initialization (deadline 180 seconds).', flush=True)
        asyncio.run(serve(app, sock, controlled=args.controlled, ready_event=completed))
    finally:
        completed.set()
        sock.close()
        stop_owned(gpu)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except StartupFailure as failure:
        diagnostic(failure.args[0])
        raise SystemExit(1) from None
    except Exception:
        diagnostic('API_RUNTIME_FAILED')
        raise SystemExit(1) from None
