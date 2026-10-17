"""MS53-TC14: full-path acceptance cannot hide failed or missing profiles."""
import copy
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from ms53_acceptance import evaluate
from gateway_benchmark import check_answer, document_contract


IDENTITY = {'schema_version': 1, 'candidate_revision': 'a' * 40,
            **{name: 'b' * 64 for name in ('source_snapshot', 'answer_model_digest',
                 'embedding_fingerprint', 'parser_fingerprint', 'config_digest',
                 'corpus_digest', 'case_set_digest')},
            'run_id': '00000000-0000-4000-8000-000000000001'}


def measurements():
    records = []
    def add(profile, language='en', slot=0, batch=None, reset=None):
        records.append({'attempt_id': str(len(records)), 'identity': IDENTITY,
                        'profile': profile, 'language': language, 'outcome': 'complete_verified',
                        'submit_to_render_ms': 4000, 'queue_ms': 20, 'batch_id': batch,
                        'actor_slot': slot, 'cold_reset_id': reset,
                        'ingestion_active': profile == 'ingestion', 'app_mode': 'production-build'})
    for profile in ('representative', 'repeat'):
        for language in ('en', 'tl', 'taglish'):
            for _ in range(30):
                add(profile, language)
    for profile in ('five', 'ingestion'):
        for batch in range(20):
            for slot in range(5):
                add(profile, slot=slot, batch=str(batch))
    for reset in range(5):
        add('cold', reset=str(reset))
    return records


def test_complete_profiles_meet_performance_gate_but_never_release_gate():
    result = evaluate(IDENTITY, measurements())
    assert result['performance_ready'] and not result['release_ready']
    assert result['profiles']['five']['complete_p95_ms'] == 4000


def test_fast_refusal_does_not_count_as_complete_answer():
    records = measurements()
    records[0].update(outcome='quality_failure', submit_to_render_ms=5)
    result = evaluate(IDENTITY, records)
    assert not result['performance_ready']
    assert result['profiles']['representative']['outcomes']['quality_failure'] == 1


def test_missing_language_profile_and_development_are_explicit():
    records = [r for r in measurements() if not (r['profile'] == 'representative' and r['language'] == 'tl')]
    records[0]['app_mode'] = 'development'
    result = evaluate(IDENTITY, records)
    assert 'representative:tl:INSUFFICIENT_SAMPLES' in result['pending']
    assert 'representative:DEVELOPMENT_PROFILE' in result['pending']


def test_five_user_batches_and_cold_resets_cannot_be_relabelled_serial_runs():
    records = measurements()
    for row in records:
        if row['profile'] == 'five':
            row['actor_slot'] = 0
        if row['profile'] == 'cold':
            row['cold_reset_id'] = 'same-reset'
    result = evaluate(IDENTITY, records)
    assert 'five:SYNCHRONIZED_BATCHES_REQUIRED' in result['pending']
    assert 'cold:DISTINCT_CONTROLLED_RESETS_REQUIRED' in result['pending']


@pytest.mark.parametrize('value', [True, -1, float('nan'), float('inf')])
def test_invalid_timings_are_rejected(value):
    records = measurements()
    records[0]['submit_to_render_ms'] = value
    with pytest.raises(ValueError):
        evaluate(IDENTITY, records)


def test_mixed_identity_duplicates_and_content_fields_are_rejected():
    for mutation in ('identity', 'duplicate', 'content'):
        records = copy.deepcopy(measurements())
        if mutation == 'identity':
            records[0]['identity']['source_snapshot'] = 'c' * 64
        elif mutation == 'duplicate':
            records[1]['attempt_id'] = records[0]['attempt_id']
        else:
            records[0]['question'] = 'Private source content must never enter measurements'
        with pytest.raises(ValueError):
            evaluate(IDENTITY, records)


def test_exact_five_seconds_does_not_pass_strict_target():
    records = measurements()
    for row in records:
        row['submit_to_render_ms'] = 5000
    assert not evaluate(IDENTITY, records)['performance_ready']


def test_gateway_benchmark_verifies_current_utf16_source_mapping():
    identifier = '00000000-0000-4000-8000-000000000001'
    citation = {'document_id': identifier, 'version_id': identifier, 'chunk_id': identifier,
                'title': 'Synthetic', 'heading_path': 'Procedure', 'source_page': None,
                'epoch': 1, 'extraction_method': 'TEXT', 'content_hash': 'a' * 64}
    quote = '1. Verify departure.'
    content = '\U0001f4cd\n' + quote
    answer = {'kind': 'DOCUMENT', 'summary': quote, 'citations': [citation],
              'limitations': [], 'interpretation': [], 'tables': [],
              'as_of': '2026-10-15T00:00:00Z', 'knowledge_epoch': 1, 'request_id': identifier,
              'business_timezone': 'Asia/Manila',
              'evidence_spans': [{'chunk_id': identifier, 'quote': quote, 'start': 3, 'end': 3 + len(quote)}]}
    assert document_contract(answer)
    assert not document_contract({**answer, 'business_timezone': 'Invalid/Zone'})
    async def run():
        client = SimpleNamespace(get=AsyncMock(return_value=httpx.Response(200, json={'data': {**citation, 'content': content}})))
        case = {'expected': 'answer', 'required_quotes': [quote], 'version_ids': [identifier]}
        assert await check_answer(client, 'http://localhost:3000/api/assistant/query', {},
                                  httpx.Response(200, json={'data': answer}), identifier, case)
        answer['evidence_spans'][0].update(start=2, end=2 + len(quote))
        assert not await check_answer(client, 'http://localhost:3000/api/assistant/query', {},
                                      httpx.Response(200, json={'data': answer}), identifier, case)
    asyncio.run(run())
