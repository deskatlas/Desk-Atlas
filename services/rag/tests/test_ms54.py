"""MS54-TC02/03/04/05/07/08: fail closed metrics and frozen label boundaries."""
import copy
from pathlib import Path
import json
import pytest
from ms54_baseline import dataset, classify
from rag.identity import canonical_digest
from rag.reliability import evaluate, validate_dataset, validate_diagnostics


def fixture():
    data, lock = dataset()
    bindings = {u['id']: [canonical_digest(u['id'])] for d in data['documents'] for u in d['units']}
    identity = {'schema_version': 1, 'candidate_revision': 'a' * 40,
                **{key: 'b' * 64 for key in ('source_snapshot', 'answer_model_digest', 'embedding_fingerprint', 'parser_fingerprint', 'config_digest')},
                'case_set_digest': canonical_digest(data['cases']), 'corpus_digest': canonical_digest(bindings),
                'run_id': '00000000-0000-4000-8000-000000000001'}
    return data, lock, bindings, identity


def record(case, identity, bindings):
    return {'attempt_id': canonical_digest(case['id']), 'case_id': case['id'], 'identity': identity,
            'role': case['role'], 'outcome': 'useful_answer', 'duration_ms': 4200, 'queue_ms': 20,
            'stages': {'retrieve': 10}, 'tokens': {'answer_input': 500, 'answer_output': 100},
            'diagnostics': {'schema_version': 1, 'stage': 'serialize', 'failures': [], 'counts': {'candidate_count': len(case['direct_units'])},
                            'ranked_units': [h for u in case['direct_units'] for h in bindings[u]][:6],
                            'closure_units': [h for u in case['direct_units'] + case['dependencies'] for h in bindings[u]][:6]},
            'review': {'accepted': True, 'citations_valid': True, 'conditions_complete': True,
                       'procedure_complete': True, 'safe': True, 'tool_filters_valid': True, 'reviewer_id': 'c' * 64},
            'app_mode': 'production-build', 'measurement': 'gateway_complete'}


def test_dataset_freeze_multilingual_types_and_unseen_paraphrases():
    data, lock, _, _ = fixture()
    assert len(data['documents']) == 9 and len(data['cases']) == 132
    assert validate_dataset(data, lock) == data
    data['cases'][0]['question'] += ' altered'
    with pytest.raises(ValueError, match='FROZEN_DATASET'):
        validate_dataset(data, lock)


def test_missing_attempts_are_not_removed_from_denominator():
    data, lock, bindings, identity = fixture()
    result = evaluate(data, lock, identity, bindings, [])
    assert result['expected_attempts'] == 66 and result['outcomes']['missing'] == 66
    assert result['groups']['overall']['recall_at_6_micro'] == 0
    assert result['groups']['overall']['reviewer_acceptance'] == 0
    assert result['groups']['overall']['unnecessary_refusal_rate'] == 0
    assert result['groups']['overall']['missing_count'] == 66
    assert not result['release_ready']


def test_fast_refusal_does_not_improve_accepted_answer_latency():
    data, lock, bindings, identity = fixture()
    cases = [c for c in data['cases'] if c['split'] == 'held_out' and c['expected'] == 'answer'][:2]
    records = [record(c, identity, bindings) for c in cases]
    records[1].update(outcome='unnecessary_refusal', duration_ms=1, review=None)
    result = evaluate(data, lock, identity, bindings, records)
    assert result['gateway_accepted_p95_ms'] == 4200
    assert result['outcomes']['unnecessary_refusal'] == 1
    assert result['groups']['overall']['unnecessary_refusal_rate'] > 0
    assert 'OWNER_REFUSAL_TARGET_PENDING' in result['pending']


def test_retrieval_and_dependency_coverage_have_separate_denominators():
    data, lock, bindings, identity = fixture()
    case = next(c for c in data['cases'] if c['family'] == 'PROCEDURE' and c['split'] == 'held_out')
    observed = record(case, identity, bindings)
    observed['diagnostics']['closure_units'] = observed['diagnostics']['ranked_units']
    result = evaluate(data, lock, identity, bindings, [observed])
    row = next(r for r in result['cases'] if r['id'] == case['id'])
    assert row['all_direct'] and not row['closure_complete'] and not row['accepted']


def test_multichunk_support_unit_requires_all_chunks_in_top_six():
    data, lock, bindings, identity = fixture()
    case = next(c for c in data['cases'] if c['family'] == 'FACT' and c['split'] == 'held_out')
    bindings['quiet'].append('f' * 64)
    identity['corpus_digest'] = canonical_digest(bindings)
    observed = record(case, identity, bindings)
    observed['diagnostics']['ranked_units'] = bindings['quiet'][:1]
    result = evaluate(data, lock, identity, bindings, [observed])
    assert next(r for r in result['cases'] if r['id'] == case['id'])['hits'] == 0


@pytest.mark.parametrize('change', ['text', 'identity', 'duplicate', 'nan', 'review'])
def test_unsafe_or_mixed_observations_are_rejected(change):
    data, lock, bindings, identity = fixture()
    case = next(c for c in data['cases'] if c['split'] == 'held_out')
    observed = record(case, identity, bindings)
    records = [observed]
    if change == 'text':
        observed['question'] = 'private transcript'
    elif change == 'identity':
        observed['identity'] = {**identity, 'source_snapshot': 'f' * 64}
    elif change == 'duplicate':
        records.append(copy.deepcopy(observed))
    elif change == 'nan':
        observed['duration_ms'] = float('nan')
    else:
        observed['review']['answer'] = 'private answer'
    with pytest.raises(ValueError):
        evaluate(data, lock, identity, bindings, records)


def test_failure_after_retrieval_is_measured_not_relabelled_as_absent_fact():
    data, lock, bindings, identity = fixture()
    case = next(c for c in data['cases'] if c['split'] == 'held_out')
    observed = record(case, identity, bindings)
    observed.update(outcome='unnecessary_refusal', review=None)
    observed['diagnostics']['failures'] = [{'stage': 'grounding', 'reason': 'INCOMPLETE_COVERAGE', 'category': 'verification_failure'}]
    result = evaluate(data, lock, identity, bindings, [observed])
    assert result['failure_breakdown']['grounding:verification_failure:INCOMPLETE_COVERAGE'] == 1
    assert next(r for r in result['cases'] if r['id'] == case['id'])['hits'] == 1


def test_provisional_model_result_cannot_supply_human_acceptance():
    data, lock, bindings, identity = fixture()
    case = next(c for c in data['cases'] if c['split'] == 'held_out')
    observed = record(case, identity, bindings)
    observed['review'] = None
    result = evaluate(data, lock, identity, bindings, [observed])
    assert result['groups']['overall']['reviewer_acceptance'] == 0
    assert 'INDEPENDENT_REVIEW_PENDING' in result['pending']


def test_diagnostics_cannot_persist_arbitrary_failure_body_or_source_text():
    with pytest.raises(ValueError):
        validate_diagnostics({'schema_version': 1, 'stage': 'answer', 'counts': {}, 'ranked_units': [], 'closure_units': [],
                              'failures': [{'stage': 'answer', 'reason': 'private body', 'category': 'service_failure'}]})


def test_schema_error_is_not_a_successful_answer_and_unavailable_tool_is_not_zero():
    case = {'expected': 'answer'}
    assert classify(503, {'error': 'service failure'}, case) == 'error'
    assert classify(200, {'data': {'citations': [], 'tables': []}}, case) == 'unnecessary_refusal'
    assert classify(429, {}, case) == 'capacity_rejection'


def test_prompt_overhead_metrics_are_numeric_request_local_and_bounded():
    from rag import request_timing
    values = {}
    token = request_timing.metrics.set(values)
    try:
        request_timing.model_metric('system_bytes', 123)
        request_timing.model_metric('serialized_model_bytes', 9000)
        request_timing.model_metric('private_text', 'do not persist')
        request_timing.model_metric('output_budget', True)
        assert values == {'system_bytes': 123, 'serialized_model_bytes': 9000}
    finally:
        request_timing.metrics.reset(token)
    assert request_timing.metrics.get() is None
