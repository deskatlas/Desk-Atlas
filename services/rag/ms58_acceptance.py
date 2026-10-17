"""MS58-TC08/09/10/13: content-free candidate acceptance, never activation.

Reviewer attestations reference separately inspected artifacts. They are not
automatic proof of semantic correctness or authorization to enable synthesis.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
from ms54_baseline import dataset, save, ROOT
from ms53_acceptance import evaluate as performance_evaluate
from rag.identity import canonical_digest, valid_identity, freeze_identity, SETTINGS
from rag.reliability import digest, evaluate as quality_evaluate

GATES = {'ms54_baseline', 'ms55_retrieval_independence', 'ms56_closure', 'ms57_synthesis',
         'semantic_translation_review', 'source_lifecycle', 'parser_publication',
         'portal_accessibility', 'session_privacy', 'mode_restart_rollback',
         'live_reproduction', 'runtime_resources', 'long_report_profile', 'oversized_profile'}
FIELDS = {'identity', 'bindings', 'records', 'settings', 'measurements', 'attestations', 'refusal_target'}


def evaluate(bundle):
    if not isinstance(bundle, dict) or set(bundle) != FIELDS:
        raise ValueError('CONTENT_FREE_ACCEPTANCE_BUNDLE_REQUIRED')
    identity, settings = bundle['identity'], bundle['settings']
    if (not valid_identity(identity) or not isinstance(settings, dict) or set(settings) - SETTINGS
            or any(type(v) not in (str, int, bool) for v in settings.values())
            or identity['config_digest'] != canonical_digest(settings)):
        raise ValueError('FROZEN_CONFIGURATION_REQUIRED')
    data, lock = dataset()
    quality = quality_evaluate(data, lock, identity, bundle['bindings'], bundle['records'],
                               refusal_target=bundle['refusal_target'])
    performance = performance_evaluate(identity, bundle['measurements'])
    identity_digest = canonical_digest(identity)
    attestations = bundle['attestations']
    if not isinstance(attestations, list):
        raise ValueError('EVIDENCE_LEDGER_REQUIRED')
    seen = set()
    for entry in attestations:
        if (not isinstance(entry, dict) or set(entry) != {'gate', 'status', 'identity_digest', 'evidence_digest'}
                or entry['gate'] not in GATES or entry['gate'] in seen
                or entry['status'] not in {'PASS', 'FAIL', 'PENDING'}
                or entry['identity_digest'] != identity_digest or not digest(entry['evidence_digest'])):
            raise ValueError('INVALID_OR_MIXED_EVIDENCE_LEDGER')
        seen.add(entry['gate'])
    passed = {e['gate'] for e in attestations if e['status'] == 'PASS'}
    pending = set(quality['pending'])
    if 'live_reproduction' in passed:
        pending.discard('LIVE_REPRODUCTION_REQUIRES_AUTHORIZED_RUN')
    if performance['performance_ready']:
        pending.discard('FULL_RENDER_PROFILES_PENDING')
    pending.update('PERFORMANCE:' + reason for reason in performance['pending'])
    pending.update('EVIDENCE:' + gate for gate in GATES - passed)
    if any(r['app_mode'] != 'production-build' for r in bundle['records']):
        pending.add('PRODUCTION_BUILD_QUALITY_REQUIRED')
    if settings.get('RAG_SYNTHESIS_ENABLED', False) not in (True, 'true'):
        pending.add('CONTROLLED_SYNTHESIS_EVALUATION_REQUIRED')
    modes = Counter(row.get('synthesis_status') or 'MISSING' for row in quality['cases'] if row['accepted'])
    if not modes['ACCEPTED']:
        pending.add('REVIEWED_SYNTHESIS_SUCCESS_REQUIRED')
    if any(r['outcome'] in {'useful_answer', 'safe_partial'} and r['review'] is not None
           and not r['review']['safe'] for r in bundle['records']):
        pending.add('DANGEROUS_ACCEPTED_GUIDANCE')
    if any(row['failures'] and row['accepted'] and any(f['category'] == 'conflicting_sources' for f in row['failures']) for row in quality['cases']):
        pending.add('POLICY_CONFLICTING_ACCEPTED_GUIDANCE')
    def mode_counts(rows):
        return dict(Counter(row.get('synthesis_status') or 'MISSING' for row in rows if row['accepted']))
    return {'schema_version': 1, 'identity': identity, 'dataset_digest': lock['dataset_digest'],
            'input_digest': canonical_digest(bundle), 'evaluation_ready': not pending,
            'release_ready': False, 'activation': 'SEPARATE_MAINTAINER_AUTHORIZATION_REQUIRED',
            'pending': sorted(pending), 'quality': quality, 'performance': performance,
            'accepted_modes': dict(modes),
            'accepted_modes_by_language': {language: mode_counts([row for row in quality['cases'] if row['language'] == language]) for language in ('en', 'tl', 'taglish')},
            'accepted_modes_by_type': {kind: mode_counts([row for row in quality['cases'] if row['type'] == kind]) for kind in sorted({row['type'] for row in quality['cases']})},
            'evidence_ledger': attestations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        result = evaluate(bundle)
        data, _ = dataset()
        current = freeze_identity(ROOT, bundle['bindings'], data['cases'], bundle['settings'])
        if any(bundle['identity'][key] != value for key, value in current.items() if key != 'run_id'):
            raise ValueError('FROZEN_CANDIDATE_CHANGED')
        save(args.out, result)
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'evaluation_ready': False, 'error': 'INVALID_ACCEPTANCE_INPUT_OR_OUTPUT'}))
        return 1
    print(json.dumps({'evaluation_ready': result['evaluation_ready'], 'release_ready': False,
                      'pending': result['pending']}))
    return 0 if result['evaluation_ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
