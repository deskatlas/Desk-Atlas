"""MS57-TC01..13: compare frozen exact and synthesis paths without answer storage.

Input bundles contain MS-54 reports plus nonsecret frozen settings. Collect with
ms54-baseline, attach independent review, then run its report action per mode.
This comparison never enables the feature or certifies missing live gates.
"""
import argparse
import json
from pathlib import Path

from rag.identity import canonical_digest, valid_identity, SETTINGS


def compare(bundles):
    if set(bundles) != {'exact', 'synthesis'}:
        raise ValueError('BOTH_MODES_REQUIRED')
    baseline = bundles['exact']['report']
    output = {}
    reference = None
    for mode in ('exact', 'synthesis'):
        bundle = bundles[mode]
        report, settings = bundle['report'], bundle['settings']
        enabled = settings.get('RAG_SYNTHESIS_ENABLED', False) in (True, 'true')
        identity = report.get('identity')
        if (set(settings) - SETTINGS or enabled != (mode == 'synthesis') or not valid_identity(identity)
                or identity['config_digest'] != canonical_digest(settings) or report.get('split') != 'held_out'):
            raise ValueError('FROZEN_HELD_OUT_MODES_REQUIRED')
        comparable = {k: v for k, v in identity.items() if k not in {'run_id', 'config_digest'}}
        configuration = {k: v for k, v in settings.items() if k != 'RAG_SYNTHESIS_ENABLED'}
        closure = (comparable, configuration, report['dataset_digest'], [c['id'] for c in report['cases']])
        if reference is None:
            reference = closure
        elif reference != closure:
            raise ValueError('INCOMPARABLE_SYNTHESIS_RUNS')
        rows = report['cases']
        if any(row.get('synthesis_status') not in {'DISABLED', 'NOT_ADMITTED', 'ACCEPTED', 'EXACT_FALLBACK'} for row in rows if not row['missing']):
            raise ValueError('SYNTHESIS_OUTCOMES_REQUIRED')
        if mode == 'exact' and any(row.get('synthesis_status') in {'ACCEPTED', 'EXACT_FALLBACK'} for row in rows):
            raise ValueError('EXACT_BASELINE_GENERATED_PROSE')
        def summarize(selected):
            return {'cases': len(selected), 'accepted_synthesis': sum(r['accepted'] and r.get('synthesis_status') == 'ACCEPTED' for r in selected),
                    'accepted_fallback': sum(r['accepted'] and r.get('synthesis_status') == 'EXACT_FALLBACK' for r in selected),
                    'accepted_exact': sum(r['accepted'] and r.get('synthesis_status') == 'DISABLED' for r in selected),
                    'no_accepted_answer': sum(not r['accepted'] for r in selected if r['answerable']),
                    'missing': sum(r['missing'] for r in selected)}
        output[mode] = {'overall': summarize(rows), 'by_language': {lang: summarize([r for r in rows if r['language'] == lang]) for lang in ('en', 'tl', 'taglish')},
                        'by_document_type': {kind: summarize([r for r in rows if r['type'] == kind]) for kind in sorted({r['type'] for r in rows})},
                        'reviewed_groups': report['groups'], 'all_path_p95_ms': report['gateway_all_p95_ms'],
                        'accepted_path_p95_ms': report['gateway_accepted_p95_ms'], 'pending': report['pending']}
    synthesis = bundles['synthesis']['report']
    pending = set(baseline['pending'] + synthesis['pending'])
    if not any(row['accepted'] and row.get('synthesis_status') == 'ACCEPTED' for row in synthesis['cases']):
        pending.add('NO_REVIEWED_SYNTHESIS_SUCCESS')
    if synthesis['gateway_all_p95_ms'] is None or synthesis['gateway_all_p95_ms'] >= 5000:
        pending.add('COMPLETE_PATH_LATENCY_PENDING')
    return {'schema_version': 1, 'dataset_digest': baseline['dataset_digest'], 'modes': output,
            'pending': sorted(pending | {'MS55_RECALL_AND_MS56_CLOSURE_ACCEPTANCE_REQUIRED', 'INDEPENDENT_SEMANTIC_AND_TRANSLATION_REVIEW_REQUIRED'}),
            'release_ready': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exact', type=Path, required=True)
    parser.add_argument('--synthesis', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    from ms54_baseline import save
    result = compare({mode: json.loads(getattr(args, mode).read_text(encoding='utf-8')) for mode in ('exact', 'synthesis')})
    save(args.out, result)


if __name__ == '__main__':
    main()
