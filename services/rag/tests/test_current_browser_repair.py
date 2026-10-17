"""PRD-F26 / SDD-C20/C21 / QAD-TC44/46: audited caller-pattern regressions."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_assistant import api
from test_ms62 import request_for


@pytest.mark.parametrize('message', [
    "And if they still aren't happy?", 'Someone wants to stay longer. How does that work?',
    'Somebody forgot their stuff here. What now?', 'They ignored me. Now what?',
    'A visitor wants more time. How would I arrange that?',
    'How should I check availability before extending a booking?',
])
def test_advice_never_dispatches_a_carried_data_selection(message, monkeypatch):
    generated = api.Plan(kind='MIXED', query=message, tools=[api.Tool(name='operational_snapshot', args=api.Filters())])
    generate = AsyncMock(return_value=generated)
    monkeypatch.setattr(api, 'generate', generate)
    request = api.PlanInput(message=message, recent_context=api.Context(
        user_turns=['The place is getting noisy. What should I do?'],
        selections=api.Tool(name='operational_snapshot', args=api.Filters())),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=True)
    result = asyncio.run(api.plan(request, SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['kind'] == 'DOCUMENT'
    assert result['tools'] == []
    assert 'selections' not in generate.call_args.args[1]['recent_context']


@pytest.mark.parametrize('message', ["Hi, I'm helping out at the front desk today. Any advice?",
    "I'm new here. Where do I start?", 'Any tips for my first shift?'])
def test_task_free_advice_clarifies_scope(message, monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='Check-in', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message=message, recent_context=api.Context(),
        business_date='2026-10-17', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['kind'] == 'CLARIFY'
    assert result['clarification'].endswith('?')
    generate.assert_not_awaited()


def test_finishing_day_does_not_guess_shift_handover_or_facility_closing(monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='Closing', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message="I'm about to finish for the day. Anything I should remember?",
        recent_context=api.Context(user_turns=['Someone left a bag.']), business_date='2026-10-17', timezone='Asia/Manila'),
        SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['kind'] == 'CLARIFY'
    assert 'shift' in result['clarification'] and 'closing' in result['clarification']


def test_followup_keeps_previous_question_as_context_not_generated_occupancy(monkeypatch):
    prior = 'The place is getting noisy. What should I do?'
    generate = AsyncMock(return_value=api.Plan(kind='OPERATIONAL', query='Current occupancy',
        tools=[api.Tool(name='operational_snapshot', args=api.Filters())]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message='They ignored me. Now what?',
        recent_context=api.Context(user_turns=['An extension request', prior]), business_date='2026-10-17',
        timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert prior in result['query']
    assert 'ignored me' in result['query']
    assert 'occupancy' not in result['query']


def test_knowledge_generation_schema_prohibits_tools_and_operational_routes():
    schema = api.KnowledgePlan.model_json_schema()
    assert schema['properties']['tools']['maxItems'] == 0
    assert set(schema['properties']['kind']['enum']) == {'DOCUMENT', 'CLARIFY', 'UNSUPPORTED'}


def test_disabling_search_aids_keeps_reference_intent_without_emitting_aids(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='Noise follow-up', tools=[])))
    request = api.PlanInput(message='They ignored me. Now what?', recent_context=api.Context(
        user_turns=['The place is getting noisy. What should I do?']),
        business_date='2026-10-17', timezone='Asia/Manila', search_enabled=False)
    result = asyncio.run(api.plan(request, SimpleNamespace(ops=['answer'], role='STAFF')))
    assert 'noisy' in result['query']
    assert 'search' not in result


@pytest.mark.parametrize('history', [['How many bookings today?'], ['How many bookings today?', 'And yesterday?']])
def test_date_followup_preserves_a_real_data_selection(monkeypatch, history):
    generate = AsyncMock(return_value=api.Plan(kind='OPERATIONAL', query='',
        tools=[api.Tool(name='operational_snapshot', args=api.Filters())]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message='And yesterday?',
        recent_context=api.Context(user_turns=history,
            selections=api.Tool(name='booking_report', args=api.Filters(period='today'))),
        business_date='2026-10-17', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert result['tools']
    assert 'selections' in generate.call_args.args[1]['recent_context']
    assert generate.call_args.args[2] is api.Plan


def test_a_date_after_a_topic_change_cannot_reuse_old_data_filters(monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='What happened yesterday?', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    request = api.PlanInput(message='And yesterday?', recent_context=api.Context(
        user_turns=['How many bookings today?', 'A guest is noisy. What should I do?'],
        selections=api.Tool(name='booking_report', args=api.Filters(period='today'))),
        business_date='2026-10-17', timezone='Asia/Manila')
    result = asyncio.run(api.plan(request, SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert not result['tools']
    assert 'selections' not in generate.call_args.args[1]['recent_context']


def test_workflow_scope_cannot_hide_numbered_duties_as_factual(monkeypatch):
    request = request_for('1. Prepare reception.\n2. Check reservations.\n3. Check supplies.')
    request.query = 'What should I do before people start arriving?'
    request.presentation_contract = 'ms60-concise-v1'
    request.coverage = api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[])
    projection = api.MainProjection(p=[0])
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=projection))
    with pytest.raises(api.HTTPException):
        asyncio.run(api.synthesize(request, SimpleNamespace(ops=['answer'])))


def test_general_explanation_without_ordered_steps_is_not_a_full_workflow(monkeypatch):
    from test_ms56 import body
    question = 'Someone wants to stay longer. How does that work?'
    decision = api.ApplicabilityDecision(conditions=[], direct_answer='Follow the published change policy.',
        scope='COMPLETE_PROCEDURE', parts=[api.RequestedSupport(request='Explain extensions', p=[0])], clarification='', conflict=False)
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=decision))
    request = api.ContextInput(query=question, original_query=question, sources=body().sources,
        contract_version=2, reliability_contract='ms60-v1')
    result = asyncio.run(api.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['coverage']['scope'] == 'FACTUAL'


@pytest.mark.parametrize('message', ['How many reservations today?', 'Show current occupancy.',
    'Compare payment totals for last month.', 'Which desks are available now?', 'Show bookings for last week.'])
def test_explicit_data_still_reaches_the_data_planner(message, monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='OPERATIONAL', query='',
        tools=[api.Tool(name='operational_snapshot', args=api.Filters())]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message=message, recent_context=api.Context(),
        business_date='2026-10-17', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert result['kind'] == 'OPERATIONAL'
    assert result['tools']
