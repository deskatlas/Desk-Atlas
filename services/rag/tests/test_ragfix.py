"""PRD-F26 / SDD-C21 / QAD-TC44/46: full original evidence on the fast path."""
import asyncio
import hashlib

import pytest
from fastapi import HTTPException
from rag import document_support as support


@pytest.fixture(autouse=True)
def conservative_fixture_tokenizer(monkeypatch):
    # Unit fixtures do not need a downloaded model artifact. Live acceptance
    # uses the hash-verified real tokenizer through the actual service.
    from rag import batched_support
    monkeypatch.setattr(batched_support, 'token_count', lambda text: len(text.encode()))


def source(text):
    return {'chunk_id': 'one', 'heading_path': 'Guide', 'content': text,
            'content_hash': hashlib.sha256(text.encode()).hexdigest()}


def test_draft_schema_does_not_ask_model_to_decide_outcome_or_clarification():
    schema = support.composition_schema(3, 3).model_json_schema()
    assert set(schema['properties']) == {'scope', 'blocks'}
    assert 'outcome' not in schema.get('required', [])
    assert 'clarification' not in schema.get('required', [])
    candidate = support.composition_schema(3, 3).model_validate({
        'scope': 'FACTUAL', 'blocks': [{'kind': 'text', 'text': 'Original rule.', 'support': [0]}]})
    assert candidate.outcome == 'COMPLETE'
    assert candidate.clarification == ''


def test_task_framing_cannot_become_evidence_or_bypass_independent_verification(monkeypatch):
    monkeypatch.setenv('RAG_TASK_FRAMED_DRAFT', 'true')
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        if 'answer' not in data:
            assert list(schema.model_json_schema()['properties'])[:2] == ['original_task', 'participants']
            return schema(scope='FACTUAL', original_task='A visitor reports noise.', participants='Reporter and responsible staff.',
                blocks=[{'kind': 'text', 'text': 'Acknowledge the concern.', 'support': [0]}])
        assert 'original_task' not in data['answer'] and 'participants' not in data['answer']
        assert data['evidence'][0]['text'] == 'Acknowledge the concern.'
        return support.Verification(relevant=True, supported=True, complete=False, consistent=True, safe=True)
    with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
        asyncio.run(support.batched_document_answer('A visitor complains. What do we do?',
            [source('Acknowledge the concern.\n\nEscalate unresolved complaints.')], generate, actor_role='STAFF'))
    assert len(seen) == 2


def test_packet_transport_inherits_headings_without_losing_source_context():
    from rag.batched_support import compact_units
    original = [
        {'i': 0, 'heading': 'Online / Review', 'text': 'First rule.'},
        {'i': 1, 'heading': 'Online / Review', 'text': 'Second rule.',
         'also_at': [{'i': 4, 'heading': 'Online / FAQ'}]},
        {'i': 2, 'heading': 'Counter / Queue', 'text': 'Third rule.'},
    ]
    packed = compact_units(original)
    assert 'heading' not in packed[1]
    heading = None
    restored = []
    for item in packed:
        heading = item.get('heading', heading)
        restored.append({**item, 'heading': heading})
    assert restored == original
    # A new packet always establishes its own complete heading context.
    assert compact_units(original[1:])[0]['heading'] == 'Online / Review'


@pytest.mark.parametrize('complete', [True, False])
def test_batched_drafts_are_verified_against_every_original_unit(complete):
    text = 'Inspect proof.\n\nNever approve without matching the amount.\n\nEscalate unresolved issues.'
    original = support.canonical_units([source(text)])
    seen = []

    async def generate(prompt, data, schema):
        seen.append(data)
        if 'answer' not in data:
            if issubclass(schema, support.Composition):
                return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Inspect proof and match the amount.', 'support': [0, 1]}])
            return schema(draft=[{'text': 'Inspect proof and match the amount.', 'support': [0, 1]}], unresolved=False)
        # The independent verifier must see omitted original text as well as
        # every cited quote. A draft cannot certify its own completeness.
        assert [u['i'] for u in data['units']] == [u['i'] for u in original]
        assert data['evidence'][1]['text'] == original[1]['text']
        return support.Verification(relevant=True, supported=True, complete=complete, consistent=True, safe=True)

    if complete:
        answer = asyncio.run(support.batched_document_answer('How do we review?', [source(text)], generate, actor_role='ADMIN'))
        assert answer['outcome'] == 'COMPLETE'
        assert len(seen) == 2
        assert answer['spans'][1]['quote'] == original[1]['text']
    else:
        with pytest.raises(HTTPException) as error:
            asyncio.run(support.batched_document_answer('How do we review?', [source(text)], generate, actor_role='ADMIN'))
        assert error.value.detail == 'UNRESOLVED_CONTEXT'


def test_batched_path_rejects_fabricated_addresses_before_verification():
    async def generate(prompt, data, schema):
        return support.Composition(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Invented.', 'support': [99]}])
    with pytest.raises(HTTPException) as error:
        asyncio.run(support.batched_document_answer('How?', [source('Inspect proof.')], generate, actor_role='ADMIN'))
    assert error.value.detail == 'INVALID_MODEL_OUTPUT'


def test_distant_omitted_restriction_in_another_packet_prevents_release():
    text = '\n\n'.join(f'Rule {i}: ' + ('background ' * 45) + '.' for i in range(60))
    originals = support.canonical_units([source(text)])
    visited = set()

    async def generate(prompt, data, schema):
        if 'proposals' in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Follow rule zero.', 'support': [0]}])
        if 'answer' not in data:
            if issubclass(schema, support.Composition):
                return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Follow rule zero.', 'support': [0]}] if any(u['i'] == 0 for u in data['units']) else [])
            return schema(draft=[{'text': 'Follow rule zero.', 'support': [0]}] if any(u['i'] == 0 for u in data['units']) else [], unresolved=False)
        visited.update(u['i'] for u in data['units'])
        return support.Verification(relevant=True, supported=True,
                                    complete=not any(u['i'] == len(originals) - 1 for u in data['units']), consistent=True, safe=True)

    with pytest.raises(HTTPException) as error:
        asyncio.run(support.batched_document_answer('Explain the procedure.', [source(text)], generate, actor_role='ADMIN'))
    assert error.value.detail == 'UNRESOLVED_CONTEXT'
    assert visited == {unit['i'] for unit in originals}


@pytest.mark.parametrize('omit_counter', [False, True])
def test_distinct_guides_contribute_before_combined_answer_is_verified(omit_counter):
    inputs = [{**source('Review the submitted online proof.'), 'chunk_id': 'online', 'version_id': 'a', 'title': 'Online guide'},
              {**source('Verify cash received at the counter.'), 'chunk_id': 'counter', 'version_id': 'b', 'title': 'Counter guide'}]
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        if 'answer' not in data:
            assert len(data['units']) == 2
            assert set(data['selected_documents']) == {'Online guide', 'Counter guide'}
            return schema(scope='MULTI_PART', blocks=[{'kind': 'text', 'text': item['text'], 'support': [item['i']]} for item in data['units'] if not omit_counter or item['i'] == 0])
        assert {unit['i'] for unit in data['units']} == {0, 1}
        assert data['uncited_documents'] == (['Counter guide'] if omit_counter else [])
        return support.Verification(relevant=True, supported=True, complete=not omit_counter, consistent=True, safe=True)
    if omit_counter:
        with pytest.raises(HTTPException) as error:
            asyncio.run(support.batched_document_answer('How do we handle both payment channels?', inputs, generate, actor_role='ADMIN'))
        assert error.value.detail == 'UNRESOLVED_CONTEXT'
        return
    result = asyncio.run(support.batched_document_answer('How do we handle both payment channels?', inputs, generate, actor_role='ADMIN'))
    assert result['outcome'] == 'COMPLETE'
    assert len(seen) == 2
    assert {span['chunk_id'] for span in result['spans']} == {'online', 'counter'}


def test_duplicate_originals_keep_cross_document_context_and_strip_draft_addresses():
    inputs = [{**source('Check the amount.'), 'chunk_id': 'online', 'version_id': 'a',
               'title': 'Online', 'heading_path': 'Proof review'},
              {**source('Check the amount.'), 'chunk_id': 'counter', 'version_id': 'b',
               'title': 'Counter', 'heading_path': 'Cash verification'}]
    async def generate(prompt, data, schema):
        assert len(data['units']) == 1
        assert data['units'][0]['heading'] == 'Online / Proof review'
        assert data['units'][0]['also_at'] == [{'i': 1, 'heading': 'Counter / Cash verification'}]
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text',
                'text': 'Check the amount. [i:0-1]', 'support': [1]}])
        assert data['answer']['blocks'][0]['text'] == 'Check the amount.'
        assert data['evidence'] == [{'i': 0, 'original_i': 1, 'text': 'Check the amount.'}]
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    answer = asyncio.run(support.batched_document_answer('What should we check?', inputs, generate, actor_role='ADMIN'))
    assert answer['spans'][0]['chunk_id'] == 'counter'
