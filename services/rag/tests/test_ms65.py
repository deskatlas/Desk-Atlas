"""MS65: General document RAG reliability and evidence contract repair tests."""
import pytest
from app import scope_clarification, Coverage


@pytest.mark.parametrize('question', [
    "I'm new to handling payments. Where do I start?",
    "I'm checking rejected receipts. What should I prioritize?",
    "I need to review booking changes. Any advice?",
])
def test_named_task_is_not_discarded_by_generic_clarification(question):
    assert scope_clarification(question, fresh=True) is None


def test_task_free_start_question_still_requests_scope():
    assert scope_clarification('Where do I start?', fresh=True) is not None


@pytest.mark.parametrize('missing_qualifier', [False, True])
def test_refinement_does_not_reinsert_unselected_text_between_exact_spans(monkeypatch, missing_qualifier):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag import document_support as support
    middle = ('Never approve without a matching amount. ' if missing_qualifier else 'Optional background. ') + ('Background ' * 50) + '.'
    text = 'Inspect proof. ' + middle + ' Record the decision.'
    source = {'chunk_id': 'one', 'content': text, 'heading_path': 'Review',
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    monkeypatch.setitem(support.BUDGET, 'selected_bytes', 300)
    scoped = []
    async def generate(prompt, data, schema):
        if schema is support.ReferenceIntent:
            scoped.append(data['question'])
            return schema(scope='POLICY', task='Inspect proof and record the decision.')
        if issubclass(schema, support.Inspection):
            return support.Inspection(relevant=[0], unresolved=False)
        if schema is support.ReferenceSelection:
            return schema(relevant=[unit['i'] for unit in data['candidates'] if unit['text'] in ('Inspect proof.', 'Record the decision.')])
        if schema is support.DraftSelection:
            assert data['maximum_selected_bytes'] == 300
            return schema(draft=[{'text': unit['text'], 'support': [unit['i']]} for unit in data['candidates'] if unit['text'] in ('Inspect proof.', 'Record the decision.')])
        if issubclass(schema, support.Composition):
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': item['text'], 'support': [item['i']]} for item in data['evidence']])
        return support.Verification(relevant=True, supported=True, complete=not missing_qualifier, consistent=True, safe=True)
    if missing_qualifier:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(support.document_answer('Explain review.', [source], generate))
        assert caught.value.detail == 'UNRESOLVED_CONTEXT'
    else:
        result = asyncio.run(support.document_answer('Explain review.', [source], generate))
        assert [span['quote'] for span in result['spans']] == ['Inspect proof.', 'Record the decision.']
        for span in result['spans']:
            assert text.encode('utf-16-le')[span['start'] * 2:span['end'] * 2].decode('utf-16-le') == span['quote']
    assert scoped == ['Explain review.']


def test_composition_schema_binds_citations_to_supplied_evidence():
    from rag.document_support import composition_schema
    from pydantic import ValidationError
    schema = composition_schema(2)
    assert schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Review proof.', 'support': [1]}])
    with pytest.raises(ValidationError):
        schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Review proof.', 'support': [33]}])


def test_internal_inspection_derives_selection_from_draft_citations():
    from rag.document_support import InternalInspection
    schema = InternalInspection.model_json_schema()
    assert 'relevant' not in schema['properties']
    assert next(iter(schema['properties'])) == 'draft'
    parsed = InternalInspection.model_validate_json('{"draft":[{"text":"Inspect proof.","support":[3,4]},{"text":"Check amount.","support":[4]}],"unresolved":false}')
    assert parsed.relevant == [3, 4]


def test_partition_draft_schema_cannot_cite_another_partition():
    from pydantic import ValidationError
    from rag.document_support import inspection_schema
    schema = inspection_schema([46, 47])
    assert schema(draft=[{'text': 'Inspect proof.', 'support': [46]}], unresolved=False).relevant == [46]
    with pytest.raises(ValidationError):
        schema(draft=[{'text': 'Inspect proof.', 'support': [33]}], unresolved=False)


@pytest.mark.parametrize('fabricated', [False, True])
def test_duplicate_draft_citations_are_normalized_before_independent_verification(fabricated):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag import document_support as support
    text = 'Inspect proof.\n\nMatch the amount.\n\nOptional background.'
    source = {'chunk_id': 'one', 'heading_path': 'Review', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    checked = 0
    async def generate(prompt, data, schema):
        nonlocal checked
        if issubclass(schema, support.Inspection):
            return support.Inspection(relevant=[0, 1, 2], unresolved=False)
        if issubclass(schema, support.Composition):
            return support.Composition(scope='FACTUAL', blocks=[{'kind': 'text',
                'text': 'Inspect proof and match the amount.', 'support': [0, 0, 99 if fabricated else 1]}])
        checked += 1
        assert data['answer']['blocks'][0]['support'] == [0, 1]
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    if fabricated:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert caught.value.detail == 'INVALID_MODEL_OUTPUT'
        assert checked == 0
    else:
        result = asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert result['outcome'] == 'COMPLETE' and checked == 2
        assert result['synthesis']['blocks'][0]['support'] == [0, 1]


@pytest.mark.parametrize('address', [0, 33])
def test_draft_citation_annotations_stay_out_of_main_prose(address):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag import document_support as support
    text = 'Inspect proof.'
    source = {'chunk_id': 'one', 'content': text, 'heading_path': 'Payment',
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if issubclass(schema, support.Inspection):
            return support.Inspection(relevant=[0], unresolved=False)
        if issubclass(schema, support.Composition):
            return schema(scope='FACTUAL', blocks=[{'kind': 'text',
                'text': f'Inspect proof {{support:[{address}]}}.', 'support': [0]}])
        assert data['answer']['blocks'][0]['text'] == text
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    if address:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert caught.value.detail == 'INVALID_MODEL_OUTPUT'
    else:
        result = asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert result['synthesis']['blocks'][0]['text'] == text
        assert result['spans'][0]['quote'] == text


def test_health_advertises_supported_evidence_reader(monkeypatch):
    import asyncio
    import app
    monkeypatch.setattr(app, 'provider', lambda: 'deepinfra')
    monkeypatch.setattr(app, 'answer_model', lambda: 'synthetic')
    result = asyncio.run(app.health(None))
    assert result['evidence_contracts'] == ['ms65-v1']


def test_document_selection_compares_whole_candidate_groups(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    import app
    body = app.ContextInput(query='Review payment evidence.', evidence_contract='ms65-v1', reliability_contract='ms60-v1', sources=[
        app.SelectionSource(chunk_id='a', document_index=0, title='Payment guide', heading_path='Review', content='Inspect proof.'),
        app.SelectionSource(chunk_id='b', document_index=0, title='Payment guide', heading_path='Restriction', content='Match the amount.'),
        app.SelectionSource(chunk_id='c', document_index=1, title='Other guide', heading_path='Help', content='Other topic.')])
    generate = AsyncMock(return_value=app.ContextIndexSelection(p=[0], a=False))
    monkeypatch.setattr(app, 'generate', generate)
    result = asyncio.run(app.context_selection(body, SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert result['chunk_ids'] == ['a']
    documents = generate.call_args.args[1]['documents']
    assert len(documents) == 2
    assert [item['content'] for item in documents[0]['passages']] == ['Inspect proof.', 'Match the amount.']


@pytest.mark.parametrize('index,valid', [(0, True), (1, False)])
def test_document_relevance_selection_maps_only_canonical_candidate_addresses(monkeypatch, index, valid):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from fastapi import HTTPException
    import app
    body = app.ContextInput(query='How can I correct a rejected receipt?', original_query='I rejected it by mistake.',
        evidence_contract='ms65-v1', reliability_contract='ms60-v1',
        sources=[app.SelectionSource(chunk_id='canonical', title='Guide', heading_path='Payments', content='Inspect the proof again.')])
    generate = AsyncMock(return_value=app.ContextIndexSelection(p=[index], a=False))
    monkeypatch.setattr(app, 'generate', generate)
    if valid:
        result = asyncio.run(app.context_selection(body, SimpleNamespace(ops=['answer'])))
        assert result == {'chunk_ids': ['canonical'], 'ambiguous': False}
        assert generate.call_args.args[1]['original_question'] == body.original_query
    else:
        with pytest.raises(HTTPException) as error:
            asyncio.run(app.context_selection(body, SimpleNamespace(ops=['answer'])))
        assert error.value.status_code == 503


def test_shift_monitoring_reaches_retrieval():
    queries = [
        "Hey, I'm new at the front desk. What should I keep an eye on during my shift?",
        "What should I keep an eye on during my shift?",
        "What should I monitor during my shift?",
        "What should I look out for during my shift?",
    ]
    for q in queries:
        clarification = scope_clarification(q, fresh=True)
        assert clarification is None


def test_handover_clarification_distinguished_from_monitoring():
    handover_q = "I'm finishing my shift now."
    clarification = scope_clarification(handover_q, fresh=True)
    assert clarification == 'Are you handing over your shift or closing the facility?'


def test_reconsideration_gap_message_is_truthful(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    import app
    request = app.ContextInput(query='Describe monitoring duties.', original_query='What should I monitor?',
        sources=[app.SelectionSource(chunk_id='canonical', title='Guide', heading_path='Duties', content='Monitor occupancy.')],
        contract_version=3, reliability_contract='ms60-v1', reconsider=True,
        prior_coverage=Coverage(scope='RECOMMENDATION', outcome='COMPLETE', gaps=[]),
        prior_obligations=[app.RequestedObligation(id='o0',request='Monitoring duties',kind='RECOMMENDATION',status='SUPPORTED',chunk_ids=['canonical'])])
    monkeypatch.setattr(app, 'generate', AsyncMock(return_value=app.ContextIndexSelection(p=[], a=False)))
    result = asyncio.run(app.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['chunk_ids'] == []
    assert 'supported capacity' in result['coverage']['gaps'][0]
    assert result['obligations'][0]['status'] == 'UNVERIFIED'


def test_qualified_monitoring_is_not_forced_to_clarify():
    for fresh in (True, False):
        assert scope_clarification('What should I monitor on the payment screen during my shift?', fresh) is None


def test_unqualified_monitoring_can_retrieve_an_overview():
    assert scope_clarification('What should I monitor during my shift?', True) is None


def test_partition_preserves_every_canonical_unit_and_utf16():
    import hashlib
    from rag.document_support import canonical_units, partition
    sources = [{'chunk_id': str(i), 'content': f'Rule {i}: verify the badge. 🌍',
                'content_hash': hashlib.sha256(f'Rule {i}: verify the badge. 🌍'.encode()).hexdigest(),
                'heading_path': 'Operations'} for i in range(40)]
    units = canonical_units(sources)
    assert [u for b in partition(units) for u in b] == units
    assert len(units) == 40
    assert units[0]['end'] == len(sources[0]['content']) + 1


def test_generated_heading_prefix_is_context_not_duplicate_source_evidence():
    import hashlib
    from rag.document_support import canonical_units
    heading = 'Operations 🌍 / Entry'
    body = '# Entry\nNever admit a guest before payment.\n\nKeep the reference private.'
    content = heading + '\n\n' + body
    units = canonical_units([{'chunk_id': 'one', 'heading_path': heading, 'content': content,
                              'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert [u['text'] for u in units] == ['# Entry\nNever admit a guest before payment.', 'Keep the reference private.']
    assert all(u['heading'] == heading for u in units)
    for unit in units:
        assert content.encode('utf-16-le')[unit['start'] * 2:unit['end'] * 2].decode('utf-16-le') == unit['text']


def test_actual_heading_without_generated_prefix_remains_evidence():
    import hashlib
    from rag.document_support import canonical_units
    content = 'Payment prerequisites\nNever admit a guest before payment.'
    units = canonical_units([{'chunk_id': 'one', 'heading_path': 'Payment prerequisites', 'content': content,
                              'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert units[0]['text'] == content


def test_faq_question_and_qualified_answer_are_one_canonical_support_unit():
    import hashlib
    from rag.document_support import canonical_units
    content = '1. May I perform this action without review?\r\n\r\nNo. Review the original request first. 🌍'
    units = canonical_units([{'chunk_id': 'one', 'heading_path': 'Operations', 'content': content,
        'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert len(units) == 1
    assert units[0]['text'] == content
    assert content.encode('utf-16-le')[units[0]['start'] * 2:units[0]['end'] * 2].decode('utf-16-le') == content


def test_adjacent_faq_questions_are_not_combined_as_question_and_answer():
    import hashlib
    from rag.document_support import canonical_units
    content = 'What is allowed?\n\nWho may perform it?\n\nOnly authorized staff.'
    units = canonical_units([{'chunk_id': 'one', 'heading_path': 'Permissions', 'content': content,
        'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert len(units) == 2
    assert units[0]['text'] == 'What is allowed?'
    assert units[1]['text'] == 'Who may perform it?\n\nOnly authorized staff.'


@pytest.mark.parametrize('corrected', [True, False])
def test_invented_inspection_address_gets_one_bounded_correction(corrected):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    import rag.document_support as support
    text = 'Review the request before approval.'
    source = {'chunk_id': 'canonical', 'heading_path': 'Review', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    inspections = 0
    async def generate(prompt, data, schema):
        nonlocal inspections
        if issubclass(schema, support.Inspection):
            inspections += 1
            return support.Inspection(relevant=[0] if corrected and inspections == 2 else [999], unresolved=False)
        if issubclass(schema, support.Composition):
            return support.Composition(scope='FACTUAL', blocks=[{'kind': 'text', 'text': text, 'support': [0]}])
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    if corrected:
        assert asyncio.run(support.document_answer('What should I check?', [source], generate))['outcome'] == 'COMPLETE'
    else:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert caught.value.detail == 'INVALID_MODEL_OUTPUT'
    assert inspections == 2


@pytest.mark.parametrize('corrected', [False, True])
def test_inspection_schema_failure_gets_the_same_single_correction(corrected):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag import document_support as support
    text = 'Inspect the receipt.'
    source = {'chunk_id': 'one', 'heading_path': 'Review', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = 0
    async def generate(prompt, data, schema):
        nonlocal calls
        if issubclass(schema, support.Inspection):
            calls += 1
            if calls == 1 or not corrected:
                raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
            assert data['allowed_indexes'] == [0]
            return schema(draft=[{'text': text, 'support': [0]}], unresolved=False)
        if issubclass(schema, support.Composition):
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': text, 'support': [0]}])
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    if corrected:
        assert asyncio.run(support.document_answer('What should I check?', [source], generate))['outcome'] == 'COMPLETE'
    else:
        with pytest.raises(HTTPException) as failure:
            asyncio.run(support.document_answer('What should I check?', [source], generate))
        assert failure.value.detail == 'INVALID_MODEL_OUTPUT'
    assert calls == 2


def test_many_split_chunks_keep_all_source_bodies_within_unchanged_budget():
    import hashlib
    from rag.document_support import canonical_units, partition, BUDGET
    heading = 'Customer workspace guidance / ' + 'Situational recommendations ' * 5
    sources = []
    for i in range(134):
        body = f'# Scenario {i}\n' + 'Preserve the documented conditions. ' * 10
        content = heading + '\n\n' + body
        sources.append({'chunk_id': str(i), 'heading_path': heading, 'content': content,
                        'content_hash': hashlib.sha256(content.encode()).hexdigest()})
    units = canonical_units(sources)
    bundles = partition(units)
    assert len(bundles) <= BUDGET['bundles'] == 24
    assert len(units) == len(sources)
    assert [u['text'] for u in units] == [s['content'][len(heading) + 2:].strip() for s in sources]


def test_distant_restriction_is_checked_even_when_selector_omits_it():
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection, Composition, Verification
    text = 'Allow access after verification.\n\nNever allow access before confirmed payment.'
    source = {'chunk_id': 'canonical', 'heading_path': 'Procedure', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    checks = 0
    async def generate(prompt, data, schema):
        nonlocal checks
        if issubclass(schema, Inspection):
            return Inspection(relevant=[0], unresolved=False)
        if issubclass(schema, Composition):
            return Composition(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', clarification='',
                               blocks=[{'kind': 'step', 'text': 'Allow access after verification.', 'support': [0]}])
        checks += 1
        return Verification(relevant=True, supported=True, complete=checks == 1, consistent=True, safe=True)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(document_answer('How do I admit a customer?', [source], generate))
    assert caught.value.detail == 'UNRESOLVED_CONTEXT'
    assert checks == 2


def test_more_than_six_chunks_can_supply_one_complete_answer():
    import asyncio
    import hashlib
    from rag.document_support import document_answer, Inspection, Composition, Verification
    sources = [{'chunk_id': str(i), 'content': f'Action {i}.', 'heading_path': 'Procedure',
                'content_hash': hashlib.sha256(f'Action {i}.'.encode()).hexdigest()} for i in range(8)]
    async def generate(prompt, data, schema):
        if issubclass(schema, Inspection):
            return Inspection(relevant=[u['i'] for u in data['units']], unresolved=False)
        if issubclass(schema, Composition):
            return Composition(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', clarification='',
                blocks=[{'kind': 'step', 'text': s['content'], 'support': [i]} for i, s in enumerate(sources)])
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(document_answer('Explain the whole procedure.', sources, generate))
    assert result['outcome'] == 'COMPLETE'
    assert len(result['spans']) == 8
    assert len(result['synthesis']['blocks']) == 8


def test_acceptance_does_not_turn_component_success_into_milestone_completion():
    from test_ms63 import bundle
    from ms65_acceptance import evaluate
    from rag.identity import canonical_digest
    from rag.document_support import BUDGET
    data, lock, value = bundle()
    manifest = {'dataset_digest': lock['dataset_digest'], 'budget_digest': canonical_digest(BUDGET),
                'documents': [], 'conversations': [], 'audit_case_ids': [], 'observations': []}
    report = evaluate(data, lock, value, manifest)
    assert not report['evaluation_ready'] and not report['release_ready']
    assert 'MS65:HELD_OUT_SAMPLE_MINIMA' in report['pending']
    assert 'MS65:SUPPORT_AND_WORK_MEASUREMENTS_MISSING' in report['pending']
    manifest['budget_digest'] = '0' * 64
    with pytest.raises(ValueError, match='STALE_MS65_MANIFEST'):
        evaluate(data, lock, value, manifest)


def test_private_document_endpoint_requires_identity_and_negotiated_contract(monkeypatch):
    import asyncio
    import httpx
    from app import app
    import secrets
    monkeypatch.setenv('RAG_SERVICE_TOKEN', secrets.token_hex(32))
    payload = {'contract': 'ms65-v1', 'query': 'Explain the rule.', 'sources': [{
        'document_id': 'document', 'version_id': 'version', 'chunk_id': 'chunk', 'title': 'Guide',
        'heading_path': 'Rule', 'source_page': None, 'epoch': 1, 'extraction_method': 'TEXT',
        'content_hash': 'a' * 64, 'content': 'Verify the badge.'}]}
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            denied = await client.post('/v1/document-support', json=payload)
            assert denied.status_code == 401
            payload['contract'] = 'unknown'
            invalid = await client.post('/v1/document-support', json=payload)
            assert invalid.status_code == 422
            assert 'Verify the badge' not in invalid.text
    asyncio.run(run())


def test_partition_refuses_aggregate_overflow_without_truncation():
    from fastapi import HTTPException
    from rag.document_support import partition, BUDGET
    units = [{'i': i, 'text': 'x' * 1400} for i in range(200)]
    with pytest.raises(HTTPException) as caught:
        partition(units)
    assert caught.value.detail == 'CONTEXT_BUDGET_EXCEEDED'
    assert len(units) == 200


@pytest.mark.parametrize('missing', [False, True])
def test_internal_reference_is_resolved_across_original_partitions(missing, monkeypatch):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import (document_answer, Inspection, Composition, Verification,
                                      ReferenceResolution, MissingReference)
    import rag.document_support as support
    monkeypatch.setattr(support, 'reference_partitions', lambda units: [[unit] for unit in units])
    text = 'Before approval follow the approval rule.\n\n' + ('Record the reference.' if missing else 'Approval rule: inspect proof and confirm it is valid.')
    source = {'chunk_id': 'canonical', 'heading_path': 'Payments', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if issubclass(schema, Inspection):
            return Inspection(relevant=[u['i'] for u in data['units']], unresolved=True)
        if schema is ReferenceResolution:
            return ReferenceResolution(required_missing=[MissingReference(unit=0,
                reference_quote='Before approval follow the approval rule.', target='approval rule',
                requirement='Approval requires a rule that is absent.')] if missing else [])
        if issubclass(schema, Composition):
            return Composition(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', clarification='',
                blocks=[{'kind': 'step', 'text': 'Inspect proof and confirm it is valid before approval.', 'support': [0, 1]}])
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    if missing:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(document_answer('How do I approve?', [source], generate))
        assert caught.value.detail == 'UNRESOLVED_CONTEXT'
    else:
        assert asyncio.run(document_answer('How do I approve?', [source], generate))['outcome'] == 'COMPLETE'


@pytest.mark.parametrize('conflicting', [False, True])
def test_internal_conflict_requires_independent_same_condition_evidence(conflicting):
    import asyncio
    import hashlib
    import rag.document_support as support
    text = ('Never reconsider rejected receipts.\n\nReconsider rejected receipts.' if conflicting
            else 'Reject invalid receipts.\n\nReconsider a rejected receipt when verified as valid.')
    source = {'chunk_id': 'canonical', 'heading_path': 'Review', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    async def generate(prompt, data, schema):
        if issubclass(schema, support.Inspection):
            return support.Inspection(relevant=[0, 1], unresolved=False)
        if issubclass(schema, support.Composition):
            return support.Composition(scope='FACTUAL',
                blocks=[{'kind': 'text', 'text': 'Reconsider when verified as valid.', 'support': [1]}])
        return support.Verification(relevant=True, supported=True, complete=True, consistent=not conflicting, safe=True)
    if conflicting:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as caught:
            asyncio.run(support.document_answer('Can I reconsider a rejected receipt?', [source], generate))
        assert caught.value.detail == 'CONFLICTING_SOURCES'
    else:
        result = asyncio.run(support.document_answer('Can I reconsider a rejected receipt?', [source], generate))
        assert result['outcome'] == 'COMPLETE'
        assert len(result['spans']) == 1
        assert result['synthesis']['blocks'][0]['support'] == [0]


def test_new_diagnostics_can_account_for_more_than_six_support_chunks():
    from rag.reliability import validate_diagnostics
    value = {'schema_version': 2, 'stage': 'support', 'failures': [],
             'counts': {'bundle_count': 2, 'support_passes': 6, 'support_units': 40},
             'ranked_units': ['a' * 64] * 8, 'closure_units': ['b' * 64] * 40}
    validate_diagnostics(value)
    value['schema_version'] = 1
    with pytest.raises(ValueError):
        validate_diagnostics(value)


def test_source_mutation_is_rejected_before_any_inference():
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import canonical_units
    source = {'chunk_id': 'one', 'content': 'Changed text', 'heading_path': 'Policy',
              'content_hash': hashlib.sha256(b'Original text').hexdigest()}
    with pytest.raises(HTTPException) as caught:
        canonical_units([source])
    assert caught.value.detail == 'INVALID_MODEL_OUTPUT'


@pytest.mark.parametrize('synthesis', [False, True])
def test_exact_mode_and_schema_failure_still_require_independent_checks(synthesis):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection, Composition, Verification
    source = {'chunk_id': 'one', 'content': 'Verify payment before access.', 'heading_path': 'Rule',
              'content_hash': hashlib.sha256(b'Verify payment before access.').hexdigest()}
    checks = []
    async def generate(prompt, data, schema):
        if issubclass(schema, Inspection):
            return Inspection(relevant=[0], unresolved=False)
        if issubclass(schema, Composition):
            assert synthesis
            raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
        checks.append(data)
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(document_answer('Explain access.', [source], generate, synthesis))
    assert result['outcome'] == 'COMPLETE'
    assert result['synthesis']['blocks'][0]['text'] == source['content']
    assert len(checks) == 2


def test_unknown_unit_selection_cannot_fabricate_proof():
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection
    source = {'chunk_id': 'one', 'content': 'Verify the badge.', 'heading_path': 'Rule',
              'content_hash': hashlib.sha256(b'Verify the badge.').hexdigest()}
    async def generate(prompt, data, schema):
        return Inspection(relevant=[42], unresolved=False)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(document_answer('Explain access.', [source], generate))
    assert caught.value.detail == 'INVALID_MODEL_OUTPUT'


def test_aggregate_admission_uses_actual_model_wire_before_inference():
    from rag import request_timing
    state = {'calls': 0, 'bytes': 0, 'output': 0, 'max_calls': 2, 'max_bytes': 300, 'max_output': 50}
    token = request_timing.work.set(state)
    try:
        assert request_timing.reserve_model_work(150, 20)
        assert not request_timing.reserve_model_work(151, 20)
        assert state['calls'] == 1 and state['bytes'] == 150
        assert not request_timing.reserve_model_work(100, 31)
        assert request_timing.reserve_model_work(150, 30)
        assert not request_timing.reserve_model_work(0, 0)
    finally:
        request_timing.work.reset(token)
    assert request_timing.work.get() is None
