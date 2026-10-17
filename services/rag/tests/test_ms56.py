"""MS56-TC01..10 / QAD-TC44/45/46: scope and mandatory closure regressions."""
import asyncio
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from test_assistant import api
from rag.evidence_budget import LIMITS


def body():
    texts = ['Interview rooms have desks.', 'Rooms are not soundproof.']
    sources = [api.Source(document_id='d', version_id='v', chunk_id=str(i), title='Rooms', heading_path='',
        source_page=None, epoch=1, extraction_method='TEXT', content_hash=hashlib.sha256(text.encode()).hexdigest(), content=text)
        for i, text in enumerate(texts)]
    return api.AnswerInput(query='Describe interview rooms and their price.', sources=sources,
        groups=[api.EvidenceGroup(id=f'v:{i}', chunk_ids=[str(i)], requires=[]) for i in range(2)],
        required_chunk_ids=['0', '1'], coverage=api.Coverage(scope='MULTI_PART', outcome='PARTIAL_GENERAL', gaps=['Room price']))


@pytest.mark.parametrize('scope', ['COMPLETE_PROCEDURE', 'DOCUMENT_WIDE'])
def test_partial_procedures_and_document_summaries_are_rejected(scope):
    with pytest.raises(ValidationError):
        api.Coverage(scope=scope, outcome='PARTIAL_GENERAL', gaps=['Required steps'])


@pytest.mark.parametrize('outcome,gaps', [('PARTIAL_GENERAL', []), ('COMPLETE', ['Price'])])
def test_coverage_cannot_hide_gaps(outcome, gaps):
    with pytest.raises(ValidationError):
        api.Coverage(scope='FACTUAL', outcome=outcome, gaps=gaps)


def test_answer_selector_cannot_drop_a_separate_contrary_unit():
    evidence = body()
    quotes = api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': evidence.sources[0].content}])
    assert [q['chunk_id'] for q in quotes] == ['0', '1']
    assert quotes[1]['quote'] == 'Rooms are not soundproof.'


def test_scope_bearing_canonical_heading_is_required():
    evidence = body()
    evidence.sources[0].heading_path = 'Admin only'
    evidence.sources[0].content = 'Admin only\n\nRooms have desks.'
    quotes = api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': 'Rooms have desks.'}])
    assert 'Admin only' in quotes[0]['quote']


def test_cycles_and_low_similarity_dependencies_survive():
    evidence = body()
    evidence.required_chunk_ids = ['0']
    evidence.groups[0].requires = ['v:1']
    evidence.groups[1].requires = ['v:0']
    assert len(api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': evidence.sources[0].content}])) == 2
    evidence.groups[1].requires.append('v:missing')
    with pytest.raises(HTTPException) as error:
        api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': evidence.sources[0].content}])
    assert error.value.detail == 'UNRESOLVED_CONTEXT'


@pytest.mark.parametrize('supported', [True, False])
def test_partial_general_has_an_independent_safety_check(monkeypatch, supported):
    evidence = body()
    generate = AsyncMock(side_effect=[api.PassageSelection(p=[0], c=False), api.EvidenceCheck(supported=supported)])
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.answer(evidence, SimpleNamespace(ops=['answer'])))
    assert bool(result['quotes']) is supported
    check = generate.call_args_list[1]
    assert check.args[2] is api.EvidenceCheck
    assert check.args[1]['question'] == evidence.query
    assert check.args[1]['coverage']['gaps'] == ['Room price']
    assert 'Rooms are not soundproof.' in check.args[1]['quotations']
    assert 'missing safety/authorization/permission' in check.args[0]


def test_unknown_required_unit_is_not_silently_ignored():
    evidence = body()
    evidence.required_chunk_ids = ['unknown']
    with pytest.raises(HTTPException) as error:
        api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': evidence.sources[0].content}])
    assert error.value.detail == 'UNRESOLVED_CONTEXT'


def test_overlong_required_item_reports_output_budget():
    evidence = body()
    evidence.sources[1].content = '1. ' + 'x' * LIMITS['quote_utf16']
    with pytest.raises(HTTPException) as error:
        api.complete_evidence_quotes(evidence, [{'chunk_id': '0', 'quote': evidence.sources[0].content}])
    assert error.value.detail == 'OUTPUT_BUDGET_EXCEEDED'


def test_scope_selection_compares_all_candidates_and_maps_original_ids(monkeypatch):
    evidence = body()
    selected = api.ScopedContextSelection(p=[0, 1], a=False,
        coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[]))
    generate = AsyncMock(return_value=selected)
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.context_selection(api.ContextInput(query='What are the rooms like?', sources=evidence.sources, contract_version=2), SimpleNamespace(ops=['answer'])))
    assert result['chunk_ids'] == ['0', '1']
    assert len(generate.call_args.args[1]['candidates']) == 2
    assert result['coverage']['scope'] == 'FACTUAL'


def test_scope_selection_rejects_invented_index(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.ScopedContextSelection(p=[11], a=False,
        coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[]))))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.context_selection(api.ContextInput(query='What rooms?', sources=body().sources, contract_version=2), SimpleNamespace(ops=['answer'])))
    assert error.value.detail == 'INVALID_MODEL_OUTPUT'


def test_legacy_context_keeps_its_exact_response_contract(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.ContextIndexSelection(p=[0], a=False)))
    result = asyncio.run(api.context_selection(api.ContextInput(query='Rooms?', sources=body().sources), SimpleNamespace(ops=['answer'])))
    assert result == {'chunk_ids': ['0'], 'ambiguous': False}
