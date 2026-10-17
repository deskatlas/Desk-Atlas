"""MS61: check review bindings/completeness, never certify language or activate."""
import hashlib
import json
from pathlib import Path
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
sys.path.insert(0, str(ROOT / 'services/rag'))
from ms61_localization import load_fixtures, FAILURES
from rag.identity import canonical_digest


def check():
    integrity = json.loads((OUT / 'integrity.json').read_text(encoding='utf-8'))
    for name, digest in integrity['files'].items():
        if Path(name).name != name or hashlib.sha256((OUT / name).read_bytes()).hexdigest() != digest:
            raise ValueError('REVIEW_MATERIAL_CHANGED')
    packet = json.loads((OUT / 'review-candidates.json').read_text(encoding='utf-8'))
    form = json.loads((OUT / 'reviewer-response.json').read_text(encoding='utf-8'))
    if form['identity_digest'] != integrity['identity_digest']:
        raise ValueError('IDENTITY_MISMATCH')
    cases = {case['id']: case for case in load_fixtures(ROOT / 'services/rag/evaluation/ms61-localization.json')['cases']
             if case['split'] == 'development'}
    items = {item['review_id']: item for item in packet['items']}
    if (len(form['reviews']) != len(items) or {row['review_id'] for row in form['reviews']} != set(items)
            or len(form['source_audit']) != len(cases) or {row['case_id'] for row in form['source_audit']} != set(cases)):
        raise ValueError('MISSING_OR_DUPLICATE_REVIEW_IDS')
    pending, source_corrections = 0, 0
    for audit in form['source_audit']:
        if len(audit['meanings_valid']) != len(cases[audit['case_id']]['meanings']):
            raise ValueError('SOURCE_MEANING_COUNT_CHANGED')
        for value in audit['meanings_valid']:
            if value is None:
                pending += 1
            elif type(value) is not bool:
                raise ValueError('BOOLEAN_OR_NULL_REQUIRED')
            elif not value:
                source_corrections += 1
    for review in form['reviews']:
        item = items[review['review_id']]
        if review['candidate_digest'] != item['candidate_digest']:
            raise ValueError('CANDIDATE_BINDING_MISMATCH')
        if len(review['meanings_preserved']) != len(cases[item['case_id']]['meanings']):
            raise ValueError('CANDIDATE_MEANING_COUNT_CHANGED')
        for value in [*review['meanings_preserved'], *[review[key] for key in ('safe', 'direct', 'natural', 'requested_language_matches')]]:
            if value is None:
                pending += 1
            elif type(value) is not bool:
                raise ValueError('BOOLEAN_OR_NULL_REQUIRED')
        if not isinstance(review['failures'], list) or not set(review['failures']) <= FAILURES:
            raise ValueError('UNKNOWN_FAILURE_CATEGORY')
    pending += int(not isinstance(form['reviewer_private_id'], str) or not form['reviewer_private_id'].strip())
    pending += int(form['independent_bilingual_human'] is not True)
    return {'status': 'REVIEW_PENDING' if pending else 'STRUCTURALLY_COMPLETE',
            'unanswered_fields': pending, 'source_meanings_requiring_refreeze': source_corrections,
            'response_digest': canonical_digest(form), 'translation_admitted': False, 'release_ready': False}


if __name__ == '__main__':
    try:
        result = check()
        print(json.dumps(result))
        raise SystemExit(1 if result['unanswered_fields'] or result['source_meanings_requiring_refreeze'] else 0)
    except (ValueError, TypeError, KeyError, OSError):
        print(json.dumps({'status': 'INVALID_REVIEW', 'translation_admitted': False}))
        raise SystemExit(1)
