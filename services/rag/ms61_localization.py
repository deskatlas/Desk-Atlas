"""MS61-TC03/07: offline independent bilingual review, never runtime activation.

Only authorized synthetic evaluation text belongs in fixture files. Run records
and emitted reports contain digests and fixed verdicts, never answer/source text.
Human attestations are supplied externally; this tool cannot establish that a
person is independent, bilingual or truthful merely by parsing their record.
"""
import argparse
import json
from pathlib import Path
import re

from rag.identity import canonical_digest, valid_identity, freeze_identity

LANGUAGES = ('tl', 'taglish')
FAILURES = {'storage', 'ownership', 'release', 'role', 'negation', 'condition',
            'amount', 'timing', 'order', 'omission', 'ui_label', 'wrong_task'}
OUTCOMES = {'LOCALIZED', 'EXACT_FALLBACK', 'REJECTED', 'TIMEOUT', 'UNAVAILABLE'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def fixture_digest(case):
    return canonical_digest(case)


def baseline_identity(data):
    # Offline synthetic baseline, never a claim about a live published corpus.
    root = Path(__file__).resolve().parents[2]
    corpus = [{'id': case['id'], 'source_digest': canonical_digest(case['source'])}
              for case in data['cases']]
    return freeze_identity(root, corpus, data['cases'], {'RAG_SYNTHESIS_ENABLED': False})


def load_fixtures(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    lock = json.loads(path.with_suffix('.lock.json').read_text(encoding='utf-8'))
    require(set(data) == {'version', 'material', 'cases'} and data['version'] == 1
            and data['material'] == 'synthetic-unreviewed', 'AUTHORIZED_FIXTURES_REQUIRED')
    require(lock == {'version': 1, 'dataset_digest': canonical_digest(data)}, 'FIXTURES_CHANGED')
    require(isinstance(data['cases'], list), 'INVALID_FIXTURE_SET')
    ids = set()
    for case in data['cases']:
        require(set(case) == {'id', 'language', 'split', 'source', 'question', 'history', 'meanings', 'adversarial'}
                and isinstance(case['id'], str) and re.fullmatch('[a-z0-9-]{1,64}', case['id'])
                and case['id'] not in ids and case['language'] in LANGUAGES
                and case['split'] in {'development', 'held_out'}
                and isinstance(case['source'], str) and 0 < len(case['source']) <= 10000
                and isinstance(case['question'], str) and 0 < len(case['question']) <= 2000
                and isinstance(case['history'], list) and len(case['history']) <= 4
                and all(isinstance(turn, str) and 0 < len(turn) <= 2000 for turn in case['history'])
                and isinstance(case['meanings'], list) and 0 < len(case['meanings']) <= 12
                and all(isinstance(item, str) and 0 < len(item) <= 1000 for item in case['meanings'])
                and isinstance(case['adversarial'], list) and case['adversarial'], 'INVALID_FIXTURE')
        for negative in case['adversarial']:
            require(set(negative) == {'text', 'failure'} and negative['failure'] in FAILURES
                    and isinstance(negative['text'], str) and 0 < len(negative['text']) <= 2000,
                    'INVALID_NEGATIVE_FIXTURE')
        ids.add(case['id'])
    require(bool(ids), 'EMPTY_FIXTURE_SET')
    return data


def evaluate(data, bundle):
    require(isinstance(bundle, dict) and set(bundle) == {'identity', 'dataset_digest', 'split', 'records'},
            'CONTENT_FREE_BUNDLE_REQUIRED')
    identity = bundle['identity']
    require(valid_identity(identity) and bundle['dataset_digest'] == canonical_digest(data)
            and identity['case_set_digest'] == canonical_digest(data['cases']), 'FROZEN_IDENTITY_REQUIRED')
    require(bundle['split'] in {'development', 'held_out'} and isinstance(bundle['records'], list), 'INVALID_SPLIT')
    cases = {case['id']: case for case in data['cases'] if case['split'] == bundle['split']}
    require(bool(cases), 'EMPTY_SPLIT')
    records = {}
    identity_digest = canonical_digest(identity)
    for row in bundle['records']:
        require(isinstance(row, dict) and set(row) == {'id', 'fixture_digest', 'candidate_digest',
                'outcome', 'retrieval_ok', 'model_supported', 'review'}, 'CONTENT_FREE_RECORD_REQUIRED')
        require(row['id'] in cases and row['id'] not in records and row['fixture_digest'] == fixture_digest(cases[row['id']])
                and digest(row['candidate_digest']) and row['outcome'] in OUTCOMES
                and type(row['retrieval_ok']) is bool and type(row['model_supported']) is bool, 'INVALID_RUN_RECORD')
        review = row['review']
        if review is not None:
            require(isinstance(review, dict) and set(review) == {'kind', 'reviewer_digest', 'artifact_digest',
                    'identity_digest', 'fixture_digest', 'candidate_digest', 'meanings', 'failures',
                    'safe', 'direct', 'natural', 'negative_rejected'}, 'INDEPENDENT_REVIEW_REQUIRED')
            require(review['kind'] == 'independent_bilingual_human' and digest(review['reviewer_digest'])
                    and digest(review['artifact_digest']) and review['identity_digest'] == identity_digest
                    and review['candidate_digest'] == row['candidate_digest']
                    and review['fixture_digest'] == row['fixture_digest'], 'REVIEW_BINDING_MISMATCH')
            require(isinstance(review['meanings'], list) and len(review['meanings']) == len(cases[row['id']]['meanings'])
                    and all(type(flag) is bool for flag in review['meanings'])
                    and isinstance(review['negative_rejected'], list)
                    and len(review['negative_rejected']) == len(cases[row['id']]['adversarial'])
                    and all(type(flag) is bool for flag in review['negative_rejected'])
                    and all(type(review[key]) is bool for key in ('safe', 'direct', 'natural'))
                    and isinstance(review['failures'], list) and set(review['failures']) <= FAILURES
                    and len(set(review['failures'])) == len(review['failures']), 'INVALID_REVIEW')
        records[row['id']] = row

    def counts(selected):
        result = dict.fromkeys(('cases', 'missing', 'reviewed', 'retrieval_success', 'localized_success',
                                'safe_fallback', 'dangerous_emitted', 'verifier_false_acceptance',
                                'negative_accepted', 'unreviewed'), 0)
        failures = dict.fromkeys(sorted(FAILURES), 0)
        for case in selected:
            result['cases'] += 1
            row = records.get(case['id'])
            if row is None:
                result['missing'] += 1
                continue
            result['retrieval_success'] += int(row['retrieval_ok'])
            review = row['review']
            if review is None:
                result['unreviewed'] += 1
                continue
            result['reviewed'] += 1
            faithful = all(review['meanings']) and not review['failures'] and review['safe'] and review['direct']
            result['localized_success'] += int(row['outcome'] == 'LOCALIZED' and row['retrieval_ok'] and faithful and review['natural'])
            result['safe_fallback'] += int(row['outcome'] == 'EXACT_FALLBACK' and row['retrieval_ok'] and faithful)
            result['dangerous_emitted'] += int(row['outcome'] in {'LOCALIZED', 'EXACT_FALLBACK'} and not review['safe'])
            result['verifier_false_acceptance'] += int(row['model_supported'] and not faithful)
            result['negative_accepted'] += sum(not flag for flag in review['negative_rejected'])
            for failure in review['failures']:
                failures[failure] += 1
        result['localized_rate'] = result['localized_success'] / result['cases'] if result['cases'] else None
        result['failures'] = failures
        return result

    groups = {language: counts([case for case in cases.values() if case['language'] == language]) for language in LANGUAGES}
    pending = {'MS63_INTEGRATED_ACCEPTANCE_REQUIRED', 'INDEPENDENT_FIXTURE_MEANING_REVIEW_REQUIRED',
               'REVIEWED_PUBLISHED_VARIANT_COMPARISON_UNAVAILABLE'}
    if bundle['split'] != 'held_out':
        pending.add('HELD_OUT_EVALUATION_REQUIRED')
    for language, group in groups.items():
        if not group['cases'] or group['missing'] or group['unreviewed']:
            pending.add(language + ':INDEPENDENT_REVIEW_INCOMPLETE')
        if group['localized_rate'] is None or group['localized_rate'] < .9:
            pending.add(language + ':LOCALIZED_QUALITY_BELOW_90_PERCENT')
        if group['dangerous_emitted'] or group['negative_accepted'] or group['verifier_false_acceptance']:
            pending.add(language + ':FIDELITY_FAILURE')
    return {'schema_version': 1, 'identity_digest': identity_digest, 'dataset_digest': bundle['dataset_digest'],
            'input_digest': canonical_digest(bundle), 'split': bundle['split'], 'by_language': groups,
            'pending': sorted(pending), 'translation_admitted': False, 'release_ready': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, default=Path(__file__).parent / 'evaluation/ms61-localization.json')
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--split', choices=['development', 'held_out'], default='development')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        from ms54_baseline import save
        data = load_fixtures(args.fixtures)
        require(args.freeze != bool(args.bundle), 'CHOOSE_FREEZE_OR_REVIEW')
        current = baseline_identity(data)
        if args.freeze:
            save(args.out, {'identity': current, 'dataset_digest': canonical_digest(data),
                            'split': args.split, 'records': []})
            print(json.dumps({'status': 'FROZEN_SYNTHETIC_BASELINE', 'translation_admitted': False}))
            return 0
        bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        require(isinstance(bundle, dict) and isinstance(bundle.get('identity'), dict)
                and all(bundle['identity'].get(key) == value for key, value in current.items() if key != 'run_id'),
                'FROZEN_CANDIDATE_CHANGED')
        result = evaluate(data, bundle)
        save(args.out, result)
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'translation_admitted': False, 'error': 'INVALID_LOCALIZATION_EVALUATION'}))
        return 1
    print(json.dumps({'translation_admitted': False, 'pending': result['pending']}))
    return 1 if result['pending'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
