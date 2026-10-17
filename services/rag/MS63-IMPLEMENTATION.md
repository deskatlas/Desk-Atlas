# MS-63 implementation and acceptance record

Date: October 17, 2026, Asia/Irkutsk. Authority: the maintainer requested MS-63 implementation. Traceability: PRD-F26/F27, SDD-C20 through C24, QAD-TC44/45/46 and MS63-TC01 through TC10. Production release remains separately authorized.

## Delivered behavior

`ms63_acceptance.py` freezes a candidate manifest and evaluates content-free evidence against that manifest. It reuses MS-54 fixed quality denominators, publication bindings and MS-53 nearest-rank performance definitions. A report includes missing attempts and every supplied failed, blocked or unavailable gate. A passing attestation cannot override measured failures, unreviewed labels, missing samples or an unresolved owner refusal threshold. Reports always return `release_ready: false`.

The frozen identity includes Git revision, local source snapshot (including uncommitted code), model/embedding/parser fingerprints, settings, corpus bindings and case membership. A separate manifest digest binds the full dataset lock, including source fixtures and label-review state. The report command recomputes the local identity and rejects stale candidates. This identifies local files; the `live_identity_limits` and `publication_installation` gates still require evidence of actual loaded code, effective settings and the current published corpus.

The ledger retains distinct gates for normal STAFF and ADMIN authentication/lifecycle, withdrawal, role revocation, audience/epoch/proof access, MS-61 input understanding with English output, MS-62 completeness/concision, compatibility modes, complete-render capture, actual stress-workload provenance, privacy, repository verification and rollback. Missing gates become `unavailable`. Failed repository tests remain failed even if a separate campaign disposition is supplied. Reviewer digests and artifact references are externally supplied attestations, not proof that a reviewer is independent or that an artifact is truthful.

Post-audit conditional-intent and topic-switch held-out strata are required for English, Tagalog and Taglish input. Tuned held-out IDs keep the report pending; they must be moved into a disclosed development/regression partition and replaced before a new freeze. Existing synthetic agent-authored labels cannot establish independent acceptance. The external dataset option preserves the MS-54 schema and case-ID namespace; it does not generate labels or silently modify the existing lock.

Performance keeps one-user representative and repeated-question samples separate, with at least 30 warm attempts per input language, 20 five-user batches and five distinct cold resets. It adds sample membership, source-read/generation/verification/transport-render stages, independent safety/correctness metadata and shared-clock batch start checks (at most 100 ms start spread). Five-user warm p95 is checked separately for each language, strictly below 5,000 ms. Cold and contention profiles retain inherited requirements. Retry, oversized evidence, translation rejection and safe fallback each require separate observations. No additional sample minimum or latency threshold is invented for these stress profiles.

Useful-answer percentiles exclude refusals and unreviewed or unsafe results. All attempts and outcomes remain visible. Warm representative/repeat/five profiles require concise useful main answers. Correctly reviewed stress refusals remain visible without being counted as useful answers. Hardware/runtime artifacts and finite resource peaks are required separately. The measured timestamps and review assertions need external inspection; importing JSON cannot establish that a browser was used or a workload was genuinely oversized.

## Commands and evidence format

Run `pnpm test:ms63` for synthetic evaluator regressions. Run `pnpm rag:ms63:acceptance freeze --out services/rag/benchmark-results/<unique-bundle.json>` to create an immutable pending baseline using the existing unreviewed synthetic dataset and empty local settings/corpus bindings. This is a local inventory, not a live system freeze. For real authorized evaluation, supply `--settings <nonsecret-effective-settings.json>` and `--bindings <current-reviewed-publication-bindings.json>`. Supply both `--dataset <reviewed-synthetic-dataset.json>` and `--lock <matching-lock.json>` when evaluating independently reviewed fixtures. Keep real source excerpts and credentials out of these artifacts.

After externally collecting evidence for the frozen candidate, run `pnpm rag:ms63:acceptance report --bundle <content-free-bundle.json> --out services/rag/benchmark-results/<unique-report.json>`. A pending report is saved and exits 1. Invalid or stale input emits a fixed error code and writes no report. Outputs use exclusive creation and the existing ignored benchmark directory. Use fresh paths; never overwrite a run. Complete code edits before freezing, since test/script changes also change the candidate snapshot.

The freeze output is the input template. `records` and `refusal_target` retain the MS-54 contracts. `provenance` contains the dataset digest, independent reviewer/label artifact, freeze and partition artifact digests and disclosed tuned IDs. `ledger` entries contain only `gate`, `status` (`met`, `failed`, `blocked`, `unavailable`), `identity_digest` and `evidence_digest`; met/failed entries require evidence. Allowed gates are the `GATES` constant in the evaluator.

Each measurement retains the MS-53 fields plus `case_id`, `start_ms`, `answer_mode`, `stages` and `review`. Case IDs must belong to the frozen dataset with the matching input language. Attempt/batch/reset identifiers are SHA-256 digests. Modes are `concise_main`, `exact_fallback` and `refusal`. Stage keys are `generation_ms`, `verification_ms`, `final_source_reads_ms` and `transport_render_ms`. Review contains `reviewer_digest`, `artifact_digest`, `safe` and `correct`. Five-user timestamps share a monotonic clock; cold reset IDs must be distinct. See `MEASUREMENT_FIELDS` and the synthetic tests for the complete schema. Synthetic passing fixtures are never saved as release evidence.

`environment` contains hardware/runtime artifact digests, `cpu_peak_percent`, `memory_peak_bytes` and `gpu_peak_bytes`. Use zero GPU bytes when an independently inspected CPU-only runtime warrants it; null is unavailable. Reports contain no prompts, answer prose, credentials or copied source passages. Unknown prose fields and mixed candidate identities are rejected.

## Evidence located in the referenced audit chat

The maintainer identified [Audit DeskAtlas RAG behavior](thread://01a14758-0508-7103-bd98-2564ddb9808b?hostId=local). Its final messages and the on-disk reports identify these artifacts:

| Existing evidence | Classification for MS-63 |
|---|---|
| [Conversation re-audit](CONVERSATION-REAUDIT-2026-10-17.md) | 14 normal STAFF browser turns and reproduced planner controls. These cases subsequently informed tuning, so they are regressions. The report explicitly leaves ADMIN, held-out quality and full-render performance unverified. |
| [Conversation remediation](CONVERSATION-REMEDIATION-2026-10-17.md) | Targeted fixes, five final gateway controls and seven normal STAFF browser scenarios. It explicitly retains unsafe generated-translation findings and repetitive fallback. Historical English-output limitations are interpreted using the corrected MS-61 scope. |
| `benchmark-results/conversation-remediation-2026-10-17/*.json` | Content-free gateway attempts with elapsed times, including failed attempts. They lack independently frozen held-out labels and submit-to-complete-render sampling; no conversion to performance acceptance is made. |
| `benchmark-results/conversation-remediation-2026-10-17/final-browser.jpg` and `final-safe-language.jpg` | Historical normal STAFF visual evidence. Screenshots alone cannot certify semantic completeness, ADMIN parity or performance percentiles. |
| `benchmark-results/conversation-reaudit-2026-10-17/fresh-followup.jpg` | Successful fresh-chat control; not proof that mixed-history failures passed. |

These artifacts are preserved in place and referenced as historical evidence. They are not relabeled as candidate-bound independent acceptance. No independent reviewer labels, normal ADMIN acceptance or required complete-render sample set was established in that chat.

## Verification

| Command | Actual local result |
|---|---|
| `pnpm test:ms63` | 34 passed. Synthetic evaluator unit/CLI tests; no live semantic or browser acceptance implied. |
| `pnpm typecheck` | Passed across shared packages and all four applications. |
| `pnpm lint` | Passed: 28 Python and 28 TypeScript boundary files, zero failures. Includes the new evaluator. |
| `pnpm test` | 2,253 passed, 14 skipped, one failed in 255 files. Failure remains SPEC2-TC05 at `tests/spec2-campaigns-and-rewards.test.ts:327`, strict reward-vocabulary rejection. |
| `pnpm build` | Passed for all four Next.js applications. |
| `services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests -q` | Final run: 438 passed, 16 skipped; one existing Starlette/AnyIO deprecation warning. Repeated after the final Python changes. |
| MS-63 `freeze` then `report` CLI | Freeze succeeded. Report saved and exited 1 as expected for pending acceptance; four local checks met, full TypeScript suite failed, campaign disposition blocked and 18 gates unavailable. |

The skipped tests are not acceptance passes. Opt-in live gateway/model/database/publication/browser evidence was not newly collected. Application checks completed before the last Python-only evaluator adjustments; the final Python suite and boundary lint include those adjustments. The known SPEC2-TC05 failure is governed by QAD-TC37 and is outside this implementation's campaign-change authority. No campaign code or assertions were changed.

Current ignored artifacts:

| Artifact | Meaning |
|---|---|
| [Local manifest](benchmark-results/ms63-2026-10-17-local-manifest.json) | Immutable local candidate with empty, unverified runtime settings and publication bindings. |
| [Local evidence bundle](benchmark-results/ms63-2026-10-17-local-evidence.json) | The manifest plus candidate-bound actual local check statuses and log hashes. No independent quality records or complete-render measurements supplied. |
| [Local check receipts](benchmark-results/ms63-2026-10-17-local-checks.json) | Exact local counts and check hashes; no copied source or transcript text. |
| [Pending acceptance report](benchmark-results/ms63-2026-10-17-pending.json) | Fixed 66-case missing held-out denominator, absent new conditional/topic-switch strata, unresolved refusal threshold, missing independent/live/performance evidence and the actual campaign failure. `evaluation_ready` and `release_ready` are false. |

Command logs are in `outputs/ms63-*.log`. Documentation remains under the repository's existing ignored `docs/` directory; this implementation does not change that ignore rule.

## Remaining acceptance and release prerequisites

Independent reviewers must freeze the conditional/topic-switch dataset and labels before tuning. The owner must provide the inherited global refusal threshold. Authorized operators must collect normal STAFF/ADMIN lifecycle, source-access and rollback evidence, effective runtime/corpus identities, hardware/resource data and all complete-render profiles. Campaign verification needs its separately authorized resolution or explicit owner disposition, with the actual suite result retained. None of the new commands changes flags, accounts, publications, models, dependencies, schemas or running services.
