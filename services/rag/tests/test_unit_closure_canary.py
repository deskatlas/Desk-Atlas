"""QAD-TC44: smaller canary closures never reuse a coarse map's verdict."""
import asyncio
import hashlib

import pytest
from fastapi import HTTPException

from experiments.ragfix.unit_closure_runtime import compile_closures, proposed_closure
from rag.document_support import canonical_units, wire
from rag.prepared_support import PreparedArtifact, source_binding


def fixture():
    content = 'Review the proof.\n\nClean the floor.\n\nNever approve a mismatched amount.\n\nFollow role permissions.'
    sources = [{'document_id': 'd', 'version_id': 'v', 'chunk_id': 'c', 'heading_path': 'Guide',
                'content': content, 'content_hash': hashlib.sha256(content.encode()).hexdigest()}]
    groups = [
        {'id': 0, 'label': 'Review', 'applies_to': 'Payment review', 'ranges': [[0, 0]],
         'requires': [1], 'conditions': [2], 'scope': 'WORKFLOW'},
        {'id': 1, 'label': 'Other', 'applies_to': 'Other tasks and conditions', 'ranges': [[1, 2]],
         'requires': [], 'conditions': [], 'scope': 'WORKFLOW'},
        {'id': 2, 'label': 'Permissions', 'applies_to': 'Every task', 'ranges': [[3, 3]],
         'requires': [], 'conditions': [], 'scope': 'GLOBAL'}]
    artifact = PreparedArtifact(source_binding=source_binding(sources), units=canonical_units(sources), groups=groups)
    text = wire(artifact.model_dump()).decode()
    return sources, artifact, text, hashlib.sha256(text.encode()).hexdigest()


def test_exact_condition_candidate_keeps_global_and_distant_rule_without_neighbor_task():
    _, artifact, _, _ = fixture()
    assert proposed_closure(artifact, 0) == [0, 2, 3]
    artifact.groups[1].scope = 'DOCUMENT'
    assert proposed_closure(artifact, 0) == [0, 2, 3]
    assert proposed_closure(artifact, 1) == [0, 1, 2, 3]


def test_every_smaller_closure_gets_a_new_full_original_audit_and_rejection_is_retained():
    sources, _, text, digest = fixture()
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data['workflow']['id'])
        assert [unit['i'] for unit in data['originals']] == [0, 1, 2, 3]
        return schema(finding='Missing condition.' if data['workflow']['id']==0 else 'Unverified scope.',
                      source_bound=True, complete=False, conditions_preserved=True, safe=True,
                      missing_originals=[1] if data['workflow']['id']==0 else [])
    result = asyncio.run(compile_closures(sources, text, digest, generate))
    assert seen == [0, 1, 2]
    assert result['contract'] == 'ragfix-unit-closures-canary-v1'
    assert not any(closure['verified'] for closure in result['closures'])


def test_stale_parent_is_rejected_before_any_provider_call():
    sources, _, text, _ = fixture()
    async def generate(*args):
        pytest.fail('stale source must not invoke a provider')
    with pytest.raises(HTTPException) as error:
        asyncio.run(compile_closures(sources, text, '0' * 64, generate))
    assert error.value.detail == 'PREPARATION_STALE'
