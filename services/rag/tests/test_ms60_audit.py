"""QAD-TC44 / MS60: malformed clarification cannot suppress supported evidence."""
import pytest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from pydantic import ValidationError
from test_assistant import api
from test_ms56 import body


@pytest.mark.parametrize('text, indexes', [
    ('The user wants permission to confirm an online payment.', [0]),
    ('The user wants permission to confirm an online payment?', []),
    ('Can staff approve online payment proofs?', [0]),
])
def test_rejects_analysis_or_supported_answer_as_clarification(text, indexes):
    with pytest.raises(ValidationError):
        api.ApplicabilityDecision(conditions=[], direct_answer='', scope='FACTUAL',
            parts=[api.RequestedSupport(request='Payment permission', p=indexes)],
            clarification=text, conflict=False)


def test_genuine_unresolved_question_still_clarifies():
    result = api.ScopeDecision(assessment='Payment channel is missing.', scope='FACTUAL',
        parts=[api.RequestedSupport(request='Payment channel', p=[])],
        clarification='Do you mean a kiosk counter payment or an online payment proof?', conflict=False).selection()
    assert result.ambiguous and result.coverage.outcome == 'CLARIFY'
    assert result.passages == []


def test_overflow_reconsideration_is_compact_and_keeps_original_question(monkeypatch):
    generate = AsyncMock(return_value=api.ContextIndexSelection(p=[0], a=False))
    monkeypatch.setattr(api, 'generate', generate)
    request = api.ContextInput(query='Resolved payment question', original_query='Can staff approve online proofs?',
        sources=body().sources, contract_version=2, reliability_contract='ms60-v1', reconsider=True,
        prior_coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[]))
    result = asyncio.run(api.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert generate.await_count == 1
    assert generate.call_args.args[2] is api.ContextIndexSelection
    assert generate.call_args.args[1]['question'] == request.original_query
    assert result['chunk_ids'] == [request.sources[0].chunk_id]


@pytest.mark.parametrize('question, expected', [
    ('They paid on the website. Can I confirm that at the counter?', 'FACTUAL'),
    ('I mean, as staff, am I allowed to approve an online payment proof?', 'FACTUAL'),
    ('Can I get the complete steps for confirming a payment?', 'COMPLETE_PROCEDURE'),
    ('How do I confirm a counter payment?', 'COMPLETE_PROCEDURE'),
])
def test_complete_decision_is_not_presented_as_a_how_to(monkeypatch, question, expected):
    decision = api.ApplicabilityDecision(conditions=[], direct_answer='Only administrators approve online proofs.',
        scope='COMPLETE_PROCEDURE', parts=[api.RequestedSupport(request='Payment permission', p=[0])], clarification='', conflict=False)
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=decision))
    request = api.ContextInput(query=question, original_query=question, sources=body().sources,
                               contract_version=2, reliability_contract='ms60-v1')
    result = asyncio.run(api.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['coverage']['scope'] == expected
    assert result['coverage']['outcome'] == 'COMPLETE'
