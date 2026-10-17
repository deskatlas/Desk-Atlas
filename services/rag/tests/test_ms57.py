"""MS57-TC01..13 / QAD-TC44/45/46: independent bounded inference contracts."""
import asyncio
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from test_assistant import api, AssistantTests
from ms57_compare import compare
from rag.identity import canonical_digest
from uuid import uuid4


def body():
    content = '😀 Rooms have desks. Rooms are not soundproof.'
    source = api.Source(document_id='d', version_id='v', chunk_id='c', title='Rooms', heading_path='', source_page=None,
                        epoch=1, extraction_method='TEXT', content_hash=hashlib.sha256(content.encode()).hexdigest(), content=content)
    return api.SynthesisInput(query='Describe the rooms.', coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[]),
                              sources=[source], spans=[api.SynthesisSpan(chunk_id='c', quote=content[2:], start=3, end=api.wire_length(content))])


def candidate(text='Rooms provide desks but are not soundproof.'):
    return api.SynthesisCandidate(version='ms57-v1', scope='FACTUAL', outcome='COMPLETE', gaps=[],
                                  blocks=[api.SynthesisBlock(kind='text', text=text, support=[0])])


def test_utf16_offsets_are_explicit_and_codepoint_offsets_rejected():
    data = body().model_dump()
    assert data['spans'][0]['start'] == 3
    data['spans'][0]['start'] = 2
    with pytest.raises(ValidationError):
        api.SynthesisInput.model_validate(data)


@pytest.mark.parametrize('change', ['hash', 'quote', 'id', 'end'])
def test_canonical_support_cannot_be_fabricated(change):
    data = body().model_dump()
    if change == 'hash':
        data['sources'][0]['content_hash'] = '0' * 64
    elif change == 'quote':
        data['spans'][0]['quote'] = 'Invented evidence'
    elif change == 'id':
        data['spans'][0]['chunk_id'] = 'invented'
    else:
        data['spans'][0]['end'] += 1
    with pytest.raises(ValidationError):
        api.SynthesisInput.model_validate(data)


@pytest.mark.parametrize('scope', ['COMPLETE_PROCEDURE', 'DOCUMENT_WIDE'])
def test_partial_procedures_are_invalid(scope):
    data = candidate().model_dump()
    data.update(scope=scope, outcome='PARTIAL_GENERAL', gaps=['Permission'])
    with pytest.raises(ValidationError):
        api.SynthesisCandidate.model_validate(data)


@pytest.mark.parametrize('text', ['Rooms have desks but are not soundproof.', 'May desks pero hindi soundproof.',
                                  'The rooms have desks pero hindi soundproof.'])
def test_one_candidate_and_separate_verification_have_no_generator_confidence(monkeypatch, text):
    generated = candidate(text)
    generate = AsyncMock(side_effect=[generated, api.SupportVerdict(supported=[True], complete=True, consistent=True, evidence_safe=True)])
    monkeypatch.setattr(api, 'generate', generate)
    evidence = body()
    result = asyncio.run(api.synthesize(evidence, SimpleNamespace(ops=['answer'])))
    review = api.SupportInput(**evidence.model_dump(), candidate=result)
    verdict = asyncio.run(api.verify_support(review, SimpleNamespace(ops=['answer'])))
    assert verdict['supported'] == [True]
    assert generate.await_count == 2
    assert generate.call_args_list[0].args[2] is api.SynthesisCandidate
    grammar = generate.call_args_list[1].args[2]
    assert issubclass(grammar, api.SupportVerdict)
    assert grammar.model_json_schema()['properties']['supported']['minItems'] == len(generated.blocks)
    assert grammar.model_json_schema()['properties']['supported']['maxItems'] == len(generated.blocks)
    context = generate.call_args_list[1].args[1]
    assert 'sources' not in context and 'tables' not in context
    assert context['evidence'][0]['text'] == evidence.spans[0].quote
    assert 'confidence' not in context['candidate']
    assert 'ENTIRE evidence closure' in generate.call_args_list[1].args[0]


def test_verifier_rejects_wrong_scope_and_out_of_request_support(monkeypatch):
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    evidence = body()
    for changed in [candidate().model_copy(update={'scope': 'RECOMMENDATION'}),
                    candidate().model_copy(update={'blocks': [api.SynthesisBlock(kind='text', text='Claim', support=[1])]})]:
        with pytest.raises(HTTPException) as error:
            asyncio.run(api.verify_support(api.SupportInput(**evidence.model_dump(), candidate=changed), SimpleNamespace(ops=['answer'])))
        assert error.value.detail == 'INVALID_MODEL_OUTPUT'
    generate.assert_not_awaited()


@pytest.mark.parametrize('endpoint', ['synthesize', 'verify_support'])
def test_endpoints_require_answer_capability(endpoint):
    evidence = body() if endpoint == 'synthesize' else api.SupportInput(**body().model_dump(), candidate=candidate())
    with pytest.raises(HTTPException) as error:
        asyncio.run(getattr(api, endpoint)(evidence, SimpleNamespace(ops=[])))
    assert error.value.status_code == 403


def test_procedure_blocks_reconstruct_exact_spans_without_model_retyping(monkeypatch):
    evidence = body()
    evidence.coverage = api.Coverage(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', gaps=[])
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.synthesize(evidence, SimpleNamespace(ops=['answer'])))
    generate.assert_not_awaited()
    assert result['blocks'] == [{'kind': 'step', 'text': span.quote, 'support': [i]} for i, span in enumerate(evidence.spans)]
    assert result['scope'] == 'COMPLETE_PROCEDURE'


def test_omitted_span_is_retained_exactly_before_independent_review(monkeypatch):
    evidence = body()
    text = evidence.sources[0].content
    evidence.spans = []
    for quote in ('Rooms have desks.', 'Rooms are not soundproof.'):
        start = api.wire_length(text[:text.index(quote)])
        evidence.spans.append(api.SynthesisSpan(chunk_id='c', quote=quote, start=start, end=start + api.wire_length(quote)))
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=candidate('Rooms provide desks.')))
    result = asyncio.run(api.synthesize(evidence, SimpleNamespace(ops=['answer'])))
    assert result['blocks'][0]['text'] == 'Rooms provide desks.'
    assert result['blocks'][1] == {'kind': 'bullet', 'text': 'Rooms are not soundproof.', 'support': [1]}
    review = api.SupportInput(**evidence.model_dump(), candidate=result)
    assert len(review.candidate.blocks) == 2


def test_utf16_output_bounds_match_gateway():
    with pytest.raises(ValidationError):
        candidate('😀' * 901)


def reports():
    bundles = {}
    for mode in ('exact', 'synthesis'):
        settings = {'RAG_SYNTHESIS_ENABLED': mode == 'synthesis'}
        identity = {key: 'a' * 64 for key in ('source_snapshot', 'answer_model_digest', 'embedding_fingerprint', 'parser_fingerprint', 'corpus_digest', 'case_set_digest')}
        identity.update(schema_version=1, candidate_revision='a' * 40, config_digest=canonical_digest(settings), run_id=str(uuid4()))
        rows = [{'id': f'case{i}', 'language': lang, 'type': 'description', 'answerable': True, 'accepted': True, 'missing': False,
                 'synthesis_status': 'DISABLED' if mode == 'exact' else 'ACCEPTED' if i == 0 else 'EXACT_FALLBACK'}
                for i, lang in enumerate(('en', 'tl', 'taglish'))]
        bundles[mode] = {'settings': settings, 'report': {'identity': identity, 'dataset_digest': 'b' * 64, 'split': 'held_out',
            'cases': rows, 'groups': {}, 'gateway_all_p95_ms': 4500, 'gateway_accepted_p95_ms': 4000, 'pending': []}}
    return bundles


def test_comparison_separates_reviewed_synthesis_from_fallback_and_language():
    report = compare(reports())
    assert report['modes']['synthesis']['overall']['accepted_synthesis'] == 1
    assert report['modes']['synthesis']['overall']['accepted_fallback'] == 2
    assert report['modes']['synthesis']['by_language']['tl']['accepted_synthesis'] == 0
    assert report['release_ready'] is False


@pytest.mark.parametrize('change', ['snapshot', 'dataset', 'mode', 'settings', 'partition'])
def test_comparison_requires_the_same_frozen_held_out_corpus(change):
    bundles = reports()
    synthesis = bundles['synthesis']
    if change == 'snapshot':
        synthesis['report']['identity']['source_snapshot'] = 'b' * 64
    elif change == 'dataset':
        synthesis['report']['dataset_digest'] = 'c' * 64
    elif change == 'mode':
        synthesis['settings']['RAG_SYNTHESIS_ENABLED'] = False
    elif change == 'settings':
        synthesis['settings']['RAG_MIN_SIMILARITY'] = '.1'
    else:
        synthesis['report']['split'] = 'development'
    with pytest.raises(ValueError):
        compare(bundles)


def test_rejected_latency_and_absent_synthesis_success_cannot_be_hidden():
    bundles = reports()
    bundles['synthesis']['report']['gateway_all_p95_ms'] = 6500
    for row in bundles['synthesis']['report']['cases']:
        row['synthesis_status'] = 'EXACT_FALLBACK'
    result = compare(bundles)
    assert 'NO_REVIEWED_SYNTHESIS_SUCCESS' in result['pending']
    assert 'COMPLETE_PATH_LATENCY_PENDING' in result['pending']


class TestSynthesisHTTP(AssistantTests):
    def test_ms57_requires_service_and_capability_and_rejects_extra_fields(self):
        for path in ('/v1/synthesis', '/v1/support'):
            self.assertEqual(self.client.post(path, json={}).status_code, 401)
        data = body().model_dump()
        data['secret'] = 'hidden-payload'
        response = self.client.post('/v1/synthesis', headers=self.headers(), json=data)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('hidden-payload', response.text)
