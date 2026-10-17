"""MS50-TC03/06: exercise the real launcher against an unrelated listener."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_occupied_port_is_actionable_and_listener_survives():
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', 8000))
            listener.listen()
        except OSError:
            # An existing local listener is equally valid; never stop it.
            with socket.create_connection(('127.0.0.1', 8000), timeout=1):
                pass
        result = subprocess.run([sys.executable, str(ROOT / 'serve_local.py')],
                                capture_output=True, text=True, timeout=15,
                                env={**{key: value for key, value in os.environ.items()
                                        if not key.startswith(('RAG_', 'KB_'))},
                                     'RAG_SERVICE_TOKEN': 'synthetic-service-credential-at-least-32',
                                     'RAG_CAPABILITY_SECRET': 'synthetic-capability-secret-at-least-32',
                                     'RAG_SCOPE_ID': 'synthetic', 'RAG_ANSWER_DIGEST': 'a' * 64,
                                     'KB_ENABLED': 'false', 'RAG_PRELOAD_MODEL': 'false'})
        assert result.returncode == 1
        assert 'API_PORT_IN_USE' in result.stderr
        assert 'Traceback' not in result.stderr
        with socket.create_connection(('127.0.0.1', 8000), timeout=1):
            pass


# MS50-TC01/05/07/09: real Uvicorn lifespan and request boundaries, no models.
import asyncio
from contextlib import asynccontextmanager
import importlib.util
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('ms50_launcher', ROOT / 'serve_local.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_native_embedding_imports_finish_before_serving_loop(monkeypatch):
    from types import SimpleNamespace
    import rag.encoder
    loaded = []
    def preload():
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()
        loaded.append(True)
    async def serve(*_args, **_kwargs):
        assert loaded == [True]
        assert asyncio.get_running_loop().is_running()
    monkeypatch.setenv('KB_ENABLED', 'true')
    monkeypatch.setattr(sys, 'argv', ['serve_local.py'])
    monkeypatch.setitem(sys.modules, 'app', SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace())))
    monkeypatch.setattr(rag.encoder, 'preload_runtime', preload)
    monkeypatch.setattr(launcher, 'reserve_api_socket', lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(launcher, 'serve', serve)
    launcher.main()


def test_disabled_knowledge_never_imports_native_encoder_at_startup(monkeypatch):
    import rag.encoder
    monkeypatch.setenv('KB_ENABLED', 'false')
    monkeypatch.setattr(rag.encoder, 'preload_runtime', lambda: pytest.fail('Unexpected native import'))
    launcher.preload_encoder_runtime()


def test_initialization_rejection_is_sanitized(capsys):
    from fastapi import FastAPI

    @asynccontextmanager
    async def rejected(_app):
        raise RuntimeError('synthetic-secret-must-never-appear')
        yield

    with launcher.reserve_api_socket(0) as sock:
        with pytest.raises(launcher.StartupFailure, match='API_INITIALIZATION_FAILED'):
            asyncio.run(launcher.serve(FastAPI(lifespan=rejected), sock))
    assert 'Ready' not in capsys.readouterr().out


def test_startup_deadline_does_not_report_ready(capsys):
    from fastapi import FastAPI

    @asynccontextmanager
    async def stalled(_app):
        await asyncio.sleep(10)
        yield

    with launcher.reserve_api_socket(0) as sock:
        with pytest.raises(launcher.StartupFailure, match='API_STARTUP_TIMEOUT'):
            asyncio.run(launcher.serve(FastAPI(lifespan=stalled), sock, timeout=.1))
    assert 'Ready' not in capsys.readouterr().out


def test_ready_means_http_reachable_and_shutdown_drains(capsys):
    from fastapi import FastAPI
    import httpx
    closed = []

    @asynccontextmanager
    async def lifecycle(_app):
        yield
        closed.append(True)

    app = FastAPI(lifespan=lifecycle)

    @app.get('/health')
    async def health():
        return {'ready': True}

    async def exercise(sock):
        task = asyncio.create_task(launcher.serve(app, sock, controlled=True))
        async with httpx.AsyncClient(trust_env=False) as client:
            for _ in range(100):
                try:
                    response = await client.get(f'http://127.0.0.1:{sock.getsockname()[1]}/health')
                    assert response.json() == {'ready': True}
                    break
                except httpx.TransportError:
                    await asyncio.sleep(.02)
            else:
                raise AssertionError('API never became reachable')
        shutdown.set()
        await asyncio.wait_for(task, 3)

    shutdown = launcher.threading.Event()
    control = Mock()
    control.readline.side_effect = lambda: shutdown.wait(3)
    with launcher.reserve_api_socket(0) as sock, patch.object(launcher.sys, 'stdin', control):
        asyncio.run(exercise(sock))
    assert closed == [True]
    assert 'Ready' in capsys.readouterr().out


def test_reused_gpu_is_not_owned_or_terminated():
    with patch.object(launcher, 'gpu_available', return_value=True), patch.object(launcher.subprocess, 'Popen') as spawn:
        assert launcher.start_gpu() is None
        launcher.stop_owned(None)
        spawn.assert_not_called()


def test_only_owned_child_is_reaped():
    child = Mock()
    child.poll.return_value = None
    launcher.stop_owned(child)
    child.terminate.assert_called_once()
    child.wait.assert_called_once_with(timeout=3)


def test_gpu_runtime_failure_has_fixed_guidance(capsys):
    with patch.object(launcher, 'gpu_available', return_value=False), patch.object(launcher.Path, 'is_file', return_value=False):
        with pytest.raises(launcher.StartupFailure, match='GPU_RUNTIME_UNAVAILABLE'):
            launcher.start_gpu()
    launcher.diagnostic('GPU_RUNTIME_UNAVAILABLE')
    assert 'no fallback' in capsys.readouterr().err

@pytest.mark.parametrize('code', ['MODEL_REVISION_MISMATCH', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'])
def test_model_rejections_keep_safe_specific_codes(code, capsys, caplog):
    from fastapi import FastAPI, HTTPException

    @asynccontextmanager
    async def rejected(_app):
        raise HTTPException(503, detail=code)
        yield

    with launcher.reserve_api_socket(0) as sock:
        with pytest.raises(launcher.StartupFailure, match=code):
            asyncio.run(launcher.serve(FastAPI(lifespan=rejected), sock))
    assert 'Ready' not in capsys.readouterr().out
    assert 'Traceback' not in caplog.text


def test_failed_owned_gpu_start_is_bounded_and_reaped():
    child = Mock()
    child.poll.return_value = None
    with patch.object(launcher, 'gpu_available', return_value=False), \
            patch.object(launcher.Path, 'is_file', return_value=True), \
            patch.object(launcher.subprocess, 'Popen', return_value=child), \
            patch.object(launcher.time, 'sleep'):
        with pytest.raises(launcher.StartupFailure, match='GPU_RUNTIME_UNAVAILABLE'):
            launcher.start_gpu()
    child.terminate.assert_called_once()
    child.wait.assert_called_once_with(timeout=3)


def test_native_startup_watchdog_reaps_only_owned_runtime(capsys):
    completed = launcher.threading.Event()
    owned = Mock()
    with patch.object(launcher, 'stop_owned') as stop, patch.object(launcher.os, '_exit') as exit_process:
        launcher.startup_watchdog(completed, lambda: owned, timeout=.01)
        stop.assert_called_once_with(owned)
        exit_process.assert_called_once_with(1)
    assert 'API_STARTUP_TIMEOUT' in capsys.readouterr().err


def test_ready_or_failed_startup_disarms_native_watchdog():
    completed = launcher.threading.Event()
    completed.set()
    with patch.object(launcher.os, '_exit') as exit_process:
        launcher.startup_watchdog(completed, lambda: None, timeout=.01)
        exit_process.assert_not_called()
