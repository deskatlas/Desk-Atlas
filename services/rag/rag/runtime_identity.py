"""MS53 / SDD-C21: identify loaded serving code without source disclosure."""
import hashlib
from pathlib import Path


FILES = ('rag/answer_provider.py', 'rag/document_support.py', 'rag/ms65-budget.json', 'app.py', 'rag/encoder.py', 'rag/evidence.py', 'rag/evidence_budget.py', 'rag/evidence-budget.json', 'rag/governance.py', 'rag/procedure.py', 'rag/obligations.py', 'rag/request_boundary.py', 'rag/request_timing.py', 'rag/runtime_identity.py', 'serve_local.py')


def implementation_fingerprint(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for name in FILES:
        digest.update(name.encode('utf-8') + b'\0')
        digest.update((root / name).read_bytes())
    return digest.hexdigest()
