"""MS54-TC02/03/04/05/07/08 / QAD-TC44/46: frozen baseline, no chat storage."""
from collections import Counter
import re
from .evaluation import percentile
from .identity import canonical_digest, valid_identity

OUTCOMES = {'useful_answer', 'safe_partial', 'correct_clarification', 'correct_refusal',
            'unnecessary_refusal', 'error', 'timeout', 'capacity_rejection'}
STAGES = {'validate', 'auth', 'settings', 'catalog', 'plan', 'embed', 'retrieve', 'tools',
          'answer', 'evidence', 'serialize', 'context', 'expand', 'grounding', 'synthesis', 'support', 'fallback'}
CATEGORIES = {'out_of_scope', 'clarification_required', 'evidence_gap', 'conflicting_sources',
              'unresolved_context', 'overflow', 'invalid_model_output', 'verification_failure',
              'service_failure', 'timeout_capacity', 'knowledge_identity_change'}
REASONS = {'UNSUPPORTED', 'AMBIGUOUS_SCOPE', 'CLARIFY', 'NO_RELEVANT_SOURCE', 'CONFLICTING_SOURCES',
           'REPROCESS_REQUIRED', 'UNRESOLVED_CONTEXT', 'INCOMPLETE_CONTEXT', 'CONTEXT_BUDGET',
           'CONTEXT_BUDGET_EXCEEDED', 'OUTPUT_BUDGET_EXCEEDED', 'INCOMPLETE_EVIDENCE',
           'INVALID_MODEL_OUTPUT', 'INVALID_PLAN', 'INVALID_SELECTION', 'INVALID_QUOTES',
           'INCOMPLETE_COVERAGE', 'INVALID_GROUPS', 'INJECTION_REJECTED', 'INVALID_SOURCE_QUOTE',
           'MODEL_UNAVAILABLE', 'DATA_UNAVAILABLE', 'INVALID_REQUEST', 'MODEL_TIMEOUT',
           'REQUEST_TIMEOUT', 'REQUEST_CANCELLED', 'CAPACITY_BUSY', 'KNOWLEDGE_CHANGED',
           'FORBIDDEN', 'AUTH_REQUIRED'}
COUNTS = {'aggregate_model_bytes', 'aggregate_output_reserved', 'bundle_count', 'support_passes', 'support_units', 'candidate_count', 'selected_count', 'closure_count', 'group_count', 'evidence_bytes',
          'selection_bytes', 'model_request_bytes', 'model_response_bytes', 'epoch', 'shortcut',
          'system_bytes', 'serialized_model_bytes', 'context_tokens', 'output_budget', 'template_headroom'}
FIELDS = {'attempt_id', 'case_id', 'identity', 'role', 'outcome', 'duration_ms', 'queue_ms',
          'stages', 'tokens', 'diagnostics', 'review', 'app_mode', 'measurement'}
REVIEW = {'accepted', 'citations_valid', 'conditions_complete', 'procedure_complete',
          'safe', 'tool_filters_valid', 'reviewer_id'}
CASE_FIELDS = {'id', 'split', 'family', 'language', 'document_type', 'question', 'history',
               'role', 'scope', 'direct_units', 'dependencies', 'conditions', 'tools',
               'filters', 'partial_allowed', 'expected', 'mandatory', 'synthetic'}


def digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def validate_dataset(data, lock):
    if (set(data) != {'schema_version', 'label_review', 'documents', 'cases'}
            or data['schema_version'] != 1 or data['label_review'] not in {'pending_independent_review', 'approved'}
            or not isinstance(data['cases'], list) or not data['cases']
            or lock != {'schema_version': 1, 'dataset_digest': canonical_digest(data),
                        'development_digest': canonical_digest([c for c in data['cases'] if c['split'] == 'development']),
                        'held_out_digest': canonical_digest([c for c in data['cases'] if c['split'] == 'held_out'])}):
        raise ValueError('FROZEN_DATASET_MISMATCH')
    units, ids = set(), set()
    for document in data['documents']:
        if set(document) != {'id', 'type', 'units'} or document['type'] not in {'description', 'faq', 'procedure', 'table', 'permissions', 'qualifications', 'long_sop'}:
            raise ValueError('INVALID_SYNTHETIC_DOCUMENT')
        for unit in document['units']:
            if (set(unit) != {'id', 'text', 'requires'} or unit['id'] in units
                    or not isinstance(unit['text'], str) or not unit['text']):
                raise ValueError('INVALID_SUPPORT_UNIT')
            units.add(unit['id'])
    for document in data['documents']:
        if any(set(unit['requires']) - units for unit in document['units']):
            raise ValueError('UNKNOWN_DEPENDENCY')
    for case in data['cases']:
        if (set(case) != CASE_FIELDS or case['id'] in ids or not re.fullmatch('MS54-[A-Z0-9-]+', case['id'])
                or case['split'] not in {'development', 'held_out'} or case['language'] not in {'en', 'tl', 'taglish'}
                or case['role'] not in {'ADMIN', 'STAFF'} or case['synthetic'] is not True
                or case['expected'] not in {'answer', 'clarify', 'refuse', 'conflict', 'escalate'}
                or set(case['direct_units'] + case['dependencies']) - units
                or set(case['direct_units']) & set(case['dependencies'])
                or (case['expected'] == 'answer' and not case['direct_units'] and not case['tools'])
                or type(case['partial_allowed']) is not bool or type(case['mandatory']) is not bool
                or not isinstance(case['question'], str) or not 1 <= len(case['question']) <= 2000
                or not isinstance(case['history'], list) or len(case['history']) > 4
                or any(not isinstance(turn, str) or not 1 <= len(turn) <= 2000 for turn in case['history'])):
            raise ValueError('INVALID_CASE_LABEL')
        ids.add(case['id'])
    for split in ('development', 'held_out'):
        cases = [c for c in data['cases'] if c['split'] == split]
        if {c['language'] for c in cases} != {'en', 'tl', 'taglish'}:
            raise ValueError('MISSING_LANGUAGE_PARTITION')
    if {c['question'].casefold() for c in data['cases'] if c['split'] == 'development'} & {c['question'].casefold() for c in data['cases'] if c['split'] == 'held_out'}:
        raise ValueError('PARTITION_LEAKAGE')
    return data


def validate_diagnostics(value):
    if value is None:
        return
    if (not isinstance(value, dict) or set(value) != {'schema_version', 'stage', 'failures', 'counts', 'ranked_units', 'closure_units'}
            or value['schema_version'] not in (1, 2) or value['stage'] not in STAGES
            or not isinstance(value['counts'], dict) or set(value['counts']) - COUNTS
            or any(type(n) is not int or not 0 <= n <= 10_000_000 for n in value['counts'].values())
            or not isinstance(value['failures'], list) or len(value['failures']) > 12):
        raise ValueError('UNSAFE_DIAGNOSTICS')
    for key in ('ranked_units', 'closure_units'):
        if not isinstance(value[key], list) or len(value[key]) > ((128 if key == 'closure_units' else 12) if value['schema_version'] == 2 else 6) or any(not digest(unit) for unit in value[key]):
            raise ValueError('UNSAFE_SUPPORT_IDENTIFIERS')
    for failure in value['failures']:
        if (set(failure) != {'stage', 'reason', 'category'} or failure['stage'] not in STAGES
                or failure['category'] not in CATEGORIES or failure['reason'] not in REASONS):
            raise ValueError('UNSAFE_FAILURE_REASON')


def validate_record(record, identity, cases):
    if (not isinstance(record, dict) or set(record) - {'synthesis_status'} != FIELDS or record['identity'] != identity
            or record['case_id'] not in cases or record['role'] != cases[record['case_id']]['role']
            or record['outcome'] not in OUTCOMES or record['app_mode'] not in {'development', 'production-build'}
            or record['measurement'] != 'gateway_complete' or not digest(record['attempt_id'])):
        raise ValueError('INVALID_BASELINE_RECORD')
    if 'synthesis_status' in record and record['synthesis_status'] not in {'DISABLED', 'NOT_ADMITTED', 'ACCEPTED', 'EXACT_FALLBACK'}:
        raise ValueError('INVALID_SYNTHESIS_STATUS')
    percentile([record['duration_ms']], .95)
    if record['queue_ms'] is not None:
        percentile([record['queue_ms']], .95)
    timing_names = STAGES | {'total', 'residual'} | {
        'python_' + stage + '_' + span for stage in ('plan', 'embed', 'answer', 'synthesis', 'support')
        for span in ('queue', 'verify', 'inference', 'schema', 'total', 'residual', 'load', 'prompt', 'generation', 'deterministic')}
    if (not isinstance(record['stages'], dict) or set(record['stages']) - timing_names
            or not isinstance(record['tokens'], dict) or set(record['tokens']) - {'plan_input', 'plan_output', 'answer_input', 'answer_output', 'synthesis_input', 'synthesis_output', 'support_input', 'support_output'}
            or any(type(n) is not int or not 0 <= n <= 10_000_000 for n in record['tokens'].values())):
        raise ValueError('INVALID_NUMERIC_DIAGNOSTICS')
    percentile(list(record['stages'].values()), .95)
    validate_diagnostics(record['diagnostics'])
    review = record['review']
    if review is not None and (not isinstance(review, dict) or set(review) != REVIEW
                              or not digest(review['reviewer_id'])
                              or any(type(review[key]) is not bool for key in REVIEW - {'reviewer_id'})):
        raise ValueError('INDEPENDENT_REVIEW_REQUIRED')


def evaluate(data, lock, identity, bindings, records, split='held_out', refusal_target=None):
    validate_dataset(data, lock)
    if (not valid_identity(identity) or identity['case_set_digest'] != canonical_digest(data['cases'])
            or identity['corpus_digest'] != canonical_digest(bindings)
            or split not in {'development', 'held_out'} or not isinstance(records, list)):
        raise ValueError('FROZEN_IDENTITY_REQUIRED')
    # One support unit may span multiple immutable chunks; every chunk is required.
    known_units = {unit['id'] for document in data['documents'] for unit in document['units']}
    if not isinstance(bindings, dict) or set(bindings) - known_units or any(not isinstance(ids, list) or not ids or any(not digest(i) for i in ids) for ids in bindings.values()):
        raise ValueError('INVALID_PUBLICATION_BINDINGS')
    all_cases = {case['id']: case for case in data['cases']}
    cases = {key: case for key, case in all_cases.items() if case['split'] == split}
    by_case, attempts = {}, set()
    for record in records:
        validate_record(record, identity, cases)
        if record['attempt_id'] in attempts or record['case_id'] in by_case:
            raise ValueError('DUPLICATE_BASELINE_ATTEMPT')
        attempts.add(record['attempt_id'])
        by_case[record['case_id']] = record
    pending, rows = [], []
    for case in cases.values():
        record = by_case.get(case['id'])
        diag = (record or {}).get('diagnostics') or {}
        ranked, closure = set(diag.get('ranked_units', [])), set(diag.get('closure_units', []))
        def covered(unit, found):
            return unit in bindings and set(bindings[unit]).issubset(found)
        hits = sum(covered(unit, ranked) for unit in case['direct_units'])
        complete = all(covered(unit, closure) for unit in case['direct_units'] + case['dependencies'])
        review = (record or {}).get('review') or {}
        useful = bool(record and (record['outcome'] == 'useful_answer' or case['partial_allowed'] and record['outcome'] == 'safe_partial'))
        accepted = useful and all(review.get(key) is True for key in REVIEW - {'reviewer_id'})
        if case['scope'] == 'procedure' and (not complete or review.get('procedure_complete') is not True):
            accepted = False
        correct_negative = bool(record and ((case['expected'] == 'clarify' and record['outcome'] == 'correct_clarification')
                                or (case['expected'] in {'refuse', 'conflict', 'escalate'} and record['outcome'] == 'correct_refusal'))
                                and review.get('accepted') is True and review.get('safe') is True)
        rows.append({'id': case['id'], 'family': case['family'], 'language': case['language'], 'type': case['document_type'],
                     'answerable': case['expected'] == 'answer', 'direct': len(case['direct_units']), 'hits': hits,
                     'all_direct': hits == len(case['direct_units']), 'closure_complete': complete,
                     'accepted': accepted, 'synthesis_status': (record or {}).get('synthesis_status'), 'unnecessary_refusal': case['expected'] == 'answer' and bool(record) and not useful,
                     'missing': record is None, 'mandatory_pass': accepted if case['expected'] == 'answer' else correct_negative,
                     'mandatory': case['mandatory'], 'failures': diag.get('failures', [])})
    groups = {}
    for key in ['overall', *['language:' + language for language in ('en', 'tl', 'taglish')],
                *['type:' + kind for kind in sorted({c['document_type'] for c in cases.values()})]]:
        selected = [row for row in rows if key == 'overall' or key == 'language:' + row['language'] or key == 'type:' + row['type']]
        answerable = [row for row in selected if row['answerable']]
        retrieval = [row for row in answerable if row['direct']]
        groups[key] = {'count': len(selected), 'answerable_count': len(answerable), 'retrieval_count': len(retrieval),
                       'sparse': len(retrieval) < 30, 'support_unit_count': sum(r['direct'] for r in retrieval),
                       'recall_at_6_micro': sum(r['hits'] for r in retrieval) / sum(r['direct'] for r in retrieval) if retrieval else None,
                       'recall_at_6_macro': sum(r['hits'] / r['direct'] for r in retrieval) / len(retrieval) if retrieval else None,
                       'all_direct_count': sum(r['all_direct'] for r in retrieval),
                       'closure_complete_count': sum(r['closure_complete'] for r in retrieval),
                       'reviewer_acceptance': sum(r['accepted'] for r in answerable) / len(answerable) if answerable else None,
                       'accepted_synthesis': sum(r['accepted'] and r['synthesis_status'] == 'ACCEPTED' for r in answerable),
                       'accepted_exact_fallback': sum(r['accepted'] and r['synthesis_status'] == 'EXACT_FALLBACK' for r in answerable),
                       'unnecessary_refusal_rate': sum(r['unnecessary_refusal'] for r in answerable) / len(answerable) if answerable else None,
                       'missing_count': sum(r['missing'] for r in selected)}
    outcomes = Counter(record['outcome'] for record in records)
    outcomes['missing'] = len(cases) - len(records)
    failures = Counter(failure['stage'] + ':' + failure['category'] + ':' + failure['reason'] for row in rows for failure in row['failures'])
    useful_times = [r['duration_ms'] for r in records if next(row for row in rows if row['id'] == r['case_id'])['accepted']]
    if len(records) != len(cases):
        pending.append('INCOMPLETE_BASELINE')
    if any(r['review'] is None for r in records) or not records or data['label_review'] != 'approved':
        pending.append('INDEPENDENT_REVIEW_PENDING')
    if any(r['diagnostics'] is None for r in records) or not records:
        pending.append('DIAGNOSTICS_PENDING')
    if any(r['mandatory'] and not r['mandatory_pass'] for r in rows):
        pending.append('MANDATORY_CASES_PENDING')
    if any(g['recall_at_6_micro'] is not None and g['recall_at_6_micro'] < .95 for g in groups.values()):
        pending.append('RETRIEVAL_TARGET_PENDING')
    if any(g['reviewer_acceptance'] is not None and g['reviewer_acceptance'] < .90 for g in groups.values()):
        pending.append('ANSWER_ACCEPTANCE_PENDING')
    if refusal_target is None:
        pending.append('OWNER_REFUSAL_TARGET_PENDING')
    elif (set(refusal_target) != {'maximum_rate', 'owner_approval_digest', 'baseline_digest'}
          or not digest(refusal_target['owner_approval_digest']) or not digest(refusal_target['baseline_digest'])
          or type(refusal_target['maximum_rate']) not in {float, int} or not 0 <= refusal_target['maximum_rate'] <= 1):
        raise ValueError('INVALID_OWNER_THRESHOLD')
    elif groups['overall']['unnecessary_refusal_rate'] is None or groups['overall']['unnecessary_refusal_rate'] > refusal_target['maximum_rate']:
        pending.append('REFUSAL_TARGET_PENDING')
    pending += ['LIVE_REPRODUCTION_REQUIRES_AUTHORIZED_RUN', 'FULL_RENDER_PROFILES_PENDING']
    return {'schema_version': 1, 'identity': identity, 'dataset_digest': lock['dataset_digest'], 'split': split,
            'release_ready': False, 'pending': sorted(set(pending)), 'expected_attempts': len(cases),
            'attempts': len(records), 'outcomes': dict(outcomes), 'failure_breakdown': dict(failures),
            'groups': groups, 'cases': rows, 'refusal_target': refusal_target,
            'gateway_accepted_p95_ms': percentile(useful_times, .95),
            'gateway_all_p95_ms': percentile([r['duration_ms'] for r in records], .95),
            'aggregation': 'micro by direct support unit; macro by answerable retrieval question; missing attempts score zero'}
