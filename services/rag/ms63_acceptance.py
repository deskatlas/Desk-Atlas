"""MS63-TC01 through TC10 / QAD-TC44/45/46: offline acceptance ledger.

Consumes content-free observations and externally reviewed synthetic datasets.
Attestations reference inspectable evidence; parsing them cannot prove reviewer
independence. This command never activates features or changes publications.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess

from ms53_acceptance import evaluate as inherited_performance, FIELDS as TIMING_FIELDS
from ms54_baseline import dataset, save, ROOT
from rag.evaluation import percentile
from rag.identity import canonical_digest, freeze_identity, valid_identity, SETTINGS
from rag.reliability import evaluate as quality_evaluate, validate_dataset, digest

LANGUAGES = ('en', 'tl', 'taglish')
PROFILES = ('representative', 'repeat', 'five', 'cold', 'ingestion',
            'retry', 'oversized', 'translation_rejection', 'safe_fallback')
STAGES = {'generation_ms', 'verification_ms', 'final_source_reads_ms', 'transport_render_ms'}
GATES = {
    'independent_domain_language_review', 'conditional_intent_topic_switch',
    'ms61_english_understanding', 'ms62_concise_complete_presentation',
    'staff_normal_auth_lifecycle', 'admin_normal_auth_lifecycle',
    'role_revocation', 'source_withdrawal', 'audience_epoch_proof_access',
    'exact_synthesis_off', 'negotiated_legacy', 'hybrid_semantic_only',
    'rollback_rehearsal', 'publication_installation', 'live_identity_limits',
    'complete_render_capture', 'stress_profile_provenance',
    'typecheck', 'lint', 'test', 'build', 'python',
    'campaign_blocker_disposition', 'privacy_artifact_review',
}
STATUSES = {'met', 'failed', 'blocked', 'unavailable'}
FIELDS = {'identity', 'manifest_digest', 'settings', 'bindings', 'records', 'refusal_target',
          'provenance', 'ledger', 'measurements', 'environment'}
PROVENANCE_FIELDS = {'dataset_digest', 'labels_artifact_digest', 'reviewer_digest',
                     'freeze_artifact_digest', 'partition_artifact_digest', 'tuned_case_ids'}
ENVIRONMENT_FIELDS = {'hardware_artifact_digest', 'runtime_artifact_digest',
                      'cpu_peak_percent', 'memory_peak_bytes', 'gpu_peak_bytes'}
MEASUREMENT_FIELDS = TIMING_FIELDS | {'case_id', 'stages', 'start_ms', 'answer_mode', 'review'}
REVIEW_FIELDS = {'reviewer_digest', 'artifact_digest', 'safe', 'correct'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def fields(value, expected, code):
    require(isinstance(value, dict) and set(value) == expected, code)


def performance(identity, records):
    """Keep inherited sample minima; add actual synchronization and stage checks."""
    require(isinstance(records, list), 'MEASUREMENTS_REQUIRED')
    seen = set()
    for row in records:
        fields(row, MEASUREMENT_FIELDS, 'CONTENT_FREE_MEASUREMENT_REQUIRED')
        require(row['identity'] == identity and digest(row['attempt_id'])
                and isinstance(row['case_id'], str) and re.fullmatch('MS54-[A-Z0-9-]+', row['case_id'])
                and row['attempt_id'] not in seen and row['profile'] in PROFILES
                and row['language'] in LANGUAGES
                and row['outcome'] in {'complete_verified', 'quality_failure', 'timeout',
                    'cancelled', 'capacity_rejection', 'unavailable', 'transport_failure', 'correct_refusal'}
                and row['answer_mode'] in {'concise_main', 'exact_fallback', 'refusal'}
                and row['app_mode'] in {'development', 'production-build'}
                and type(row['actor_slot']) is int and 0 <= row['actor_slot'] < 5
                and type(row['ingestion_active']) is bool
                and all(value is None or digest(value) for value in (row['batch_id'], row['cold_reset_id'])),
                'INVALID_OR_MIXED_MEASUREMENT')
        fields(row['stages'], STAGES, 'STAGE_MEASUREMENTS_REQUIRED')
        percentile([row['submit_to_render_ms'], row['queue_ms'], row['start_ms'],
                    *row['stages'].values()], .95)
        require(row['queue_ms'] <= row['submit_to_render_ms']
                and all(value <= row['submit_to_render_ms'] for value in row['stages'].values()),
                'IMPOSSIBLE_STAGE_DURATION')
        if row['review'] is not None:
            fields(row['review'], REVIEW_FIELDS, 'CONTENT_FREE_REVIEW_REQUIRED')
            require(digest(row['review']['reviewer_digest']) and digest(row['review']['artifact_digest'])
                    and all(type(row['review'][key]) is bool for key in ('safe', 'correct')),
                    'INVALID_MEASUREMENT_REVIEW')
        seen.add(row['attempt_id'])
    # Reuse the published MS-53 definitions, including nearest-rank percentiles.
    base = [{**{key: row[key] for key in TIMING_FIELDS},
             'outcome': 'quality_failure' if row['outcome'] == 'correct_refusal' else row['outcome']} for row in records
            if row['profile'] in {'representative', 'repeat', 'five', 'cold', 'ingestion'}]
    result = inherited_performance(identity, base)
    reasons = set(result['pending'])
    for profile in PROFILES:
        rows = [row for row in records if row['profile'] == profile]
        useful = [row for row in rows if row['outcome'] == 'complete_verified'
                  and row['answer_mode'] != 'refusal' and row['review'] is not None
                  and row['review']['safe'] and row['review']['correct']]
        result['profiles'].setdefault(profile, {})
        result['profiles'][profile].update({
            'attempts': len(rows), 'outcomes': dict(Counter(row['outcome'] for row in rows)),
            'answer_modes': dict(Counter(row['answer_mode'] for row in rows)),
            'reviewed_useful_p50_ms': percentile([row['submit_to_render_ms'] for row in useful], .5),
            'reviewed_useful_p95_ms': percentile([row['submit_to_render_ms'] for row in useful], .95),
            'all_attempts_p95_ms': percentile([row['submit_to_render_ms'] for row in rows], .95),
            'stage_p95_ms': {stage: percentile([row['stages'][stage] for row in rows], .95) for stage in sorted(STAGES)},
        })
        if not rows:
            reasons.add(profile + ':MISSING_PROFILE')
            continue
        if any(row['review'] is None for row in rows):
            reasons.add(profile + ':INDEPENDENT_REVIEW_REQUIRED')
        if any(row['app_mode'] != 'production-build' for row in rows):
            reasons.add(profile + ':DEVELOPMENT_PROFILE')
        if any(row['review'] is not None and (not row['review']['safe'] or not row['review']['correct']) for row in rows):
            reasons.add(profile + ':QUALITY_FAILURE')
        if any(row['outcome'] not in {'complete_verified', 'correct_refusal'} for row in rows):
            reasons.add(profile + ':UNSUCCESSFUL_ATTEMPTS')
        if any((row['outcome'] == 'correct_refusal') != (row['answer_mode'] == 'refusal') for row in rows):
            reasons.add(profile + ':OUTCOME_MODE_MISMATCH')
        if profile in {'representative', 'repeat', 'five'}:
            if len(useful) != len(rows) or any(row['answer_mode'] != 'concise_main' for row in rows):
                reasons.add(profile + ':CONCISE_USEFUL_ANSWERS_REQUIRED')
            # Five-user speed must pass separately for every supported input language.
            for language in LANGUAGES:
                selected = [row for row in useful if row['language'] == language]
                p95 = percentile([row['submit_to_render_ms'] for row in selected], .95)
                if len(selected) < 30 or p95 is None or p95 >= 5000:
                    reasons.add(profile + ':' + language + ':WARM_TARGET_PENDING')
                result['profiles'][profile][language] = {'attempts': sum(row['language'] == language for row in rows),
                                                         'reviewed_useful_p95_ms': p95}
        if profile in {'five', 'ingestion'}:
            batches = {}
            for row in rows:
                batches.setdefault(row['batch_id'], []).append(row)
            # Starts use a shared monotonic clock. A batch label alone is insufficient.
            if any(max(row['start_ms'] for row in batch) - min(row['start_ms'] for row in batch) > 100
                   for batch in batches.values()):
                reasons.add(profile + ':UNSYNCHRONIZED_STARTS')
    result['pending'] = sorted(reasons)
    result['performance_ready'] = not reasons
    return result


def evaluate(data, lock, bundle):
    fields(bundle, FIELDS, 'CONTENT_FREE_ACCEPTANCE_BUNDLE_REQUIRED')
    validate_dataset(data, lock)
    # Dataset text remains in authorized fixtures. Restrict identifiers echoed by
    # inherited reports to machine labels, never free prose or credential strings.
    require(all(isinstance(case['family'], str) and re.fullmatch('[A-Z0-9_]{1,64}', case['family'])
                and case['document_type'] in {'description', 'faq', 'procedure', 'table', 'permissions', 'qualifications', 'long_sop'}
                for case in data['cases']), 'MACHINE_CASE_LABELS_REQUIRED')
    identity, settings = bundle['identity'], bundle['settings']
    require(valid_identity(identity) and isinstance(settings, dict) and not set(settings) - SETTINGS
            and all(type(value) in {str, int, bool} for value in settings.values())
            and identity['config_digest'] == canonical_digest(settings), 'FROZEN_CONFIGURATION_REQUIRED')
    require(bundle['manifest_digest'] == canonical_digest({'identity': identity, 'dataset_digest': lock['dataset_digest']}),
            'FROZEN_MANIFEST_MISMATCH')
    provenance = bundle['provenance']
    fields(provenance, PROVENANCE_FIELDS, 'PROVENANCE_REQUIRED')
    require(provenance['dataset_digest'] == lock['dataset_digest']
            and all(provenance[key] is None or digest(provenance[key]) for key in
                    PROVENANCE_FIELDS - {'dataset_digest', 'tuned_case_ids'})
            and isinstance(provenance['tuned_case_ids'], list)
            and all(isinstance(value, str) for value in provenance['tuned_case_ids'])
            and len(set(provenance['tuned_case_ids'])) == len(provenance['tuned_case_ids'])
            and set(provenance['tuned_case_ids']) <= {case['id'] for case in data['cases']},
            'INVALID_PROVENANCE')
    quality = quality_evaluate(data, lock, identity, bundle['bindings'], bundle['records'],
                               refusal_target=bundle['refusal_target'])
    timing = performance(identity, bundle['measurements'])
    cases = {case['id']: case for case in data['cases']}
    require(all(row['case_id'] in cases and row['language'] == cases[row['case_id']]['language']
                for row in bundle['measurements']), 'MEASUREMENT_SAMPLE_MEMBERSHIP_MISMATCH')
    pending = {'QUALITY:' + reason for reason in quality['pending']
               if reason not in {'LIVE_REPRODUCTION_REQUIRES_AUTHORIZED_RUN', 'FULL_RENDER_PROFILES_PENDING'}}
    pending.update('PERFORMANCE:' + reason for reason in timing['pending'])
    if any(provenance[key] is None for key in PROVENANCE_FIELDS - {'dataset_digest', 'tuned_case_ids'}):
        pending.add('INDEPENDENT_PROVENANCE_PENDING')
    held_out = [case for case in data['cases'] if case['split'] == 'held_out']
    if set(provenance['tuned_case_ids']) & {case['id'] for case in held_out}:
        pending.add('TUNED_HELD_OUT_CASES_REQUIRE_NEW_FROZEN_PARTITION')
    # Explicitly require new post-audit strata; old tuned controls cannot close them.
    for family in ('CONDITIONAL_INTENT', 'TOPIC_SWITCH'):
        for language in LANGUAGES:
            if not any(case['family'] == family and case['language'] == language for case in held_out):
                pending.add('STRATUM:' + family + ':' + language)
    if any(row['app_mode'] != 'production-build' for row in bundle['records']):
        pending.add('PRODUCTION_BUILD_QUALITY_REQUIRED')
    if any(row['outcome'] in {'useful_answer', 'safe_partial'} and row['review'] is not None
           and not row['review']['safe'] for row in bundle['records']):
        pending.add('DANGEROUS_ACCEPTED_GUIDANCE')
    # Non-procedure support completeness is also a gate, regardless of an aggregate score.
    if any(row['accepted'] and row['answerable'] and not row['closure_complete'] for row in quality['cases']):
        pending.add('APPLICABLE_SUPPORT_INCOMPLETE')
    if any(row['accepted'] and row['failures'] for row in quality['cases']):
        pending.add('ACCEPTED_GUIDANCE_WITH_VERIFICATION_FAILURE')
    ledger, seen = [], set()
    require(isinstance(bundle['ledger'], list), 'LEDGER_REQUIRED')
    for entry in bundle['ledger']:
        fields(entry, {'gate', 'status', 'identity_digest', 'evidence_digest'}, 'CONTENT_FREE_LEDGER_REQUIRED')
        require(entry['gate'] in GATES and entry['gate'] not in seen and entry['status'] in STATUSES
                and entry['identity_digest'] == canonical_digest(identity)
                and (entry['evidence_digest'] is None or digest(entry['evidence_digest']))
                and (entry['status'] not in {'met', 'failed'} or digest(entry['evidence_digest'])),
                'INVALID_OR_MIXED_LEDGER')
        ledger.append(entry)
        seen.add(entry['gate'])
    for gate in sorted(GATES - seen):
        ledger.append({'gate': gate, 'status': 'unavailable',
                       'identity_digest': canonical_digest(identity), 'evidence_digest': None})
    pending.update('GATE:' + row['gate'] + ':' + row['status'] for row in ledger if row['status'] != 'met')
    environment = bundle['environment']
    fields(environment, ENVIRONMENT_FIELDS, 'CONTENT_FREE_ENVIRONMENT_REQUIRED')
    for key in ('hardware_artifact_digest', 'runtime_artifact_digest'):
        require(environment[key] is None or digest(environment[key]), 'INVALID_ENVIRONMENT')
    for key in ('cpu_peak_percent', 'memory_peak_bytes', 'gpu_peak_bytes'):
        if environment[key] is not None:
            percentile([environment[key]], .95)
    require(environment['cpu_peak_percent'] is None or environment['cpu_peak_percent'] <= 100,
            'INVALID_RESOURCE_PEAK')
    if any(value is None for value in environment.values()):
        pending.add('HARDWARE_RUNTIME_RESOURCE_EVIDENCE_PENDING')
    modes = {language: dict(Counter(row['synthesis_status'] or 'MISSING' for row in quality['cases']
                                    if row['language'] == language and row['accepted'])) for language in LANGUAGES}
    for language in LANGUAGES:
        if not modes[language].get('ACCEPTED'):
            pending.add('ENGLISH_MAIN_SUCCESS_PENDING:' + language)
    return {'schema_version': 1, 'identity': identity, 'input_digest': canonical_digest(bundle),
            'dataset_digest': lock['dataset_digest'], 'evaluation_ready': not pending,
            'release_ready': False, 'activation': 'SEPARATE_MAINTAINER_AUTHORIZATION_REQUIRED',
            'language_scope': 'en_tl_taglish_input_grounded_english_output',
            'pending': sorted(pending), 'ledger': sorted(ledger, key=lambda row: row['gate']),
            'quality': quality, 'performance': timing, 'accepted_modes_by_input_language': modes,
            'environment': environment, 'provenance': provenance}


def empty_bundle(data, lock, bindings, settings):
    """Freeze only local identity; absent live settings/corpus remain unverified."""
    identity = freeze_identity(ROOT, bindings, data['cases'], settings)
    return {'identity': identity,
            'manifest_digest': canonical_digest({'identity': identity, 'dataset_digest': lock['dataset_digest']}),
            'settings': settings, 'bindings': bindings, 'records': [], 'refusal_target': None,
            'provenance': {'dataset_digest': lock['dataset_digest'], 'tuned_case_ids': [],
                           **{key: None for key in PROVENANCE_FIELDS - {'dataset_digest', 'tuned_case_ids'}}},
            'ledger': [], 'measurements': [], 'environment': dict.fromkeys(ENVIRONMENT_FIELDS)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['freeze', 'report'])
    parser.add_argument('--dataset', type=Path)
    parser.add_argument('--lock', type=Path)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--bindings', type=Path)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        require(bool(args.dataset) == bool(args.lock), 'DATASET_AND_LOCK_REQUIRED')
        if args.dataset:
            data = json.loads(args.dataset.read_text(encoding='utf-8'))
            lock = json.loads(args.lock.read_text(encoding='utf-8'))
            validate_dataset(data, lock)
        else:
            data, lock = dataset()
        if args.action == 'freeze':
            bindings = json.loads(args.bindings.read_text(encoding='utf-8')) if args.bindings else {}
            settings = json.loads(args.settings.read_text(encoding='utf-8')) if args.settings else {}
            bundle = empty_bundle(data, lock, bindings, settings)
        else:
            require(args.bundle is not None, 'BUNDLE_REQUIRED')
            bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        result = evaluate(data, lock, bundle)
        current = freeze_identity(ROOT, bundle['bindings'], data['cases'], bundle['settings'])
        require(all(bundle['identity'][key] == value for key, value in current.items() if key != 'run_id'),
                'FROZEN_CANDIDATE_CHANGED')
        save(args.out, bundle if args.action == 'freeze' else result)
        print(json.dumps({'status': 'FROZEN' if args.action == 'freeze' else 'EVALUATED',
                          'evaluation_ready': result['evaluation_ready'], 'release_ready': False,
                          'pending': result['pending']}, allow_nan=False))
        return 0 if args.action == 'freeze' or result['evaluation_ready'] else 1
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError):
        print(json.dumps({'evaluation_ready': False, 'release_ready': False,
                          'error': 'INVALID_OR_STALE_MS63_INPUT_OR_OUTPUT'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
