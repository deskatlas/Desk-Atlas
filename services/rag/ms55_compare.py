"""MS55-TC10: compare frozen MS54 excerpt-path reports, no model inference.

Run original/semantic, original/lexical, original/fused and expanded/fused with
the same actor/corpus/code. Inputs are content-free reports from ms54_baseline.
No report can activate synthesis or certify missing live/pgvector/review gates.
"""
import argparse
import json
import math
from pathlib import Path

from rag.identity import canonical_digest, valid_identity, SETTINGS
from rag.reliability import OUTCOMES, STAGES, CATEGORIES, REASONS

MODES = ('semantic_original', 'lexical_original', 'fused_original', 'fused_expanded')


def compare(reports):
    if set(reports) != set(MODES):
        raise ValueError('FOUR_COMPARABLE_REPORTS_REQUIRED')
    bundles = reports
    reports = {mode: bundle['report'] for mode, bundle in bundles.items()}
    baseline = reports['semantic_original']
    if not valid_identity(baseline.get('identity')):
        raise ValueError('FROZEN_IDENTITY_REQUIRED')
    comparable = {key: value for key, value in baseline['identity'].items() if key not in {'run_id', 'config_digest'}}
    configurations = set()
    output = {}
    for mode in MODES:
        report = reports[mode]
        identity = report.get('identity')
        settings = bundles[mode]['settings']
        branch, query = mode.split('_')
        if (set(settings) - SETTINGS or settings.get('RAG_HYBRID_RETRIEVAL') not in (True, 'true')
                or settings.get('RAG_HYBRID_MODE') != branch or settings.get('RAG_HYBRID_QUERY_MODE') != query
                or identity.get('config_digest') != canonical_digest(settings)):
            raise ValueError('FROZEN_RETRIEVAL_CONFIG_REQUIRED')
        if {k: v for k, v in settings.items() if k not in {'RAG_HYBRID_MODE', 'RAG_HYBRID_QUERY_MODE'}} != {
                k: v for k, v in bundles['semantic_original']['settings'].items() if k not in {'RAG_HYBRID_MODE', 'RAG_HYBRID_QUERY_MODE'}}:
            raise ValueError('OTHER_SETTINGS_CHANGED')
        if (not valid_identity(identity) or comparable != {key: value for key, value in identity.items() if key not in {'run_id', 'config_digest'}}
                or report.get('dataset_digest') != baseline.get('dataset_digest') or report.get('split') != baseline.get('split')
                or [case['id'] for case in report['cases']] != [case['id'] for case in baseline['cases']]):
            raise ValueError('INCOMPARABLE_RETRIEVAL_RUNS')
        configurations.add(identity['config_digest'])
        numeric = lambda value: value is None or type(value) in (int, float) and math.isfinite(value) and value >= 0
        fields = {'count', 'answerable_count', 'retrieval_count', 'sparse', 'support_unit_count', 'recall_at_6_micro',
                  'recall_at_6_macro', 'all_direct_count', 'closure_complete_count', 'reviewer_acceptance', 'unnecessary_refusal_rate', 'missing_count'}
        for group, values in report['groups'].items():
            if group != 'overall' and group not in {'language:en', 'language:tl', 'language:taglish'} and group not in {
                    'type:' + kind for kind in ('description', 'faq', 'long_sop', 'permissions', 'procedure', 'qualifications', 'table')}:
                raise ValueError('INVALID_METRIC_GROUP')
            if set(values) - fields or any(not (type(value) is bool if key == 'sparse' else numeric(value)) for key, value in values.items()):
                raise ValueError('CONTENT_FREE_METRICS_REQUIRED')
        if any(key not in OUTCOMES | {'missing'} or not numeric(value) for key, value in report['outcomes'].items()):
            raise ValueError('INVALID_OUTCOMES')
        allowed_failures = {stage + ':' + category + ':' + reason for stage in STAGES for category in CATEGORIES for reason in REASONS}
        if any(key not in allowed_failures or not numeric(value) for key, value in report['failure_breakdown'].items()):
            raise ValueError('INVALID_FAILURE_METRICS')
        if any(not numeric(report[key]) for key in ['attempts', 'expected_attempts', 'gateway_accepted_p95_ms', 'gateway_all_p95_ms']):
            raise ValueError('INVALID_COST_METRICS')
        output[mode] = {'groups': report['groups'], 'attempts': report['attempts'], 'expected_attempts': report['expected_attempts'],
                        'accepted_excerpt_p95_ms': report['gateway_accepted_p95_ms'], 'all_attempt_p95_ms': report['gateway_all_p95_ms'],
                        'outcomes': report['outcomes'], 'failure_breakdown': report['failure_breakdown']}
    if len(configurations) != 4:
        raise ValueError('DISTINCT_FROZEN_CONFIGURATIONS_REQUIRED')
    fused = reports['fused_expanded']
    before = {case['id']: case for case in baseline['cases']}
    cohort = [case for case in fused['cases'] if before[case['id']]['direct'] and not before[case['id']]['all_direct']]
    regressions = sum(case['hits'] < before[case['id']]['hits'] for case in fused['cases'])
    return {'schema_version': 1, 'retrieval_config': 'ms55-v1', 'dataset_digest': baseline['dataset_digest'],
            'split': baseline['split'], 'modes': output, 'baseline_missed_questions': len(cohort),
            'recovered_complete_support_questions': sum(case['all_direct'] for case in cohort),
            'regressed_questions': regressions, 'release_ready': False,
            'pending': ['REAL_PGVECTOR_ACCEPTANCE', 'MS55_INDEPENDENT_REVIEW', 'MS54_OWNER_BASELINE_GATE'],
            'note': 'Candidate recall, complete support and excerpt acceptance remain separate. No synthesis activation.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for mode in MODES:
        parser.add_argument('--' + mode.replace('_', '-'), type=Path, required=True)
    args = parser.parse_args()
    try:
        reports = {mode: json.loads(getattr(args, mode).read_text(encoding='utf-8')) for mode in MODES}
        result = compare(reports)
        # Only defined metrics are emitted; no input source bodies or exceptions.
        print(json.dumps(result, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print(json.dumps({'release_ready': False, 'code': 'MS55_COMPARABLE_EVALUATION_PENDING'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
