"""MS65 / QAD-TC44-TC46: extend the existing MS63 acceptance ledger.

Consumes independently frozen labels and content-free observations. This does
not author independent labels, certify a reviewer, publish or activate anything.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

from ms63_acceptance import evaluate as inherited, require, save
from rag.identity import canonical_digest, freeze_identity
from rag.document_support import BUDGET
from rag.reliability import digest


def evaluate(data, lock, bundle, manifest):
    result = inherited(data, lock, bundle)
    pending = set(result['pending'])
    require(set(manifest) == {'dataset_digest', 'budget_digest', 'documents', 'conversations', 'audit_case_ids', 'observations'}, 'INVALID_MS65_MANIFEST')
    require(manifest['dataset_digest'] == lock['dataset_digest'] and manifest['budget_digest'] == canonical_digest(BUDGET), 'STALE_MS65_MANIFEST')
    documents = {d['id']: d for d in manifest['documents']}
    require(len(documents) == len(manifest['documents']), 'DUPLICATE_DOCUMENT')
    require(set(documents).issubset({d['id'] for d in data['documents']}), 'UNKNOWN_DOCUMENT')
    families = Counter()
    for document in documents.values():
        require(set(document) == {'id', 'format', 'source_digest', 'held_out', 'ocr'}
                and document['format'] in {'MD', 'DOC', 'DOCX', 'PDF'}
                and type(document['held_out']) is bool and type(document['ocr']) is bool
                and digest(document['source_digest']), 'INVALID_FORMAT_BINDING')
        if document['held_out']:
            families[document['format']] += 1
    if len(documents) < 12 or any(families[f] < 3 for f in ('MD', 'DOC', 'DOCX', 'PDF')):
        pending.add('MS65:TWELVE_UNSEEN_FORMAT_FIXTURES_REQUIRED')
    if not any(d['format'] == 'PDF' and d['ocr'] for d in documents.values()):
        pending.add('MS65:OCR_PDF_REQUIRED')
    cases = {c['id']: c for c in data['cases']}
    held = [c for c in cases.values() if c['split'] == 'held_out']
    audit = set(manifest['audit_case_ids'])
    require(audit.issubset(cases) and len(audit) == len(manifest['audit_case_ids']), 'INVALID_AUDIT_PARTITION')
    if len(audit) < 16 or any(cases[key]['split'] == 'held_out' for key in audit):
        pending.add('MS65:AUDIT_REGRESSION_PARTITION_REQUIRED')
    if sum(c['expected'] == 'answer' for c in held) < 120 or sum(c['expected'] != 'answer' for c in held) < 40:
        pending.add('MS65:HELD_OUT_SAMPLE_MINIMA')
    used = set()
    for conversation in manifest['conversations']:
        require(isinstance(conversation, list) and len(conversation) >= 2 and all(key in cases for key in conversation), 'INVALID_CONVERSATION')
        require(not used.intersection(conversation) and len(set(conversation)) == len(conversation), 'REUSED_CONVERSATION')
        used.update(conversation)
        require(all(cases[key]['split'] == 'held_out' for key in conversation)
                and all(cases[key]['history'] for key in conversation[1:]), 'CONVERSATION_HISTORY_REQUIRED')
    if len(manifest['conversations']) < 20:
        pending.add('MS65:TWENTY_MULTI_TURN_CONVERSATIONS_REQUIRED')
    unit_documents = {unit['id']: doc['id'] for doc in data['documents'] for unit in doc['units']}
    development_documents = {unit_documents[u] for c in cases.values() if c['split'] == 'development' for u in c['direct_units'] + c['dependencies']}
    held_documents = {unit_documents[u] for c in held for u in c['direct_units'] + c['dependencies']}
    if development_documents.intersection(held_documents) or any(not documents.get(d, {}).get('held_out') for d in held_documents):
        pending.add('MS65:DOCUMENT_SPLIT_LEAKAGE')
    rows = {row['id']: row for row in result['quality']['cases']}
    if any(not rows.get(c['id'], {}).get('mandatory_pass') for c in held if c['expected'] != 'answer'):
        pending.add('MS65:NEGATIVE_SAFETY_CASES_PENDING')
    strata = {}
    for family in ('MD', 'DOC', 'DOCX', 'PDF'):
        for language in ('en', 'tl', 'taglish'):
            selected = [c for c in held if c['expected'] == 'answer' and c['language'] == language
                        and any(documents.get(unit_documents.get(u), {}).get('format') == family for u in c['direct_units'])]
            accepted = sum(bool(rows.get(c['id'], {}).get('accepted')) for c in selected)
            rate = accepted / len(selected) if selected else None
            strata[family + ':' + language] = {'attempts': len(selected), 'accepted': accepted, 'rate': rate}
            if rate is None or rate < .9:
                pending.add('MS65:USEFUL_ANSWER:' + family + ':' + language)
    observations = manifest['observations']
    seen = set()
    for observation in observations:
        require(set(observation) == {'case_id', 'retrieval_recall', 'applicable_recall', 'identity_digest', 'evidence_digest', 'dangerous', 'bundles', 'calls', 'input_tokens', 'output_tokens', 'queue_ms', 'deadline_exhausted'}, 'INVALID_MS65_OBSERVATION')
        key = observation['case_id']
        require(key in cases and key not in seen and observation['identity_digest'] == canonical_digest(bundle['identity'])
                and digest(observation['evidence_digest'])
                and type(observation['dangerous']) is bool and type(observation['deadline_exhausted']) is bool,
                'MIXED_OR_DUPLICATE_OBSERVATION')
        for metric in ('retrieval_recall', 'applicable_recall'):
            require(type(observation[metric]) in (float, int) and 0 <= observation[metric] <= 1, 'INVALID_SUPPORT_MEASUREMENT')
        for metric in ('bundles', 'calls', 'input_tokens', 'output_tokens', 'queue_ms'):
            require(type(observation[metric]) is int and observation[metric] >= 0, 'INVALID_WORK_MEASUREMENT')
        if observation['dangerous']:
            pending.add('MS65:DANGEROUS_GUIDANCE')
        if observation['applicable_recall'] < .95:
            pending.add('MS65:APPLICABLE_SUPPORT_RECALL')
        if (observation['calls'] > BUDGET['model_calls'] or observation['bundles'] > BUDGET['bundles']
                or observation['output_tokens'] > BUDGET['aggregate_output_tokens']
                or observation['input_tokens'] > BUDGET['aggregate_wire_bytes']):
            pending.add('MS65:WORK_CEILING_EXCEEDED')
        if observation['deadline_exhausted'] and cases[key]['expected'] == 'answer':
            pending.add('MS65:ANSWERABLE_DEADLINE_EXHAUSTED')
        seen.add(key)
    if set(c['id'] for c in held) - seen:
        pending.add('MS65:SUPPORT_AND_WORK_MEASUREMENTS_MISSING')
    if bundle['settings'].get('RAG_EVIDENCE_CONTRACT') != 'ms65-v1':
        pending.add('MS65:ACTIVE_CONTRACT_NOT_VERIFIED')
    result.update(ms65_manifest_digest=canonical_digest(manifest), ms65_format_language=strata,
                  pending=sorted(pending), evaluation_ready=not pending, release_ready=False)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('dataset', 'lock', 'bundle', 'manifest', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        data, lock, bundle, manifest = [json.loads(getattr(args, name).read_text(encoding='utf-8')) for name in ('dataset', 'lock', 'bundle', 'manifest')]
        current = freeze_identity(Path(__file__).resolve().parents[2], bundle['bindings'], data['cases'], bundle['settings'])
        require(all(current[key] == value for key, value in bundle['identity'].items() if key != 'run_id'), 'STALE_CANDIDATE')
        result = evaluate(data, lock, bundle, manifest)
        save(args.out, result)
        print(json.dumps({'evaluation_ready': result['evaluation_ready'], 'release_ready': False, 'pending': result['pending']}))
        return 0 if result['evaluation_ready'] else 1
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'evaluation_ready': False, 'release_ready': False, 'error': 'INVALID_OR_STALE_MS65_EVIDENCE'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
