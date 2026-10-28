"""MS53: loaded-code health metadata cannot certify newly edited source."""
import asyncio
from pathlib import Path
import re
import pytest

from rag.runtime_identity import FILES, implementation_fingerprint


@pytest.mark.parametrize('changed', ['app.py', 'rag/batched_support.py', 'customer_public.py'])
def test_fingerprint_changes_when_serving_code_changes(tmp_path, changed):
    for name in FILES:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('synthetic serving code', encoding='utf-8')
    original = implementation_fingerprint(tmp_path)
    assert re.fullmatch('[a-f0-9]{64}', original)
    (tmp_path / changed).write_text('new serving code', encoding='utf-8')
    assert implementation_fingerprint(tmp_path) != original


def test_health_exposes_imported_identity_without_echoing_credentials(monkeypatch):
    import app
    loaded = app.LOADED_IMPLEMENTATION
    monkeypatch.setattr(app, 'implementation_fingerprint', lambda: 'new-source-not-loaded')
    result = asyncio.run(app.health(None))
    assert result == {'ready': True, 'implementation_fingerprint': loaded,
                      'answer_provider': 'ollama', 'answer_model': 'qwen3:4b',
                      'document_answer_model': 'qwen3:4b',
                      'evidence_contracts': ['ms65-v1']}


def test_node_status_and_python_use_the_same_source_fingerprint():
    import subprocess
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(['node', '-e',
        "process.stdout.write(require('./scripts/rag-status.cjs').fingerprint())"],
        cwd=root, capture_output=True, text=True, check=True)
    assert result.stdout == implementation_fingerprint()
