"""MS60-TC01/05/08/09/28: applicability and canonical output admission."""
import asyncio
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_assistant import api
from test_ms56 import body


def decision(index):
    return api.ScopeDecision(assessment='Permission depends on intended return.', scope='FACTUAL', clarification='', conflict=False,
                             parts=[api.RequestedSupport(request='Departure with intended return', p=[index])])


def test_reconciliation_replaces_wrong_task_with_applicable_rule(monkeypatch):
    sources = body().sources
    sources[0].content = 'Complete final checkout when the customer finishes.'
    sources[1].content = 'Temporary exit with intended return is re-entry, not final checkout.'
    independent = api.ApplicabilityDecision(conditions=['Intended return'], direct_answer='Use re-entry, not final checkout.', scope='FACTUAL',
        parts=decision(1).parts, clarification='', conflict=False)
    generate = AsyncMock(return_value=independent)
    monkeypatch.setattr(api, 'generate', generate)
    request = api.ContextInput(query='Should I check a guest out when they will return?', sources=sources,
                               contract_version=2, reliability_contract='ms60-v1')
    result = asyncio.run(api.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['chunk_ids'] == [sources[1].chunk_id]
    assert generate.await_count == 1
    reconciliation = generate.call_args.args[1]
    assert len(reconciliation['candidates']) == 2
    assert reconciliation['original_question'] == request.query


def test_packing_preview_detects_six_sources_seven_quotes():
    evidence = body()
    evidence.sources = [evidence.sources[0].model_copy(deep=True) for _ in range(6)]
    for i, source in enumerate(evidence.sources):
        source.chunk_id = str(i)
        source.content = 'A' * 1000 + '\n\n' + 'B' * 1000 if i == 0 else 'Required qualification.'
        source.content_hash = hashlib.sha256(source.content.encode()).hexdigest()
    evidence.groups = [api.EvidenceGroup(id=str(i), chunk_ids=[str(i)], requires=[]) for i in range(6)]
    evidence.required_chunk_ids = [str(i) for i in range(6)]
    cost = api.packing_cost(evidence)
    assert cost['quote_count'] == 7
    assert not cost['fits']
    assert cost['reason'] == 'OUTPUT_BUDGET_EXCEEDED'


@pytest.mark.parametrize('length,fits', [(1500, True), (1501, False)])
def test_preview_uses_utf16_atomic_span_limits(length, fits):
    evidence = body()
    evidence.sources = [evidence.sources[0]]
    evidence.sources[0].content = 'x' * length
    evidence.groups = None
    evidence.required_chunk_ids = None
    assert api.packing_cost(evidence)['fits'] is fits


def test_fast_procedure_cannot_ignore_original_conditions(monkeypatch):
    evidence = body()
    evidence.query = 'How do I check out a guest?'
    evidence.original_query = 'The guest will return after lunch. Do I check them out?'
    evidence.coverage = api.Coverage(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', gaps=[])
    monkeypatch.setattr(api, 'strict_faq_quotes', lambda *args: None)
    monkeypatch.setattr(api, 'strict_procedure_quotes', lambda *args: [{'chunk_id': evidence.sources[0].chunk_id, 'quote': evidence.sources[0].content}])
    check = AsyncMock(return_value=False)
    monkeypatch.setattr(api, 'check_evidence', check)
    result = asyncio.run(api.answer(evidence, SimpleNamespace(ops=['answer'])))
    assert result['quotes'] == []
    assert evidence.original_query in check.call_args.args[0]


@pytest.mark.parametrize('accepted', [True, False])
def test_ms60_complete_closure_requires_independent_applicability(monkeypatch, accepted):
    evidence = body()
    evidence.reliability_contract = 'ms60-v1'
    evidence.original_query = 'Describe the rooms.'
    evidence.coverage = api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[])
    verifier = AsyncMock(return_value=accepted)
    monkeypatch.setattr(api, 'check_evidence', verifier)
    selector = AsyncMock()
    monkeypatch.setattr(api, 'generate', selector)
    result = asyncio.run(api.answer(evidence, SimpleNamespace(ops=['answer'])))
    assert bool(result['quotes']) is accepted
    assert len(verifier.call_args.args[1]) == 2
    selector.assert_not_awaited()


def test_compact_candidate_projection_keeps_full_text_and_requires_contract():
    from pydantic import ValidationError
    sources = [{'chunk_id': 'c', 'title': 'SOP', 'heading_path': 'Staff only', 'content': 'Never approve online proofs as staff.'}]
    with pytest.raises(ValidationError):
        api.ContextInput(query='May staff approve?', sources=sources, contract_version=2)
    request = api.ContextInput(query='May staff approve?', sources=sources, contract_version=2, reliability_contract='ms60-v1')
    assert request.sources[0].content == sources[0]['content']


def test_cost_route_requires_authentication_and_binds_exact_wire(monkeypatch):
    import base64
    import hmac
    import json
    import time
    from uuid import uuid4
    from fastapi.testclient import TestClient
    secret = 's' * 32
    service = 't' * 32
    monkeypatch.setenv('RAG_SERVICE_TOKEN', service)
    monkeypatch.setenv('RAG_CAPABILITY_SECRET', secret)
    monkeypatch.setenv('RAG_SCOPE_ID', 'synthetic')
    now = int(time.time())
    claims = dict(iss='deskatlas', aud='rag', sub=str(uuid4()), role='ADMIN', request_id=str(uuid4()), scope='synthetic',
                  ops=['answer'], iat=now, exp=now + 60, generation=str(uuid4()))
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    raw = json.dumps(body().model_dump())
    # No lifespan/model/network is needed for deterministic authenticated packing.
    client = TestClient(api.app)
    assert client.post('/v1/evidence-cost', content=raw).status_code == 401
    response = client.post('/v1/evidence-cost', content=raw, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + service, 'X-Request-Capability': payload + '.' + signature})
    assert response.status_code == 200
    assert response.json()['binding'] == hashlib.sha256(raw.encode()).hexdigest()
    assert response.json()['quote_count'] == 2
