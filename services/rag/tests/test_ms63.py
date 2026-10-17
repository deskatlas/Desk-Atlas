"""MS63-TC01 through TC10: synthetic evaluator tests, never release evidence."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from test_ms54 import fixture, record
from rag.identity import canonical_digest
from ms63_acceptance import (evaluate, performance, GATES, PROFILES, STAGES,
                             ENVIRONMENT_FIELDS, PROVENANCE_FIELDS)

CASES = fixture()[0]['cases']


def locked(data):
    return {'schema_version': 1, 'dataset_digest': canonical_digest(data),
            **{split + '_digest': canonical_digest([case for case in data['cases'] if case['split'] == split])
               for split in ('development', 'held_out')}}


def bundle():
    data, lock, bindings, identity = fixture()
    settings = {'RAG_SYNTHESIS_ENABLED': True}
    identity['config_digest'] = canonical_digest(settings)
    value = {'identity': identity, 'settings': settings, 'bindings': bindings,
             'manifest_digest': canonical_digest({'identity': identity, 'dataset_digest': lock['dataset_digest']}),
             'records': [], 'measurements': [], 'refusal_target': None, 'ledger': [],
             'environment': dict.fromkeys(ENVIRONMENT_FIELDS),
             'provenance': {**dict.fromkeys(PROVENANCE_FIELDS), 'dataset_digest': lock['dataset_digest'], 'tuned_case_ids': []}}
    return data, lock, value


def timing(identity, profile='representative', language='en', index=0):
    cases = [case for case in CASES if case['language'] == language and case['split'] == 'held_out']
    return {'identity': identity, 'case_id': cases[index % len(cases)]['id'],
            'attempt_id': canonical_digest([profile, language, index]),
            'profile': profile, 'language': language, 'outcome': 'complete_verified',
            'submit_to_render_ms': 4200, 'queue_ms': 20, 'start_ms': index * 10000,
            'batch_id': None, 'actor_slot': 0, 'cold_reset_id': None,
            'ingestion_active': profile == 'ingestion', 'app_mode': 'production-build',
            'answer_mode': 'concise_main', 'stages': dict.fromkeys(STAGES, 10),
            'review': {'reviewer_digest': 'c' * 64, 'artifact_digest': 'd' * 64, 'safe': True, 'correct': True}}


def complete_performance(identity):
    rows = []
    for profile in PROFILES:
        if profile in {'representative', 'repeat'}:
            rows.extend(timing(identity, profile, language, index) for language in ('en', 'tl', 'taglish') for index in range(30))
        elif profile in {'five', 'ingestion'}:
            for batch in range(20):
                for slot in range(5):
                    row = timing(identity, profile, ('en', 'tl', 'taglish')[(batch * 5 + slot) % 3], batch * 5 + slot)
                    row.update(batch_id=canonical_digest([profile, batch]), actor_slot=slot, start_ms=batch * 10000)
                    rows.append(row)
        elif profile == 'cold':
            for index in range(5):
                row = timing(identity, profile, index=index)
                row['cold_reset_id'] = canonical_digest(index)
                rows.append(row)
        else:
            rows.append(timing(identity, profile))
    return rows


def complete_bundle():
    data, _, value = bundle()
    data['label_review'] = 'approved'
    for language in ('en', 'tl', 'taglish'):
        for previous, family in (('FACT', 'CONDITIONAL_INTENT'), ('FOLLOWUP', 'TOPIC_SWITCH')):
            next(case for case in data['cases'] if case['language'] == language and case['split'] == 'held_out'
                 and case['family'] == previous)['family'] = family
    lock = locked(data)
    identity = value['identity']
    identity['case_set_digest'] = canonical_digest(data['cases'])
    value['manifest_digest'] = canonical_digest({'identity': identity, 'dataset_digest': lock['dataset_digest']})
    value['provenance'] = {key: 'd' * 64 for key in PROVENANCE_FIELDS}
    value['provenance'].update(dataset_digest=lock['dataset_digest'], tuned_case_ids=[])
    value['refusal_target'] = {'maximum_rate': 0, 'owner_approval_digest': 'e' * 64, 'baseline_digest': 'd' * 64}
    value['environment'] = {'hardware_artifact_digest': 'f' * 64, 'runtime_artifact_digest': 'e' * 64,
                            'cpu_peak_percent': 80, 'memory_peak_bytes': 1000, 'gpu_peak_bytes': 0}
    for case in data['cases']:
        if case['split'] != 'held_out':
            continue
        row = record(case, identity, value['bindings'])
        row['synthesis_status'] = 'ACCEPTED'
        if case['expected'] != 'answer':
            row['outcome'] = 'correct_clarification' if case['expected'] == 'clarify' else 'correct_refusal'
            row['synthesis_status'] = 'NOT_ADMITTED'
        value['records'].append(row)
    value['ledger'] = [{'gate': gate, 'status': 'met', 'identity_digest': canonical_digest(identity),
                        'evidence_digest': 'd' * 64} for gate in sorted(GATES)]
    value['measurements'] = complete_performance(identity)
    return data, lock, value


def test_missing_evidence_stays_visible_with_fixed_denominators():
    data, lock, value = bundle()
    result = evaluate(data, lock, value)
    assert result['quality']['outcomes']['missing'] == 66
    assert len(result['ledger']) == len(GATES)
    assert all(row['status'] == 'unavailable' for row in result['ledger'])
    assert 'QUALITY:OWNER_REFUSAL_TARGET_PENDING' in result['pending']
    assert 'INDEPENDENT_PROVENANCE_PENDING' in result['pending']
    assert not result['evaluation_ready'] and not result['release_ready']


def test_complete_synthetic_evidence_tests_positive_path_without_release_authority():
    data, lock, value = complete_bundle()
    result = evaluate(data, lock, value)
    assert result['pending'] == []
    assert result['evaluation_ready'] and not result['release_ready']
    assert result['language_scope'] == 'en_tl_taglish_input_grounded_english_output'
    assert 'translation_review' not in json.dumps(result)


def test_attested_gates_cannot_override_missing_observations():
    data, lock, value = complete_bundle()
    value['records'] = []
    value['measurements'] = []
    result = evaluate(data, lock, value)
    assert not result['evaluation_ready']
    assert 'QUALITY:INCOMPLETE_BASELINE' in result['pending']
    assert 'PERFORMANCE:five:MISSING_PROFILE' in result['pending']


@pytest.mark.parametrize('status', ['failed', 'blocked', 'unavailable'])
def test_gate_states_retained_and_campaign_disposition_cannot_waive_failed_suite(status):
    data, lock, value = complete_bundle()
    next(row for row in value['ledger'] if row['gate'] == 'test')['status'] = status
    result = evaluate(data, lock, value)
    assert 'GATE:test:' + status in result['pending']
    assert not result['evaluation_ready']


@pytest.mark.parametrize('change', ['mixed', 'duplicate', 'prose', 'missing_digest'])
def test_ledger_rejects_mixed_duplicate_and_sensitive_entries(change):
    data, lock, value = complete_bundle()
    row = value['ledger'][0]
    if change == 'mixed':
        row['identity_digest'] = 'f' * 64
    elif change == 'duplicate':
        value['ledger'].append(copy.deepcopy(row))
    elif change == 'prose':
        row['note'] = 'secret-token'
    else:
        row['evidence_digest'] = None
    with pytest.raises(ValueError):
        evaluate(data, lock, value)


def test_tuned_cases_and_unreviewed_labels_never_become_unseen_acceptance():
    data, lock, value = complete_bundle()
    value['provenance']['tuned_case_ids'] = [value['records'][0]['case_id']]
    result = evaluate(data, lock, value)
    assert 'TUNED_HELD_OUT_CASES_REQUIRE_NEW_FROZEN_PARTITION' in result['pending']
    data['label_review'] = 'pending_independent_review'
    lock = locked(data)
    value['provenance']['dataset_digest'] = lock['dataset_digest']
    value['manifest_digest'] = canonical_digest({'identity': value['identity'], 'dataset_digest': lock['dataset_digest']})
    assert 'QUALITY:INDEPENDENT_REVIEW_PENDING' in evaluate(data, lock, value)['pending']


def test_changed_dataset_or_settings_rejected():
    data, lock, value = bundle()
    data['documents'][0]['units'][0]['text'] += ' changed'
    with pytest.raises(ValueError, match='MANIFEST'):
        evaluate(data, locked(data), value)
    data, lock, value = bundle()
    value['settings']['RAG_SYNTHESIS_ENABLED'] = False
    with pytest.raises(ValueError, match='CONFIGURATION'):
        evaluate(data, lock, value)


@pytest.mark.parametrize('change', ['unknown', 'language'])
def test_measurement_sample_membership_and_input_language_cannot_be_relabelled(change):
    data, lock, value = complete_bundle()
    if change == 'unknown':
        value['measurements'][0]['case_id'] = 'MS54-UNKNOWN'
    else:
        value['measurements'][0]['language'] = 'taglish'
    with pytest.raises(ValueError, match='MEMBERSHIP'):
        evaluate(data, lock, value)


def test_unsafe_or_incomplete_accepted_support_blocks_quality():
    data, lock, value = complete_bundle()
    row = next(row for row in value['records'] if row['outcome'] == 'useful_answer')
    row['review']['safe'] = False
    assert 'DANGEROUS_ACCEPTED_GUIDANCE' in evaluate(data, lock, value)['pending']
    row['review']['safe'] = True
    row['diagnostics']['closure_units'] = []
    assert 'APPLICABLE_SUPPORT_INCOMPLETE' in evaluate(data, lock, value)['pending']


def test_safe_exact_fallback_is_separate_from_english_main_success():
    data, lock, value = complete_bundle()
    for row in value['records']:
        row['synthesis_status'] = 'EXACT_FALLBACK'
    result = evaluate(data, lock, value)
    assert all('ENGLISH_MAIN_SUCCESS_PENDING:' + language in result['pending'] for language in ('en', 'tl', 'taglish'))


@pytest.mark.parametrize('change', ['nan', 'bool', 'negative', 'prose', 'duplicate', 'identity', 'stages'])
def test_invalid_measurements_rejected(change):
    _, _, value = bundle()
    row = timing(value['identity'])
    rows = [row]
    if change in {'nan', 'bool', 'negative'}:
        row['submit_to_render_ms'] = {'nan': float('nan'), 'bool': True, 'negative': -1}[change]
    elif change == 'prose':
        row['attempt_id'] = 'private-answer'
    elif change == 'duplicate':
        rows.append(copy.deepcopy(row))
    elif change == 'identity':
        row['identity'] = {**value['identity'], 'source_snapshot': 'f' * 64}
    else:
        row['stages']['generation_ms'] = 5000
    with pytest.raises(ValueError):
        performance(value['identity'], rows)


@pytest.mark.parametrize('profile', ['representative', 'repeat', 'five'])
def test_strict_5000ms_limit_per_language_and_profile(profile):
    _, _, value = bundle()
    rows = complete_performance(value['identity'])
    for row in rows:
        if row['profile'] == profile and row['language'] == 'tl':
            row['submit_to_render_ms'] = 5000
    assert profile + ':tl:WARM_TARGET_PENDING' in performance(value['identity'], rows)['pending']


def test_fast_refusals_fallbacks_and_unreviewed_answers_do_not_improve_useful_latency():
    _, _, value = bundle()
    rows = complete_performance(value['identity'])
    for row in rows:
        if row['profile'] == 'representative':
            row.update(outcome='correct_refusal', answer_mode='refusal', submit_to_render_ms=20)
    result = performance(value['identity'], rows)
    assert result['profiles']['representative']['reviewed_useful_p95_ms'] is None
    assert 'representative:CONCISE_USEFUL_ANSWERS_REQUIRED' in result['pending']
    rows[0].update(outcome='complete_verified', answer_mode='exact_fallback')
    assert 'representative:CONCISE_USEFUL_ANSWERS_REQUIRED' in performance(value['identity'], rows)['pending']


def test_batch_labels_without_simultaneous_starts_and_reused_cold_resets_fail():
    _, _, value = bundle()
    rows = complete_performance(value['identity'])
    next(row for row in rows if row['profile'] == 'five')['start_ms'] += 101
    for row in rows:
        if row['profile'] == 'cold':
            row['cold_reset_id'] = 'a' * 64
    result = performance(value['identity'], rows)
    assert 'five:UNSYNCHRONIZED_STARTS' in result['pending']
    assert 'cold:DISTINCT_CONTROLLED_RESETS_REQUIRED' in result['pending']


@pytest.mark.parametrize('profile', ['retry', 'oversized', 'translation_rejection', 'safe_fallback'])
def test_missing_stress_profiles_cannot_be_waived(profile):
    _, _, value = bundle()
    rows = [row for row in complete_performance(value['identity']) if row['profile'] != profile]
    assert profile + ':MISSING_PROFILE' in performance(value['identity'], rows)['pending']


def test_expected_stress_refusals_are_retained_without_counting_as_useful_answers():
    _, _, value = bundle()
    rows = complete_performance(value['identity'])
    next(row for row in rows if row['profile'] == 'oversized').update(outcome='correct_refusal', answer_mode='refusal')
    result = performance(value['identity'], rows)
    assert result['performance_ready']
    assert result['profiles']['oversized']['outcomes']['correct_refusal'] == 1
    assert result['profiles']['oversized']['reviewed_useful_p95_ms'] is None


def test_cli_redacts_errors_and_never_writes_invalid_input(tmp_path):
    script = Path(__file__).resolve().parents[1] / 'ms63_acceptance.py'
    source = tmp_path / 'invalid.json'
    source.write_text(json.dumps({'token': 'secret-token'}))
    target = tmp_path / 'report.json'
    result = subprocess.run([sys.executable, str(script), 'report', '--bundle', str(source), '--out', str(target)],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 1 and 'secret-token' not in result.stdout + result.stderr
    assert not target.exists()
