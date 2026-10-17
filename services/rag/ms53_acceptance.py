"""MS53-TC14 / QAD-TC46: evaluate content-free submit-to-render measurements.

Gateway-only and fixture timings cannot satisfy this gate. Capture records from
an authorized synthetic publication in the real application, freeze the run
identity first, and retain all attempted outcomes, including failed answers.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

from rag.evaluation import percentile
from rag.identity import valid_identity


PROFILES = ('representative', 'repeat', 'five', 'cold', 'ingestion')
LANGUAGES = ('en', 'tl', 'taglish')
OUTCOMES = {'complete_verified', 'quality_failure', 'timeout', 'cancelled',
            'capacity_rejection', 'unavailable', 'transport_failure'}
FIELDS = {'attempt_id', 'identity', 'profile', 'language', 'outcome',
          'submit_to_render_ms', 'queue_ms', 'batch_id', 'actor_slot',
          'cold_reset_id', 'ingestion_active', 'app_mode'}


def evaluate(identity, records):
    if not valid_identity(identity) or not isinstance(records, list):
        raise ValueError('FROZEN_IDENTITY_AND_RECORDS_REQUIRED')
    seen = set()
    for record in records:
        if (not isinstance(record, dict) or set(record) != FIELDS
                or record['identity'] != identity
                or not isinstance(record['attempt_id'], str)
                or not record['attempt_id'] or record['attempt_id'] in seen
                or record['profile'] not in PROFILES
                or record['language'] not in LANGUAGES
                or record['outcome'] not in OUTCOMES
                or record['app_mode'] not in {'development', 'production-build'}
                or type(record['actor_slot']) is not int
                or not 0 <= record['actor_slot'] < 5
                or type(record['ingestion_active']) is not bool
                or any(value is not None and (not isinstance(value, str) or not value)
                       for value in (record['batch_id'], record['cold_reset_id']))):
            raise ValueError('INVALID_OR_MIXED_MEASUREMENT')
        # Reject NaN, negative values and booleans through the shared validator.
        percentile([record['submit_to_render_ms'], record['queue_ms']], .95)
        seen.add(record['attempt_id'])
    groups = {}
    reasons = []
    for profile in PROFILES:
        selected = [r for r in records if r['profile'] == profile]
        successful = [r for r in selected if r['outcome'] == 'complete_verified']
        values = [r['submit_to_render_ms'] for r in successful]
        groups[profile] = {
            'attempts': len(selected), 'outcomes': dict(Counter(r['outcome'] for r in selected)),
            'complete_p50_ms': percentile(values, .5), 'complete_p95_ms': percentile(values, .95),
            'all_attempts_p95_ms': percentile([r['submit_to_render_ms'] for r in selected], .95),
            'queue_p95_ms': percentile([r['queue_ms'] for r in selected], .95),
        }
        if not selected:
            reasons.append(profile + ':MISSING_PROFILE')
            continue
        if any(r['app_mode'] != 'production-build' for r in selected):
            reasons.append(profile + ':DEVELOPMENT_PROFILE')
        if len(successful) != len(selected):
            reasons.append(profile + ':UNSUCCESSFUL_ATTEMPTS')
        if profile in {'representative', 'repeat'}:
            for language in LANGUAGES:
                rows = [r for r in selected if r['language'] == language]
                if len(rows) < 30:
                    reasons.append(profile + ':' + language + ':INSUFFICIENT_SAMPLES')
                times = [r['submit_to_render_ms'] for r in rows if r['outcome'] == 'complete_verified']
                p95 = percentile(times, .95)
                groups[profile][language] = {'attempts': len(rows), 'complete_p95_ms': p95}
                if p95 is None or p95 >= 5000:
                    reasons.append(profile + ':' + language + ':TARGET_PENDING')
        if profile in {'five', 'ingestion'}:
            batches = {}
            for row in selected:
                batches.setdefault(row['batch_id'], []).append(row)
            valid = (None not in batches and len(batches) >= 20
                     and all(len(rows) == 5 and {r['actor_slot'] for r in rows} == set(range(5))
                             for rows in batches.values()))
            if not valid:
                reasons.append(profile + ':SYNCHRONIZED_BATCHES_REQUIRED')
            if profile == 'ingestion' and not all(r['ingestion_active'] for r in selected):
                reasons.append(profile + ':INGESTION_NOT_ATTESTED')
            if not values or percentile(values, .95) >= 5000:
                reasons.append(profile + ':TARGET_PENDING')
        if profile == 'cold' and (len(selected) < 5 or any(not r['cold_reset_id'] for r in selected)
                                 or len({r['cold_reset_id'] for r in selected}) != len(selected)):
            reasons.append('cold:DISTINCT_CONTROLLED_RESETS_REQUIRED')
    return {'identity': identity, 'performance_ready': not reasons,
            'release_ready': False, 'pending': reasons, 'profiles': groups,
            'measurement': 'submit_to_complete_verified_render',
            'resource_peaks': 'REQUIRES_SEPARATE_RUNTIME_EVIDENCE'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--measurements', type=Path, required=True)
    args = parser.parse_args()
    try:
        data = json.loads(args.measurements.read_text(encoding='utf-8'))
        result = evaluate(data['identity'], data['records'])
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'performance_ready': False, 'error': 'INVALID_MEASUREMENT_FILE'}))
        return 1
    print(json.dumps(result, allow_nan=False))
    return 0 if result['performance_ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
