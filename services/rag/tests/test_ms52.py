"""MS52-TC02/11: actual independent worker lanes, synthetic blocked ingestion."""
import threading
import time

from knowledge import worker


def test_ms52_cleanup_progresses_while_ingestion_is_blocked(monkeypatch):
    ingest_started = threading.Event()
    cleanup_finished = threading.Event()
    stop = threading.Event()
    claimed = set()
    class Gateway:
        def call(self, path, data):
            assert path == 'claim'
            kind = data['kind']
            if kind not in claimed:
                claimed.add(kind)
                return {'job': {'kind': kind}}
            return None
    def process(_gateway, claim, _encoder, _fingerprint):
        if claim['job']['kind'] == 'INGEST':
            ingest_started.set()
            assert cleanup_finished.wait(2), 'cleanup waited behind ingestion'
            stop.set()
        else:
            assert ingest_started.wait(2)
            cleanup_finished.set()
    monkeypatch.setattr(worker, 'process_claim', process)
    runner = threading.Thread(target=worker.run_lanes, args=(Gateway(), None, '', stop))
    runner.start()
    runner.join(4)
    stop.set()
    assert not runner.is_alive()
    assert cleanup_finished.is_set()


def test_ms52_standalone_purge_never_reads_models(monkeypatch):
    monkeypatch.setenv('KB_ENABLED', 'true')
    monkeypatch.setenv('KB_WORKER_MODE', 'purge')
    monkeypatch.setenv('KB_WORKER_TOKEN', 'synthetic-worker-token-at-least-32-characters')
    calls = []
    monkeypatch.setattr(worker, 'run_lane', lambda *args: calls.append(args))
    monkeypatch.setattr(worker.Path, 'read_text', lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError('model manifest read')))
    worker.main()
    assert calls[0][1] == 'PURGE'
