"""PRD-F26 / SDD-C20-C22 / QAD-TC44/46: broad admin browser regressions."""
import asyncio
import hashlib
import pytest

from app import measured_data_request, scope_clarification
from rag.batched_support import batched_document_answer
from rag.document_support import Verification


def test_broad_status_is_data_and_missing_troubleshooting_subject_clarifies():
    assert measured_data_request('How are things looking today? Anything I need to deal with?')
    assert scope_clarification('What usually goes wrong, and how should I handle it?', True)
    assert scope_clarification('What usually goes wrong with online payments?', True) is None
    assert 'pay online' in scope_clarification("Someone says they paid, but their booking isn't confirmed. What should I do?", False)


def test_qr_entity_substitution_cannot_pass_even_with_positive_model_verdict(monkeypatch):
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = ('Payment and booking QRs serve different purposes. Booking QRs use opaque tokens. '
            'Early check-in is prohibited. During the active booking window, the first eligible scan '
            'automatically checks in a confirmed booking not already checked in manually.')
    source = {'chunk_id': 'one', 'heading_path': 'Access', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    verified = []
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text',
                'text': 'A booking QR is not a check-in QR; early check-in is prohibited.', 'support': [0]}])
        verified.append(data['answer'])
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(batched_document_answer('How do QR check-ins work?', [source], generate, actor_role='ADMIN'))
    answer = ' '.join(block['text'] for block in result['synthesis']['blocks'])
    assert 'A booking QR is not a check-in QR' not in answer
    assert 'first eligible scan' in answer
    assert verified and verified[0]['blocks'][0]['text'] == text


def test_internal_prose_strips_generated_section_markers_but_keeps_exact_proof(monkeypatch):
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Report connectivity problems to management.'
    source = {'chunk_id': 'one', 'heading_path': '2.6.4', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': text + ' [2.6.4, 4.5]', 'support': [0]}])
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(batched_document_answer('How do I help?', [source], generate, actor_role='ADMIN'))
    assert result['synthesis']['blocks'][0]['text'] == text
    assert result['spans'][0]['quote'] == text


@pytest.mark.parametrize('supported', [True, False])
def test_one_exact_omission_repair_is_reverified_and_never_repairs_unsupported_claims(monkeypatch, supported):
    from fastapi import HTTPException
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Assess the complaint.\n\nEscalate unresolved complaints to the manager.'
    source = {'chunk_id': 'one', 'heading_path': 'Complaints', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='DOCUMENT_WIDE', blocks=[{'kind': 'text', 'text': 'Assess the complaint.', 'support': [0]}])
        assert data['answer']['scope'] == 'MULTI_PART'
        repaired = len(data['answer']['blocks']) == 2
        return schema(relevant=True, supported=supported, complete=repaired, consistent=True, safe=True,
                      reason_code='NONE' if repaired else 'MISSING_CONDITION', missing_originals=[] if repaired else [1])
    operation = batched_document_answer('How do I handle a complaint?', [source], generate, actor_role='ADMIN')
    if supported:
        result = asyncio.run(operation)
        assert len(calls) == result['counts']['calls'] == 3
        assert result['synthesis']['blocks'][1]['text'] == 'Escalate unresolved complaints to the manager.'
        assert len(result['spans']) == 2
    else:
        with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
            asyncio.run(operation)
        assert len(calls) == 2


def test_qwen_draft_gets_a_trusted_concise_instruction_after_original_data():
    from rag.answer_provider import deepinfra_payload
    payload = {'model': 'Qwen/Qwen3.6-35B-A3B', 'format': {'type': 'object', 'properties': {}},
               'messages': [{'role': 'system', 'content': 'Trusted original rules.'},
                            {'role': 'user', 'content': 'Untrusted original source.'}],
               'options': {'num_predict': 1200}}
    result = deepinfra_payload(payload, 'CompactDraft')
    assert result['messages'][1]['content'] == 'Untrusted original source.'
    assert result['messages'][-1]['role'] == 'system'
    assert '80-140 words TOTAL' in result['messages'][-1]['content']
    assert len(payload['messages']) == 2


def test_repair_restores_canonical_order_when_missing_rule_precedes_selected_rule(monkeypatch):
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Verify confirmation before check-in.\n\nCheck in the guest.'
    source = {'chunk_id': 'one', 'heading_path': 'Arrival', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Check in the guest.', 'support': [1]}])
        repaired = len(data['answer']['blocks']) == 2
        return schema(relevant=True, supported=True, complete=repaired, consistent=True, safe=True,
                      reason_code='NONE' if repaired else 'MISSING_CONDITION', missing_originals=[] if repaired else [0])
    result = asyncio.run(batched_document_answer('How do I check in?', [source], generate, actor_role='ADMIN'))
    assert [s['start'] for s in result['spans']] == sorted(s['start'] for s in result['spans'])
    assert result['synthesis']['blocks'][0]['support'] == [1]
    assert result['synthesis']['blocks'][1]['support'] == [0]


def test_qr_recovery_uses_original_access_rule_and_drops_uncited_neighbor(monkeypatch):
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    rule = 'During the active booking window, scan the booking QR to check in a confirmed guest.'
    text = 'Verify the reservation.\n\n' + rule
    source = {'chunk_id': 'one', 'heading_path': 'Access', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'A booking QR is not a check-in QR.', 'support': [0]}])
        assert data['answer']['blocks'][0]['text'] == rule
        return schema(relevant=True, supported=True, complete=True, consistent=True, safe=True, reason_code='NONE', missing_originals=[])
    result = asyncio.run(batched_document_answer('How do QR check-ins work?', [source], generate, actor_role='ADMIN'))
    assert len(result['spans']) == 1 and result['spans'][0]['quote'] == rule
    assert result['synthesis']['blocks'][0]['support'] == [0]


@pytest.mark.parametrize('supported', [True, False])
def test_overview_granularity_can_clarify_but_cannot_hide_unsupported_drafts(monkeypatch, supported):
    from fastapi import HTTPException
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Inspect the facility before opening.'
    source = {'chunk_id': 'one', 'heading_path': 'Opening', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            assert data['requested_detail'] == 'OVERVIEW'
            return schema(scope='DOCUMENT_WIDE', blocks=[{'kind': 'text', 'text': text, 'support': [0]}])
        return schema(relevant=True, supported=supported, complete=False, consistent=True, safe=True,
                      reason_code='MISSING_STEP', missing_originals=[])
    task = batched_document_answer('What should I focus on today?', [source], generate, actor_role='ADMIN')
    if supported:
        result = asyncio.run(task)
        assert result['outcome'] == 'CLARIFY' and not result['spans'] and result['synthesis'] is None
        assert result['clarification'].endswith('?')
    else:
        with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
            asyncio.run(task)


def test_repair_quote_budget_counts_actual_evidence_not_repeated_heading_metadata(monkeypatch):
    monkeypatch.delenv('RAG_QWEN_COMPACT_DRAFT', raising=False)
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = '\n\n'.join(f'Original required rule {i}.' for i in range(12))
    source = {'chunk_id': 'one', 'heading_path': 'Long original heading ' * 20, 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Original required rule 11.', 'support': [11]}])
        repaired = len(data['answer']['blocks']) > 1
        return schema(relevant=True, supported=True, complete=repaired, consistent=True, safe=True,
                      reason_code='NONE' if repaired else 'MISSING_STEP', missing_originals=[] if repaired else [0])
    result = asyncio.run(batched_document_answer('Which rules apply?', [source], generate, actor_role='ADMIN'))
    assert result['outcome'] == 'COMPLETE' and len(result['spans']) == 12
