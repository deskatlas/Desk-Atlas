"""MS46-TC11: content-free identity frozen before a run, from local artifacts."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from uuid import UUID, uuid4

FIELDS = {"schema_version", "candidate_revision", "source_snapshot", "answer_model_digest",
          "embedding_fingerprint", "parser_fingerprint", "config_digest", "corpus_digest",
          "case_set_digest", "run_id"}
SETTINGS = {"RAG_DIAGNOSTICS_ENABLED", "RAG_HYBRID_RETRIEVAL", "RAG_SCOPE_ID", "RAG_EMBEDDING_FINGERPRINT", "RAG_MIN_SIMILARITY", "RAG_CAPACITY", "RAG_REQUEST_DEADLINE_MS", "RAG_SOP_FAST_PATH", "RAG_HYBRID_RETRIEVAL", "RAG_HYBRID_MODE", "RAG_HYBRID_QUERY_MODE",
            "RAG_COMPACT_SELECTION", "RAG_PLAN_MAX_TOKENS", "RAG_ANSWER_MAX_TOKENS", "RAG_SELECTION_MAX_TOKENS",
            "RAG_MODEL_GPU_LAYERS", "RAG_MODEL_KEEP_ALIVE", "KB_EMBEDDING_THREADS", "KB_PARSER_IMAGE", "RAG_SYNTHESIS_ENABLED"}


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                                     allow_nan=False).encode()).hexdigest()


def valid_identity(identity):
    if not isinstance(identity, dict) or set(identity) != FIELDS or type(identity.get('schema_version')) is not int or identity['schema_version'] != 1:
        return False
    if not isinstance(identity.get('candidate_revision'), str) or not re.fullmatch('[a-f0-9]{40}', identity['candidate_revision']):
        return False
    for key in FIELDS - {'schema_version', 'candidate_revision', 'run_id'}:
        if not isinstance(identity.get(key), str) or not re.fullmatch('[a-f0-9]{64}', identity[key]):
            return False
    try:
        return str(UUID(identity['run_id'])) == identity['run_id']
    except (ValueError, TypeError, AttributeError):
        return False


def source_snapshot(root: Path):
    # Explicit source allowlist. Never read environment files, model bytes,
    # caches, private uploads or benchmark payloads into a public identity.
    paths = []
    for directory in ('services/rag', 'packages', 'apps/admin-portal', 'apps/staff-dashboard', 'supabase/migrations', 'tests', 'scripts'):
        for parent, directories, filenames in os.walk(root / directory, followlinks=False):
            directories[:] = [name for name in directories if not name.startswith('.') and name not in
                              {'node_modules', '__pycache__', 'benchmark-results', 'models', 'artifacts'}]
            for name in filenames:
                path = Path(parent) / name
                if not name.startswith('.') and (path.suffix in {'.py', '.ts', '.tsx', '.json', '.sql', '.txt', '.mjs', '.cjs'} or name.endswith('Dockerfile')):
                    paths.append(path)
    paths += [root / name for name in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'docs/spec/spec4.md', 'docs/spec/spec5.md', 'docs/spec/spec6.md', 'docs/milestone/ms46.md') if (root / name).exists()]
    return canonical_digest([(path.relative_to(root).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest()) for path in sorted(set(paths))])


def freeze_identity(root: Path, corpus, cases, settings: dict):
    if set(settings) - SETTINGS or any(not isinstance(value, (str, int, bool)) for value in settings.values()):
        raise ValueError('NONSECRET_SETTINGS_ALLOWLIST_REQUIRED')
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    model = json.loads((root / 'services/rag/answer-model.json').read_text(encoding='utf-8'))
    encoder = json.loads((root / 'services/rag/models.json').read_text(encoding='utf-8'))['embedding']
    processing = [(name, hashlib.sha256((root / 'services/rag' / name).read_bytes()).hexdigest())
                  for name in ('knowledge/chunk.py', 'knowledge/extract.py', 'knowledge-parser.Dockerfile', 'knowledge-requirements.txt', 'ocr-artifacts.json')]
    identity = {'schema_version': 1, 'candidate_revision': revision, 'source_snapshot': source_snapshot(root),
                'answer_model_digest': model['manifest_digest'], 'embedding_fingerprint': canonical_digest(encoder),
                'parser_fingerprint': canonical_digest(processing), 'config_digest': canonical_digest(settings),
                'corpus_digest': canonical_digest(corpus), 'case_set_digest': canonical_digest(cases), 'run_id': str(uuid4())}
    if not valid_identity(identity):
        raise ValueError('INVALID_RUN_IDENTITY')
    return identity
