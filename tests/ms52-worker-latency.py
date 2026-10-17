"""MS52 diagnostic: 30 synthetic jobs through actual before/after worker loops.

No storage, database, OCR or model is invoked. This isolates scheduling only;
it cannot establish end-to-end deletion budgets or provider acceptance.
"""
import contextlib
import io
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import types
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/rag'))
from knowledge import worker


class Finished(Exception):
    pass


def measure(module, concurrent):
    started = threading.Event()
    stop = threading.Event()
    samples = []
    lock = threading.Lock()
    origin = [0.0]
    class Gateway:
        def __init__(self, *_args):
            self.ingest = False
        def call(self, _path, data):
            kind = data.get('kind')
            with lock:
                if kind != 'PURGE' and not self.ingest:
                    self.ingest = True
                    return {'job': {'kind': 'INGEST'}}
            if kind == 'INGEST':
                return None
            assert started.wait(2)
            with lock:
                if len(samples) == 30:
                    return None
                samples.append(round((time.perf_counter() - origin[0]) * 1000, 3))
            return {'job': {'kind': 'PURGE'}}
    def process(_gateway, claim, *_args):
        if claim['job']['kind'] == 'INGEST':
            origin[0] = time.perf_counter()
            started.set()
            time.sleep(1)
        elif len(samples) == 30:
            if concurrent:
                stop.set()
            else:
                raise Finished()
    with patch.object(module, 'Gateway', Gateway), patch.object(module, 'process_claim', process), patch.dict(module.os.environ, {'KB_ENABLED': 'true'}):
        if concurrent:
            module.run_lanes(Gateway(), None, '', stop)
        else:
            try:
                module.main()
            except Finished:
                pass
    samples.sort()
    return {'samples': len(samples), 'eligible_to_claim_p50_ms': samples[14], 'eligible_to_claim_p95_ms': samples[28], 'max_ms': samples[-1]}


if __name__ == '__main__':
    source = subprocess.run(['git', 'show', 'HEAD:services/rag/knowledge/worker.py'], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    baseline = types.ModuleType('ms52_baseline')
    baseline.__file__ = str(ROOT / 'services/rag/knowledge/worker.py')
    exec(compile(source, baseline.__file__, 'exec'), baseline.__dict__)
    with contextlib.redirect_stdout(io.StringIO()):
        before, after = measure(baseline, False), measure(worker, True)
    result = {'profile': 'scheduler-only, 30 synthetic purge jobs, ingestion blocked 1000ms, no provider calls',
              'release_evidence': False, 'baseline_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'before': before, 'after': after,
              'normal_provider_latency_acceptance': 'PENDING'}
    (ROOT / 'services/rag/evaluation/ms52-scheduling.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
