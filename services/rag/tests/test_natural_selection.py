"""PRD-F26 / SDD-C21 / QAD-TC44: selector invariants at inference boundary."""
import asyncio
import json
import os
import hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from test_assistant import api


def test_scoped_inference_grammar_cannot_select_support_and_declare_it_insufficient(monkeypatch):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        model = AsyncMock(return_value={'done_reason': 'stop', 'message': {'content': json.dumps({
            'assessment': 'The evidence supplies the requested fact.', 'scope': 'FACTUAL',
            'conflict': False, 'clarification': '', 'parts': [{'request': 'Fact', 'p': [0]}]})}})
        monkeypatch.setattr(api, 'verify_model', AsyncMock())
        monkeypatch.setattr(api, 'model_request', model)
        await api.generate('Select support by meaning.', {}, api.ScopeDecision)
        grammar = model.call_args.args[1]['format']
        # Grammar must distinguish successful support from clarification/negative
        # outcomes, rather than asking the small model to obey prose invariants.
        assert list(grammar['properties'])[0] == 'assessment'
        assert 'coverage' not in grammar['properties'] and 'a' not in grammar['properties']
        decision = api.ScopeDecision(assessment='No requested fact is supported.', scope='FACTUAL', conflict=False,
            clarification='', parts=[api.RequestedSupport(request='Price', p=[])])
        assert decision.selection().passages == []
        assert model.call_args.args[1]['options']['num_predict'] >= 384

    monkeypatch.setenv('RAG_ANSWER_DIGEST', 'a' * 64)
    monkeypatch.delenv('RAG_SELECTION_MAX_TOKENS', raising=False)
    asyncio.run(run())


@pytest.mark.parametrize('scope,parts,clarification,conflict,outcome,indexes', [
    ('FACTUAL', [[0, 1], [1]], '', False, 'COMPLETE', [0, 1]),
    ('MULTI_PART', [[0], []], '', False, 'PARTIAL_GENERAL', [0]),
    ('FACTUAL', [[]], '', False, 'INSUFFICIENT', []),
    ('COMPLETE_PROCEDURE', [[0], []], '', False, 'INSUFFICIENT', []),
    ('DOCUMENT_WIDE', [[0], []], '', False, 'INSUFFICIENT', []),
    ('FACTUAL', [[0, 1]], '', True, 'CONFLICT', []),
    ('COMPLETE_PROCEDURE', [[]], 'Which task do you mean?', False, 'CLARIFY', []),
])
def test_requested_support_derives_safe_coverage(scope, parts, clarification, conflict, outcome, indexes):
    decision = api.ScopeDecision(assessment='Request-local evidence mapping.', scope=scope,
        parts=[api.RequestedSupport(request=f'Requested fact {i}', p=p) for i, p in enumerate(parts)],
        clarification=clarification, conflict=conflict)
    selection = decision.selection()
    assert selection.coverage.outcome == outcome
    assert selection.passages == indexes
    assert selection.ambiguous == (outcome == 'CLARIFY')


@pytest.mark.parametrize('question', ['How do I close it?', 'Where can I find them?', 'What is this?', 'Please update that.'])
def test_missing_reference_asks_about_referent(question):
    assert api.unresolved_task_reference(question)


def test_named_task_and_existing_conversation_do_not_require_a_reference_clarification(monkeypatch):
    assert api.unresolved_task_reference('How do I end a customer session?') is None
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='How do I close the cash register?', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(api.PlanInput(message='How do I close it?',
        recent_context=api.Context(user_turns=['Tell me about the cash register.']),
        business_date='2026-10-15', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert result['kind'] == 'DOCUMENT'
    assert generate.call_args.args[1]['user_context'] == [{'turn': 0, 'text': 'Tell me about the cash register.'}]


def test_planning_resolves_intent_before_route_and_keeps_assessment_private():
    grammar = api.Plan.model_json_schema()
    assert next(iter(grammar['properties'])) == 'resolution'
    assert 'resolution' in grammar['required'] and 'clarification' in grammar['required']
    assert grammar['properties']['clarification']['type'] == 'string'
    plan = api.Plan(kind='DOCUMENT', query='May employees propose changes?', tools=[],
                    interpretation='A read-only permission question.', clarification='')
    assert 'interpretation' not in plan.model_dump()
    assert 'resolution' not in plan.model_dump()


def test_standalone_document_search_keeps_original_intent_instead_of_invented_rewrite(monkeypatch):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='How do I publish a diagram?', tools=[]))
    monkeypatch.setattr(api, 'generate', generate)
    question = 'What does the workspace map show?'
    result = asyncio.run(api.plan(api.PlanInput(message=question, recent_context=api.Context(),
        business_date='2026-10-16', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN')))
    assert result['query'] == question
    generate.assert_called_once()


CASES = [
    ('meaning', 'What information can I see in the desk layout view?',
     ['The floorplan viewer displays desk locations and their operational status.'], 'COMPLETE', [0]),
    ('combined', 'Who receives suggestions and who updates the handbook?',
     ['Employees send improvement proposals to management.', 'Management reviews proposals and updates the handbook.'], 'COMPLETE', [0, 1]),
    ('unknown_price', 'What does membership cost?',
     ['Workstations include an adjustable chair and a desk.'], 'INSUFFICIENT', []),
    ('ambiguous', 'How do I close it?',
     ['Staff close the cash register by counting cash and recording the balance.',
      'Staff close a reservation by recording departure and confirming completion.'], 'CLARIFY', []),
    ('partial', 'What equipment is included and what does it cost?',
     ['Workstations include an adjustable chair and a desk.'], 'PARTIAL_GENERAL', [0]),
    ('negative_permission', 'Can employees approve online receipts?',
     ['Staff must not approve online payment proofs. Only administrators may approve them.'], 'COMPLETE', [0]),
    ('procedure_paraphrase', "How do I finish a guest's visit?",
     ['Only staff and administrators may end a visit. First verify the reservation is checked in. Then open the reservation, choose Check Out, and confirm. Verify that it is marked Completed.'], 'COMPLETE', [0]),
]


PLAN_CASES = [
    ('suggestion', 'can we suggest for sop improvement?', [], 'DOCUMENT'),
    ('proposal', 'Are employees allowed to propose revisions to the handbook?', [], 'DOCUMENT'),
    ('feedback', 'Where should I send ideas for making our procedures better?', [], 'DOCUMENT'),
    ('permission', 'Can staff review online payment proofs?', [], 'DOCUMENT'),
    ('taglish', 'Pwede ba kami magbigay ng suggestions para sa SOP?', [], 'DOCUMENT'),
    ('followup', 'Can we suggest improvements to it?', ['Tell me about the operations handbook.'], 'DOCUMENT'),
    ('mutation', 'Approve this payment for me.', [], 'UNSUPPORTED'),
    ('today', 'How many confirmed bookings are scheduled today?', [], 'OPERATIONAL'),
    ('missing_interval', 'Check workspace availability for a booking. What times do you need from me?', [], 'CLARIFY'),
]


@pytest.mark.skipif(os.environ.get('RAG_LIVE_SELECTION') != '1', reason='Opt-in pinned local model smoke')
@pytest.mark.parametrize('name,question,history,kind', PLAN_CASES, ids=[c[0] for c in PLAN_CASES])
def test_live_planner_resolves_intent_before_tool_parameters(name, question, history, kind):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'answer-model.json').read_text())
        os.environ.setdefault('RAG_ANSWER_DIGEST', manifest['manifest_digest'])
        os.environ.setdefault('RAG_MODEL_BATCH_SIZE', '64')
        async with httpx.AsyncClient(base_url=os.environ['OLLAMA_URL'], timeout=45, trust_env=False) as client:
            api.app.state.client = client
            result = await api.plan(api.PlanInput(message=question, recent_context=api.Context(user_turns=history),
                business_date='2026-10-15', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN'))
        assert result['kind'] == kind
        assert 'interpretation' not in result
        if kind == 'DOCUMENT':
            assert result['query'].strip() and not result['tools']
        if kind == 'CLARIFY':
            assert result.get('clarification', '').strip()
    asyncio.run(run())


@pytest.mark.skipif(os.environ.get('RAG_LIVE_SELECTION') != '1', reason='Opt-in pinned local model smoke')
@pytest.mark.parametrize('name,question,texts,outcome,indexes', CASES, ids=[c[0] for c in CASES])
def test_live_natural_evidence_selection(name, question, texts, outcome, indexes, monkeypatch):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        sources = [api.Source(document_id='synthetic', version_id='v', chunk_id=str(i), title='Handbook',
            heading_path='', source_page=None, epoch=1, extraction_method='TEXT',
            content_hash=hashlib.sha256(text.encode()).hexdigest(), content=text) for i, text in enumerate(texts)]
        manifest = json.loads((Path(__file__).resolve().parents[1] / 'answer-model.json').read_text())
        os.environ.setdefault('RAG_ANSWER_DIGEST', manifest['manifest_digest'])
        os.environ.setdefault('RAG_MODEL_BATCH_SIZE', '64')
        async with httpx.AsyncClient(base_url=os.environ['OLLAMA_URL'], timeout=45, trust_env=False) as client:
            api.app.state.client = client
            if name == 'ambiguous':
                plan = await api.plan(api.PlanInput(message=question, recent_context=api.Context(),
                    business_date='2026-10-15', timezone='Asia/Manila'), SimpleNamespace(ops=['answer'], role='ADMIN'))
                if plan['kind'] == 'CLARIFY':
                    assert plan.get('clarification', '').strip()
                    return
            generated = []
            original = api.generate
            async def capture(*args):
                value = await original(*args)
                generated.append(value.model_dump())
                return value
            monkeypatch.setattr(api, 'generate', capture)
            try:
                result = await api.context_selection(api.ContextInput(query=question, sources=sources, contract_version=2), SimpleNamespace(ops=['answer']))
            except Exception:
                pytest.fail(repr(generated))
        assert result['coverage']['outcome'] == outcome, result
        assert sorted(result['chunk_ids']) == [str(i) for i in indexes]
        if outcome == 'CLARIFY':
            assert result['coverage']['clarification'].strip()
        if outcome == 'PARTIAL_GENERAL':
            assert result['coverage']['gaps']
    asyncio.run(run())
