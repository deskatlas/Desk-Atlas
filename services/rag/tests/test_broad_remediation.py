"""PRD-F26 / SDD-C20/C21 / QAD-TC44: broad-question audit regressions."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_assistant import api


def test_declared_knowledge_intent_cannot_dispatch_an_operational_tool():
    plan = api.Plan.model_validate({'kind': 'OPERATIONAL', 'query': 'Walk-in seating',
        'tools': [{'name': 'operational_snapshot', 'args': {}}], 'resolution': {
            'request': 'KNOWLEDGE', 'process': 'walk-in booking', 'referents': ['walk-in guest'],
            'turn': -1, 'question': 'How should staff help a walk-in guest?', 'distinction': ''}})
    assert plan.kind == 'DOCUMENT'
    assert plan.tools == []
    assert plan.query == plan.resolution.question


def test_current_question_is_last_and_prior_query_cannot_replace_it(monkeypatch):
    question = 'Someone left something behind. What do we do?'
    prior = 'What should I pass on when my shift ends?'
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query=prior, tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message=question, recent_context=api.Context(user_turns=[prior]),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert list(generate.call_args.args[1])[-1] == 'message'
    assert result['query'] == question


def test_genuine_reference_can_resolve_to_the_previous_task(monkeypatch):
    prior = 'How should staff handle noise complaints?'
    result = api.Plan(kind='DOCUMENT', query=prior, tools=[], resolution=api.IntentResolution(
        request='KNOWLEDGE', process='noise control', referents=['noise complaint'], turn=0,
        question=prior, distinction=''))
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=result))
    reply = asyncio.run(api.plan(api.PlanInput(message='Can you remind me how to handle that?',
        recent_context=api.Context(user_turns=[prior]), business_date='2026-10-17', timezone='Asia/Manila',
        search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['query'] == prior


@pytest.mark.parametrize('question', [
    'Someone arrived without a booking. How do I help?',
    'A guest needs to leave for a bit. What do I do?',
    'They chose a desk. Is that enough to secure it?',
    'Do they need an account first?',
    'How should I handle a complaint?',
    "What if I can't sort it out myself?",
])
def test_advice_cannot_become_data_or_execution(question, monkeypatch):
    result = api.Plan(kind='OPERATIONAL', query=question, tools=[api.Tool(name='operational_snapshot', args=api.Filters())])
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=result))
    reply = asyncio.run(api.plan(api.PlanInput(message=question, recent_context=api.Context(),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['kind'] == 'DOCUMENT' and reply['tools'] == []


@pytest.mark.parametrize('question', [
    'How many bookings are there today?',
    'How do I check in a guest, and how many are checked in today?',
    'Can you show current availability from 10 to 11?',
    'Show this month payment totals.',
    'Is a desk available right now?',
    'Cancel this reservation for me.',
])
def test_data_mixed_and_execution_requests_are_not_forced_to_knowledge(question):
    assert not api.asks_for_guidance(question)


def test_general_priorities_need_a_task_without_inventing_a_shift_stage(monkeypatch):
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    reply = asyncio.run(api.plan(api.PlanInput(message="I'm covering reception today. What should I focus on?",
        recent_context=api.Context(), business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True),
        SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['kind'] == 'CLARIFY'
    assert reply['clarification'].endswith('?')
    assert not reply['tools']
    generate.assert_not_awaited()


def test_unspecified_fault_asks_for_the_item_instead_of_a_generic_evidence_gap(monkeypatch):
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    reply = asyncio.run(api.plan(api.PlanInput(message="Something in the workspace isn't working. What should I do?",
        recent_context=api.Context(user_turns=['Do they need an account first?']), business_date='2026-10-17',
        timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['kind'] == 'CLARIFY'
    assert 'equipment or part of the workspace' in reply['clarification']
    assert not reply['tools']
    generate.assert_not_awaited()


def test_named_fault_still_searches_published_guidance(monkeypatch):
    question = "The printer isn't working. What should I do?"
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query=question, tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    reply = asyncio.run(api.plan(api.PlanInput(message=question, recent_context=api.Context(),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert reply['kind'] == 'DOCUMENT'
    generate.assert_awaited_once()


def test_model_admission_measures_the_actual_lossless_wire(monkeypatch):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        monkeypatch.setenv('RAG_ANSWER_DIGEST', 'a' * 64)
        monkeypatch.setattr(api, 'verify_model', AsyncMock())
        response = {'message': {'content': '{"p":[0],"a":false}'}}
        inference = AsyncMock(return_value=response)
        monkeypatch.setattr(api, 'model_request', inference)
        content = {'candidates': [{'content': 'Required restriction and qualification.'} for _ in range(45)]}
        await api.generate('Select complete applicable evidence.', content, api.ContextIndexSelection)
        payload = inference.call_args.args[1]
        expected = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        assert api.model_wire(payload) == expected
        assert json.loads(payload['messages'][1]['content']) == content
        assert payload['messages'][1]['content'] == json.dumps(content, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        # Byte-exact boundary: no source text is removed to fit a request.
        monkeypatch.setitem(api.LIMITS, 'model_request_bytes', len(expected) - 1)
        with pytest.raises(api.HTTPException) as error:
            await api.generate('Select complete applicable evidence.', content, api.ContextIndexSelection)
        assert error.value.detail == 'CONTEXT_BUDGET_EXCEEDED'
        assert inference.await_count == 1
    asyncio.run(run())
