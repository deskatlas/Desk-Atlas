# MS-61 independent bilingual review package

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
