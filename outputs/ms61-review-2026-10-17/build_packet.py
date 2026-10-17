"""MS61-TC07: assemble blinded synthetic human-review material, no verdicts."""
import hashlib
import json
from pathlib import Path
import random
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
sys.path.insert(0, str(ROOT / 'services/rag'))
from ms61_localization import load_fixtures
from rag.identity import canonical_digest


def write(name, value):
    with (OUT / name).open('x', encoding='utf-8') as target:
        target.write(value)


def save(name, value):
    write(name, json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


manifest = json.loads((OUT / 'frozen-manifest.json').read_text(encoding='utf-8'))
keys = [json.loads((OUT / name).read_text(encoding='utf-8')) for name in ('assessor-key.json', 'compact-assessor-key.json')]
all_artifacts = [artifact for key in keys for artifact in key['artifacts']]
data = load_fixtures(ROOT / 'services/rag/evaluation/ms61-localization.json')
cases = {case['id']: case for case in data['cases'] if case['split'] == 'development'}
items = [artifact for artifact in all_artifacts if artifact['candidate'] is not None]
random.Random(manifest['identity']['run_id'] + ':review-order').shuffle(items)
for number, item in enumerate(items, 1):
    item['review_id'] = f'R{number:02d}'
assert len(items) == 14 and len(cases) == 4
assert sum(a['origin'] == 'adversarial' for a in items) == 8
review_items = []
key_rows = []
for item in items:
    review_items.append({key: value for key, value in item.items()
                         if key not in {'origin', 'draft_failure', 'negative_index'}})
    key_rows.append({key: item[key] for key in ('review_id', 'case_id', 'candidate_digest', 'origin')}
                    | {key: item[key] for key in ('draft_failure', 'negative_index') if key in item})
save('review-candidates.json', {'schema_version': 1, 'identity_digest': canonical_digest(manifest['identity']),
                             'items': review_items})
save('assessor-review-key.json', {'items': key_rows})

source_lines = ['# Source-meaning audit', '',
    'Synthetic development material only. Validate these draft English meanings before rating translations.',
    'If a meaning is wrong or incomplete, mark it false and explain the correction. That case needs refreezing; do not approve against a corrected meaning silently.', '']
for case in cases.values():
    source_lines += [f"## {case['id']}", '', '### Complete canonical source', '', f"> {case['source']}", '',
                     '### Draft meaning checklist', '']
    for number, meaning in enumerate(case['meanings'], 1):
        source_lines.append(f'{number}. {meaning}')
    source_lines += ['', 'Record one validity judgment per meaning in `reviewer-response.json`.', '']
write('SOURCE-AUDIT.md', '\n'.join(source_lines))

lines = ['# Tagalog and Taglish candidate review', '',
    'All text below is unapproved synthetic evaluation material. It must not be used as facility guidance.',
    'Review each main answer against the complete English source. Candidate origins, intended failure labels and model verdicts are withheld from this packet.',
    'Some answers may be fluent but wrong. English restatement does not satisfy the requested language. Do not infer correctness from citations or intact source proof.',
    'These are source-only translation experiments. The mixed-topic fixture records history, but neither experiment supplied it to generation. This does not evaluate live conversation handling.', '']
for item in review_items:
    case = cases[item['case_id']]
    lines += [f"## {item['review_id']}", '',
              f"Task: `{item['case_id']}`. Requested language: **{'Tagalog' if item['language'] == 'tl' else 'Taglish'}**.", '',
              '### User question', '', item['question'], '', '### Complete canonical source', '', f"> {item['source']}", '',
              '### Visible candidate main answer', '']
    for number, block in enumerate(item['candidate']['blocks'], 1):
        lines += [f"{number}. {block['text']}"]
    lines += ['', '### Human review', '',
              'In the response form, judge each source meaning, safety, directness, naturalness and requested-language match. List any failure categories and a correction in your own words.', '',
              f"Draft meanings: {len(case['meanings'])}. All candidate blocks cite canonical evidence index 0, the full source above. Offsets use UTF-16 [0, {item['evidence'][0]['end']}).", '',
              f"Candidate binding: `{item['candidate_digest']}`.", '']
write('REVIEWER-PACKET.md', '\n'.join(lines))

response = {'schema_version': 1, 'identity_digest': canonical_digest(manifest['identity']),
    'reviewer_private_id': None, 'independent_bilingual_human': None,
    'source_audit': [{'case_id': case['id'], 'meanings_valid': [None] * len(case['meanings']), 'notes': ''} for case in cases.values()],
    'reviews': [{'review_id': item['review_id'], 'candidate_digest': item['candidate_digest'],
        'meanings_preserved': [None] * len(cases[item['case_id']]['meanings']),
        'safe': None, 'direct': None, 'natural': None, 'requested_language_matches': None,
        'failures': [], 'notes': ''} for item in review_items]}
save('reviewer-response.json', response)

positive_controls = sum(row['origin'] == 'adversarial' and row['model_verdict'] is not None
    and all(row['model_verdict']['supported']) and all(row['model_verdict'][key] for key in ('complete', 'consistent', 'evidence_safe'))
    for key in keys for row in key['diagnostics'])
summary = {'generated_attempts': 8, 'generated_candidates': 6, 'generation_timeouts': 2,
           'adversarial_controls': 8, 'reviewable_items': len(items), 'source_audits': len(cases),
           'draft_negative_controls_with_positive_model_flags': positive_controls,
           'held_out_generation_count': 0, 'retrieval_exercised': False, 'live_endpoints_used': False,
           'translation_admitted': False, 'human_reviews_completed': 0, 'release_ready': False}
save('PACKAGE-SUMMARY.json', summary)

write('START-HERE.md', '''# MS-61 independent bilingual review package

Prepared October 17, 2026 (Asia/Irkutsk). Traceability: PRD-F26/F27, SDD-C21, QAD-TC44/46, MS61-TC01/03/07.

## Reviewer files

1. Read [SOURCE-AUDIT.md](SOURCE-AUDIT.md). Validate the four draft source-meaning checklists first. These are synthetic evaluation passages, not approved facility policy.
2. Review the fourteen shuffled items in [REVIEWER-PACKET.md](REVIEWER-PACKET.md). They include experimental model answers and deliberately adverse controls. You are not told which is which. Review the visible main answer against the entire source, including prerequisites, negation and ordered actions. Exact proof cannot compensate for wrong main guidance.
3. Fill [reviewer-response.json](reviewer-response.json). Replace each null with your private reviewer ID, true or false as appropriate. Keep review IDs, candidate digests and identity unchanged. Leave original candidate wording untouched. In `failures`, use zero or more of: storage, ownership, release, role, negation, condition, amount, timing, order, omission, ui_label, wrong_task. Describe necessary corrections in `notes`. For an English answer to a Tagalog request, set `requested_language_matches` false; language mismatch is tracked separately from semantic fidelity.
4. Use a reviewer independent of the model and of the agent that generated this package, competent in both English and Tagalog/Taglish. Set `independent_bilingual_human` true only when that describes you. This declaration is a human attestation, not automatic proof of qualifications.
5. Run the local response check after completing the form: `python outputs/ms61-review-2026-10-17/validate_review.py`. It reports missing entries and digest mismatches. A structurally completed review is not a release approval. Return the completed response file for analysis.

For meaning ratings, true means the candidate preserves that complete meaning in its visible main answer. False means changed, omitted, contradictory or invented guidance. Judge safety separately: a fluent answer can be unsafe. Judge directness separately: repeating the user's question is not guidance. Naturalness and requested-language match are independent of semantic fidelity. A sound English restatement can preserve meaning while failing localization.

If a source meaning needs correction, mark it false and explain. That case must be independently relabeled/refrozen before it can count as accepted. Do not silently edit source passages, meanings or candidates to make an item pass.

## Preparation facts and limits

Eight bounded generation attempts produced six complete candidate outputs; two initial Tagalog attempts timed out. The second experiment used a smaller output schema and translation instruction, within the same eight-second generation-plus-support deadline and existing token/context ceilings. Neither experiment used prior conversation history. The original timeout attempts remain in the assessor records and are not counted as successful localization. Four reserved cases were not sent to the model. No unseen held-out acceptance is claimed.

The package contains only authorized synthetic development material. It uses the pinned local qwen3:4b model at the existing digest, with no model/provider change, API restart, source publication or runtime translation activation. Model-review verdicts are diagnostic data only and are withheld from the reviewer packet. Source-only model probes did not exercise retrieval, authenticated gateway/browser behavior or complete-render performance.

## Assessor-only files

Keep these files away from the reviewer until all answers are frozen: `assessor-review-key.json`, `assessor-key.json`, `compact-assessor-key.json`, and `PACKAGE-SUMMARY.json`. They identify intended adverse controls, experimental variants and model verdicts. Their intended labels are also unreviewed; compare them with the human judgments rather than assuming that every draft label is correct.

`frozen-manifest.json`, `compact-experiment.json` and `integrity.json` bind the candidate code, pinned model, prompts, fixture dataset and immutable review material. The collector scripts preserve the exact experimental instructions. `review-candidates.json` is the machine-readable blinded packet. All artifacts are review material only. Live translation remains disabled and independent held-out quality plus MS-63 performance/release gates remain open.
''')

immutable = ['SOURCE-AUDIT.md', 'REVIEWER-PACKET.md', 'review-candidates.json', 'frozen-manifest.json',
             'compact-experiment.json', 'assessor-key.json', 'compact-assessor-key.json', 'assessor-review-key.json',
             'collect_candidates.py', 'collect_compact.py', 'build_packet.py', 'validate_review.py',
             'REVIEW-INSTRUCTIONS.md', 'START-HERE.md', 'PACKAGE-SUMMARY.json']
save('integrity.json', {'schema_version': 1, 'identity_digest': response['identity_digest'],
                      'files': {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in immutable},
                      'response_template_digest': canonical_digest(response)})
print(json.dumps({'reviewable_items': len(items), 'generated_candidates': 6, 'generation_timeouts': 2,
                  'held_out_generation_count': 0, 'human_review_completed': False}))
