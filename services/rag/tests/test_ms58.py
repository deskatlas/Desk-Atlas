"""MS58-TC08/09/10/13: missing/mixed evidence fails closed without content."""
import copy
import json
import pytest
from test_ms54 import fixture, record
from rag.identity import canonical_digest
from ms58_acceptance import evaluate, GATES


def bundle():
    data, _, bindings, identity = fixture()
    settings = {'RAG_SYNTHESIS_ENABLED': 'true'}
    identity['config_digest'] = canonical_digest(settings)
    return {'identity': identity, 'settings': settings, 'bindings': bindings, 'records': [],
            'measurements': [], 'attestations': [], 'refusal_target': None}, data


def test_missing_gates_never_certify_release():
    value, _ = bundle()
    result = evaluate(value)
    assert not result['evaluation_ready'] and not result['release_ready']
    assert result['quality']['expected_attempts'] == 66
    assert result['quality']['outcomes']['missing'] == 66
    assert 'EVIDENCE:ms57_synthesis' in result['pending']
    assert 'PERFORMANCE:representative:MISSING_PROFILE' in result['pending']
    assert 'OWNER_REFUSAL_TARGET_PENDING' in result['pending']
    assert 'REVIEWED_SYNTHESIS_SUCCESS_REQUIRED' in result['pending']


def test_attestations_cannot_override_measured_quality_or_missing_profiles():
    value, _ = bundle()
    value['attestations'] = [{'gate': gate, 'status': 'PASS', 'identity_digest': canonical_digest(value['identity']), 'evidence_digest': 'c' * 64} for gate in sorted(GATES)]
    result = evaluate(value)
    assert not result['evaluation_ready']
    assert 'INCOMPLETE_BASELINE' in result['pending']
    assert 'FULL_RENDER_PROFILES_PENDING' in result['pending']
    assert 'RETRIEVAL_TARGET_PENDING' in result['pending']


@pytest.mark.parametrize('field', ['prompt', 'answer', 'source', 'token'])
def test_content_and_unknown_fields_are_rejected(field):
    value, _ = bundle()
    value[field] = 'private content'
    with pytest.raises(ValueError, match='CONTENT_FREE'):
        evaluate(value)


def test_changed_configuration_mixed_identity_and_duplicate_ledger_rejected():
    value, _ = bundle()
    changed = copy.deepcopy(value)
    changed['settings']['RAG_SYNTHESIS_ENABLED'] = 'false'
    with pytest.raises(ValueError, match='CONFIGURATION'):
        evaluate(changed)
    value['attestations'] = [{'gate': 'ms57_synthesis', 'status': 'PASS', 'identity_digest': 'f' * 64, 'evidence_digest': 'c' * 64}]
    with pytest.raises(ValueError, match='LEDGER'):
        evaluate(value)
    value['attestations'][0]['identity_digest'] = canonical_digest(value['identity'])
    value['attestations'] *= 2
    with pytest.raises(ValueError, match='LEDGER'):
        evaluate(value)


def test_fast_refusal_and_synthetic_gateway_timing_are_not_render_acceptance():
    value, data = bundle()
    case = next(c for c in data['cases'] if c['split'] == 'held_out' and c['expected'] == 'answer')
    observed = record(case, value['identity'], value['bindings'])
    observed.update(outcome='unnecessary_refusal', duration_ms=1, review=None, synthesis_status='NOT_ADMITTED')
    value['records'] = [observed]
    result = evaluate(value)
    assert result['quality']['gateway_accepted_p95_ms'] is None
    assert result['performance']['profiles']['representative']['complete_p95_ms'] is None
    assert 'private content' not in json.dumps(result)
    assert not result['release_ready']


def test_one_known_unsafe_answer_blocks_release_regardless_of_aggregate():
    value, data = bundle()
    case = next(c for c in data['cases'] if c['split'] == 'held_out' and c['expected'] == 'answer')
    observed = record(case, value['identity'], value['bindings'])
    observed.update(synthesis_status='ACCEPTED')
    observed['review']['safe'] = False
    value['records'] = [observed]
    result = evaluate(value)
    assert 'DANGEROUS_ACCEPTED_GUIDANCE' in result['pending']
    assert not result['release_ready']
