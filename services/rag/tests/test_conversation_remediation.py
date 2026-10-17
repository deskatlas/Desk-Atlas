"""PRD-F26 / MS60-TC25/26 / QAD-TC44: context and concise proof seams."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from pydantic import ValidationError
from test_assistant import api
from test_ms57 import body


def test_context_resolution_precedes_route_and_retains_indexed_latest_turn(monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='How should staff handle repeated loud calls?', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    request = api.PlanInput(message='I asked them twice. Now what?', recent_context=api.Context(user_turns=[
        'What should I prepare before opening?', 'A guest keeps making loud calls. What should I do?']),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True)
    asyncio.run(api.plan(request, SimpleNamespace(ops=['answer'], role='STAFF')))
    payload = generate.call_args.args[1]
    assert payload['user_context'][0] == {'turn': 1, 'text': request.recent_context.user_turns[1]}
    assert list(api.Plan.model_json_schema()['properties'])[0] == 'resolution'


def test_resolved_task_cannot_also_claim_missing_context():
    with pytest.raises(ValidationError):
        api.Plan.model_validate({'kind': 'CLARIFY', 'query': '', 'tools': [],
            'clarification': 'What are they doing?', 'resolution': {
                'turn': 1, 'question': 'How should staff handle repeated noise?', 'distinction': ''}})


def test_fresh_task_has_no_prior_turn_pointer(monkeypatch):
    result = api.Plan(kind='DOCUMENT', query='What should I prepare before opening?', tools=[],
        resolution=api.IntentResolution(turn=0, question='What should I prepare before opening?', distinction='', referents=['opening preparation']))
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=result))
    reply = asyncio.run(api.plan(api.PlanInput(message='First time opening tomorrow. What should I get ready?',
        recent_context=api.Context(), business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['kind'] == 'DOCUMENT' and result.resolution.turn == -1


def test_normal_four_turn_history_fits_existing_planner_capacity(monkeypatch):
    import json
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='How should staff handle lost property?', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    history = ['Hey, first time opening by myself tomorrow. What should I get ready?',
        'Someone keeps taking loud calls and the people around them are getting annoyed. How do I handle that?',
        'I already asked them twice and they just keep doing it. Now what?',
        'May naiwan na tumbler sa desk. Ano gagawin ko dito?']
    asyncio.run(api.plan(api.PlanInput(message=history[-1], recent_context=api.Context(user_turns=history),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    instructions, payload, schema = generate.call_args.args
    wire = {'format': schema.model_json_schema(), 'messages': [{'role': 'system', 'content': instructions},
        {'role': 'user', 'content': api.model_wire(payload).decode('utf-8')}]}
    # Reserve transport metadata in addition to the unchanged context/output guards.
    assert len(api.model_wire(wire)) + 512 < min(api.LIMITS['model_request_bytes'], api.LIMITS['context_tokens'] - 1200 - api.LIMITS['template_headroom'])


def test_unreviewed_translation_is_not_generated(monkeypatch):
    evidence = body().model_dump()
    evidence.update(presentation_contract='ms60-concise-v1', language='tl')
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    with pytest.raises(api.HTTPException) as error:
        asyncio.run(api.synthesize(api.SynthesisInput.model_validate(evidence), SimpleNamespace(ops=['answer'])))
    assert error.value.detail == 'REVIEWED_TRANSLATION_REQUIRED'
    generate.assert_not_awaited()


def test_competing_current_referents_cannot_authorize_a_guessed_route():
    result = api.Plan.model_validate({'kind': 'DOCUMENT', 'query': 'How should I extend a session?', 'tools': [],
        'resolution': {'turn': 0, 'question': 'How should I extend a session?', 'distinction': '',
            'referents': ['the guest requesting an extension', 'the guest leaving early']}})
    assert result.kind == 'CLARIFY' and not result.tools and not result.query
    assert 'extension' in result.clarification and 'leaving early' in result.clarification


def test_context_free_recurrence_requires_a_subject_but_named_task_does_not():
    assert api.unresolved_task_reference('I already asked them twice and they just keep doing it. Now what?')
    assert api.unresolved_task_reference('I asked them twice about the loud calls. Now what?') is None


def test_resolved_english_task_survives_missing_optional_search_metadata(monkeypatch):
    resolution = api.IntentResolution(turn=-1, question='How should staff handle lost property?', distinction='')
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='Changed question', tools=[], resolution=resolution)))
    question = 'May naiwan na tumbler. Ano gagawin ko?'
    result = asyncio.run(api.plan(api.PlanInput(message=question, recent_context=api.Context(), business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['query'] == question
    assert result['search']['original'] == question
    assert result['search']['standalone'] == resolution.question
    assert 'resolution' not in result


def test_english_projection_preserves_selected_canonical_text_and_whole_proof(monkeypatch):
    evidence = body().model_dump()
    evidence['presentation_contract'] = 'ms60-concise-v1'
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.MainProjection(p=[0])))
    result = asyncio.run(api.synthesize(api.SynthesisInput.model_validate(evidence), SimpleNamespace(ops=['answer'])))
    assert result['blocks'][0]['text'] == evidence['spans'][0]['quote']
    assert result['main_blocks'][0]['text'] == evidence['spans'][0]['quote']
    assert result['main_blocks'][0]['support'] == [0]


def test_main_units_preserve_all_heading_scope_for_independent_review():
    import hashlib
    evidence = body().model_dump()
    content = '# SOP\n# Lost property\n# Staff only\n1. Record the item.\n2. Store it securely.'
    evidence['sources'][0].update(title='SOP', heading_path='SOP / Lost property / Staff only', content=content,
        content_hash=hashlib.sha256(content.encode()).hexdigest())
    evidence['spans'] = [{'chunk_id': 'c', 'quote': content, 'start': 0, 'end': len(content)}]
    request = api.SynthesisInput.model_validate(evidence)
    units = api.main_units(request)
    assert [unit['text'] for unit in units] == ['# SOP', '# Lost property', '# Staff only', 'Record the item.', 'Store it securely.']
    assert [unit['action'] for unit in units] == [None, None, None, 0, 1]
    assert request.spans[0].quote == content


def test_main_view_requires_negotiation_and_complete_action_mapping(monkeypatch):
    import hashlib
    evidence = body().model_dump()
    content = '1. Record the item.\n2. Store it securely.'
    evidence['sources'][0].update(content=content, content_hash=hashlib.sha256(content.encode()).hexdigest())
    evidence['spans'] = [{'chunk_id': 'c', 'quote': content, 'start': 0, 'end': len(content)}]
    evidence['coverage']['scope'] = 'COMPLETE_PROCEDURE'
    evidence['candidate'] = {'version': 'ms57-v1', 'scope': 'COMPLETE_PROCEDURE', 'outcome': 'COMPLETE', 'gaps': [],
        'blocks': [{'kind': 'text', 'text': content, 'support': [0]}],
        'main_blocks': [{'kind': 'step', 'text': 'Record the item.', 'support': [0], 'actions': [0]}]}
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    for negotiated in (False, True):
        if negotiated:
            evidence['presentation_contract'] = 'ms60-concise-v1'
        with pytest.raises(api.HTTPException):
            asyncio.run(api.verify_support(api.SupportInput.model_validate(evidence), SimpleNamespace(ops=['answer'])))
    generate.assert_not_awaited()


def test_concise_procedure_review_checks_main_not_exact_fallback(monkeypatch):
    evidence = body().model_dump()
    evidence['coverage']['scope'] = 'COMPLETE_PROCEDURE'
    evidence['presentation_contract'] = 'ms60-concise-v1'
    evidence['candidate'] = {'version': 'ms57-v1', 'scope': 'COMPLETE_PROCEDURE', 'outcome': 'COMPLETE', 'gaps': [],
        'blocks': [{'kind': 'text', 'text': evidence['spans'][0]['quote'], 'support': [0]}],
        'main_blocks': [{'kind': 'text', 'text': 'May desks pero hindi soundproof.', 'support': [0], 'actions': []}]}
    generate = AsyncMock(return_value=api.SupportVerdict(supported=[True], complete=True, consistent=True, evidence_safe=True))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.verify_support(api.SupportInput.model_validate(evidence), SimpleNamespace(ops=['answer'])))
    assert result['complete']
    review = generate.call_args.args[1]['candidate']
    assert review['blocks'] == [['text', 'May desks pero hindi soundproof.', [0], []]]
    assert 'main_blocks' not in review
    grammar = generate.call_args.args[2]
    with pytest.raises(ValidationError):
        grammar(supported=[True], complete=True, consistent=False, evidence_safe=False)
    # A genuine unresolved source problem still has a representable verdict.
    assert not grammar(supported=[False], complete=False, consistent=False, evidence_safe=False).consistent


def test_legacy_source_conflict_verdict_still_reaches_fail_closed_gateway(monkeypatch):
    evidence = body().model_dump()
    evidence['candidate'] = {'version': 'ms57-v1', 'scope': 'FACTUAL', 'outcome': 'COMPLETE', 'gaps': [],
        'blocks': [{'kind': 'text', 'text': 'Rooms have desks.', 'support': [0]}]}
    generate = AsyncMock(return_value=api.SupportVerdict(supported=[True], complete=True, consistent=False, evidence_safe=True))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.verify_support(api.SupportInput.model_validate(evidence), SimpleNamespace(ops=['answer'])))
    assert not result['consistent']
    assert not generate.call_args.args[2].model_validate(result).consistent

