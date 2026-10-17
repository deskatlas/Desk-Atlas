"""MS59 / QAD-TC44: useful-answer coverage and bounded context reconsideration."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_assistant import api
from test_ms56 import body
from rag.obligations import amount_requested, has_amount_rule


@pytest.mark.parametrize('query', ['How much should we refund them?', 'Magkano ang cancellation fee?', 'What is the amount?'])
def test_requested_amount_is_not_related_policy(query):
    assert amount_requested(query)
    assert not has_amount_rule('9.3. Cancellation policy\n1. Follow the approved policy.\nDo not promise an unauthorized refund.')


@pytest.mark.parametrize('text', ['Refund 50%.', 'The approved amount is PHP 100.', 'A full refund applies before opening.', 'No refunds after check-in.'])
def test_amount_rule_needs_semantic_scope_check_too(text):
    assert has_amount_rule(text)


def test_amount_gap_cannot_be_hidden_by_a_planner_rewrite(monkeypatch):
    evidence = body()
    evidence.query = 'Explain cancellation policy.'
    evidence.original_query = 'How much should we refund someone?'
    evidence.coverage = api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[])
    evidence.sources[0].content = 'Follow the approved refund policy.'
    evidence.sources[1].content = 'Do not promise a refund without authorization.'
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.answer(evidence, SimpleNamespace(ops=['answer'])))
    assert result['quotes'] == []
    generate.assert_not_awaited()


def test_reconsideration_compares_all_candidates_and_does_not_authorize_pruning(monkeypatch):
    sources = body().sources
    generate = AsyncMock(return_value=api.ScopedContextSelection(p=[0], a=False, coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[])))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.context_selection(api.ContextInput(query='Describe rooms.', sources=sources, contract_version=2, reconsider=True,
        costs=[api.CandidateCost(index=0, source_count=3, bytes=500, complete=True)]), SimpleNamespace(ops=['answer'])))
    payload = generate.call_args.args[1]
    assert len(payload['candidates']) == 2
    assert 'Preserve every contrary rule' in payload['reconsideration']
    assert result['chunk_ids'] == [sources[0].chunk_id]


def test_legacy_context_stays_explicit(monkeypatch):
    generate = AsyncMock(return_value=api.ContextIndexSelection(p=[0], a=False))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.context_selection(api.ContextInput(query='Describe rooms.', sources=body().sources), SimpleNamespace(ops=['answer'])))
    assert set(result) == {'chunk_ids', 'ambiguous'}


def test_planner_inference_schema_describes_optional_search_aids():
    schema = api.Plan.model_json_schema()
    assert schema['properties']['search']['anyOf'][0]['properties']['version']['const'] == 'ms55-v1'
    assert 'search' in schema['required']


def test_invalid_aids_do_not_destroy_a_resolved_followup(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='Handling repeated noise complaints', tools=[], search=None)))
    request = api.PlanInput(message='And if they keep doing it?', recent_context=api.Context(user_turns=['A guest is noisy']), business_date='2026-10-16', timezone='Asia/Manila', search_enabled=True)
    result = asyncio.run(api.plan(request, SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert request.message in result['query']
    assert request.recent_context.user_turns[-1] in result['query']


def test_v3_maps_original_requested_obligations_without_changing_legacy_wire(monkeypatch):
    generate = AsyncMock(return_value=api.ScopeDecision(assessment='Describe rooms; price is missing.', scope='MULTI_PART', clarification='', conflict=False,
        parts=[api.RequestedSupport(request='Room characteristics', p=[0]), api.RequestedSupport(request='Room price amount', p=[])]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.context_selection(api.ContextInput(query='Describe rooms and their price amount', sources=body().sources, contract_version=3), SimpleNamespace(ops=['answer'])))
    assert result['coverage']['outcome'] == 'PARTIAL_GENERAL'
    assert result['obligations'][1]['kind'] == 'AMOUNT'
    assert result['obligations'][1]['status'] == 'UNVERIFIED'
    assert result['obligations'][1]['chunk_ids'] == []


def test_v3_reconsideration_preserves_missing_obligations(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.ContextIndexSelection(p=[0], a=False)))
    request = api.ContextInput(query='Describe rooms and price.', sources=body().sources, contract_version=3, reconsider=True,
        prior_coverage=api.Coverage(scope='MULTI_PART', outcome='PARTIAL_GENERAL', gaps=['Room price']),
        prior_obligations=[api.RequestedObligation(id='o0', request='Room description', kind='FACT', status='SUPPORTED', chunk_ids=['0']),
                           api.RequestedObligation(id='o1', request='Room price', kind='AMOUNT', status='UNVERIFIED', chunk_ids=[])])
    result = asyncio.run(api.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['obligations'][1]['status'] == 'UNVERIFIED'
    assert result['obligations'][1]['chunk_ids'] == []
    assert result['coverage']['gaps'] == ['Room price']
