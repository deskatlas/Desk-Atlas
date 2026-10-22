# Admin payment guidance repair

Date: October 22, 2026 (Asia/Irkutsk).

Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16/UI17, QAD-TC44-TC46, SPEC-4/SPEC-5/SPEC-6 and MS-65. The maintainer authorized implementation after the [browser audit](../../docs/reviews/admin-payments-rag-audit-2026-10-22.md).

## Problem and implemented behavior

The audited production administrator assistant could retrieve a published payment guide but its configured legacy reader rejected the guide's ms65-v1 support contract. The displayed recovery incorrectly instructed operators to replace the document. A fresh broad question also lost its payment topic to a generic clarification shortcut.

The repair keeps reader choice explicit. Production knowledge availability and query ingress reject missing or unknown reader configuration before inference. Explicit legacy readers remain supported for compatible older corpora. When a legacy expansion returns REPROCESS_REQUIRED, the gateway checks the retrieved versions' support metadata. An ms65-v1 publication produces a reader-compatibility service failure with configuration recovery, while a genuine legacy preparation failure retains source review. This check applies to both initial and reconsidered expansion. Diagnostic codes remain in the existing disclosure, not ordinary recovery prose.

The compatible path selects relevant document roots by source meaning before full-document expansion. It keeps materially contrary rules and distinct requested facts, deduplicates roots from the same immutable version, and rejects fabricated addresses or unresolved task ambiguity. It does not apply the legacy DOCUMENT_WIDE rejection to this full-document reader. Every canonical unit of each selected authorized generation is still inspected and independently checked for omissions before release.

Live component testing after the initial configuration repair exposed additional reader issues, addressed in the same pipeline:

- A reference flagged in one partition is resolved against the selected canonical evidence before being declared missing. A genuinely absent necessary reference still fails.
- Adjacent FAQ questions and answers are paired as one exact source slice when the existing 1,500 UTF-16-unit ceiling permits. This preserves the conditions of answers such as No and their pronouns. Adjacent questions, headings, tables and fenced content are not merged by this rule.
- Both internal and customer document inspection use the existing lossless addressed transport. Source UUIDs and offsets remain canonical server state. Repeated text retains every original occurrence and context.
- An invalid inspection address receives at most one correction using the identical source bundle and an explicit allowed-address list. A second invalid selection fails. No invented address is silently discarded.
- Live browser testing identified FAQ numbers being emitted as citation addresses during composition. The draft's generated JSON schema now bounds citation integers to the supplied canonical evidence range. Pydantic and final span-binding validation remain independent checks.
- The existing source-sentence refinement also applies to internal evidence above the frozen selection budget. Paired FAQs remain atomic. All original partitions are rechecked after refinement, so dropping a required restriction still fails.
- Internal composition proposes a draft. It cannot independently declare policy absent or contradictory. Independent relevance, entailment, completeness, consistency and safety checks determine release; they can still reject the draft or report a real conflict. The COMPLETE draft marker is not an acceptance result.
- The verified internal capability supplies the caller role to document inspection. Uploaded prose cannot select that role. Procedural guidance can preserve role and status preconditions conditionally without requiring a live customer record. Generation remains read-only.
- Final document revalidation uses the existing actor/scoped full-document RPC once per snapshot rather than multiple network batches of individual chunks. Every cited and uncited inspected chunk must match the original validated snapshot exactly. Final actor and catalog checks remain mandatory. Withdrawal, changed, missing and duplicate chunks prevent release.
- Redundant inline citation annotations are removed from generated draft prose only when their addresses exactly match the structured support field. Mismatched annotations fail. This happens before every independent answer and omission check; canonical quotations are unchanged.

No database migration, source replacement, provider change, dependency installation or model replacement is required. The continuation below records the explicit partition-concurrency candidate change. Existing source hashes, UTF-16 offsets, audience/scope checks, signed service capabilities, independent verification, withdrawal checks and final identity/catalog revalidation remain enforced.

## Release compatibility gate

The authenticated service health response advertises its supported evidence contract. The new read-only preflight checks scoped active publications, current embedding fingerprint, service readiness and advertised reader support. It paginates document/version metadata and checks the catalog again before returning. A missing reader, incompatible legacy reader, unknown contract, unverified service capability or changing catalog exits nonzero. It emits fixed reason codes and counts without credentials or source content.

```powershell
pnpm run rag:evidence-readiness --env-file=apps/admin-portal/.env.local
```

For evaluating a proposed configuration before saving it:

```powershell
pnpm run rag:evidence-readiness --env-file=apps/admin-portal/.env.local --contract=ms65-v1
```

The override is explicitly labeled candidate_override. It changes no configuration and does not attest that a deployed gateway uses that contract. Run again without an override against the effective release environment before enabling the deployment.

The existing MS-65 database migration 028 and the current embedding generation must already be installed. Deploy the matching service first, verify its authenticated health and evidence contract, then configure `RAG_EVIDENCE_CONTRACT=ms65-v1` on the admin gateway and redeploy it. Staff gateways sharing the corpus need the same explicit choice after their own verification. Merely editing a Vercel project variable does not update an existing deployment. Do not revert a gateway to a legacy reader while retaining publications requiring MS-65. Roll back gateway and service to mutually compatible revisions and keep incompatible readers disabled.

Examples now explicitly select ms65-v1 under these prerequisites; runtime code does not silently upgrade a legacy deployment. Production configuration and deployment have not been changed by this implementation.

## Reproduction and verification

The original read-only legacy reproduction remains intentionally red: legacy readers must continue rejecting MS-65 evidence. Removing that safeguard is not the fix.

```powershell
node scripts/audit-admin-payment-evidence.cjs 'C:\Users\reyna\Downloads\ADMIN - PAYMENTS TAB.docx' --assert-legacy-answerable
```

The local component replay uses the real gateway, existing active administrator checks, scoped published corpus, configured hosted encoder/model and independent support verification:

```powershell
node scripts/replay-admin-payment-audit.cjs http://127.0.0.1:3010
```

It is restricted to loopback. Its ephemeral signed operator session is component-test authorization, separate from a normally signed-in browser. It persists no product conversation state and performs no business mutations. It prints the synthetic question and policy answer because this user-authorized audit checks answer behavior; never run it with private customer questions or send its output to application telemetry.

Focused regressions include production configuration admission, mixed legacy/current publication compatibility, service capability verification, broad English/Taglish questions, preservation of actual source-review recovery, irrelevant-document admission, source withdrawal, fabricated evidence bindings and indexes, FAQ/Unicode fidelity, cross-partition references, conditional role guidance, actual conflicts and distant omitted restrictions after refinement. Test fixtures for older reader suites now provide explicit legacy support metadata for the new compatibility read; their assertions remain unchanged.

The pre-existing package.json conflict was resolved by retaining the upstream script set, which already contained the stashed script, then removing conflict markers. No existing script entry was discarded. No unrelated deployment files or business logic were changed.

## Verification results

Normal sign-in at the isolated local admin was completed by the maintainer. The ordinary browser question "I think I rejected a payment by mistake. How can I fix it?" returned an evidence-based five-step answer with six source citations after the citation-schema repair. It covered Inspect Proof, reviewing the receipt and rejection reason, conditional Reconsider & Approve, and allocation afterward. The earlier invalid-selection response remains visible above that successful retry in the screenshot, preserving the actual test history.

The local component replay is separate from that normal browser verification. The eight-case replay after the citation repair returned six supported answers and two timeouts. Successful cases covered reconsideration, allocation after approval, unreadable receipts, rejection reasons, Taglish approval checks, and the maintainer's original direct question. Successful response times ranged from 27.2 to 51.1 seconds. This is an observation, not a latency guarantee.

Subsequent replay after snapshot revalidation and overview guidance returned a supported orientation answer in 43.7 seconds. The generic payment-review question still hit OUTPUT_BUDGET_EXCEEDED. A final focused repeat also reproduced an orientation output limit, confirming that a single successful replay does not establish reliability. Earlier attempts also showed timeouts and output limits. These failures are retained in the replay artifacts; the implementation must not be described as eight reliably passing questions or as fully release-ready.

Checks on the implementation:

| Check | Result |
| --- | --- |
| pnpm typecheck | Pass |
| pnpm lint | Pass |
| pnpm build | Pass across all four applications |
| Focused TypeScript regressions | 65 passed |
| Complete Python RAG suite | 664 passed, 16 skipped, one existing Starlette deprecation warning |
| Complete TypeScript suite | 2,523 passed, 43 skipped, four pre-existing failures |
| Candidate reader compatibility preflight | COMPATIBLE: 18 active publications, eight requiring ms65-v1 |
| Saved configuration without override | Correctly rejected as READER_NOT_CONFIGURED |

The four unrelated TypeScript failures remain in MF71/MF78 email subject assertions, the MF79 payment queue source-string assertion, and the MS35 DrawSQL/schema column comparison. Their implementations and expectations were not changed for this repair.

The final local code does not replace the payment document, alter business records, publish a replacement or deploy production. Production still requires the matching service release and explicit gateway configuration described above. Remaining broad-question output capacity and latency failures are open acceptance issues, not suppressed diagnostics. MS65's frozen-work and acceptance requirements in docs/milestone/ms65.md require the milestone to remain incomplete when correctness or performance fails. No deadline, per-pass token cap or aggregate limit was silently increased to obtain a green replay.

Artifacts are under outputs/admin-payments-repair: browser-supported.png, acceptance-replay.jsonl (eight-case replay), revalidation-replay.jsonl, orientation-replay.jsonl, final-focused-replay.jsonl and typescript-checks.log. Earlier replay.jsonl and final-replay.jsonl are intermediate runs, not acceptance claims. Temporary raw-source fixtures and diagnostic instrumentation were removed.

## Continuation: broad questions and operational counts

The maintainer reported that "how many check ins today" no longer returned data. The signed-in production chat reproduced the filter error "Operational snapshot supports only the current business day and optional floor." The current-day shortcut covered booking counts but missed check-in phrasing, leaving the model to supply redundant period filters. The domain boundary now normalizes only period=today for the fixed current-day snapshot. Other periods, extra filters, explicit date combinations and role restrictions still fail closed. The shortcut now recognizes ordinary current check-in counts, including the tested English and Taglish variants; mixed requests still use the planner.

The ordinary signed-in local browser returned the operational table with 3 current check-ins and 5 qualifying scheduled bookings at the observed business timestamp. These are distinct metrics: current check-ins are not all arrival events during the day. The three-case component replay returned exact live tables in 0.85 to 1.62 seconds. See browser-check-in-data.png and check-in-data-replay.jsonl. Production has not received the code change.

Broad-question tracing identified excessive topic selection followed by post-selection evidence overflow, rather than establishing a generated-token overflow. It also exposed a mechanical packing defect: two selected sentences from one original unit were merged using their outer bounds, reinserting all discarded intervening prose. Refinement now keeps nonadjacent runs as separate exact canonical spans and joins only adjacent runs. Every original partition is still checked for an omitted necessary restriction. Regression tests demonstrate both successful removal of irrelevant intervening prose and rejection when that prose contains a required qualifier.

Document relevance compares candidate passages grouped by their immutable version. The model sees only bounded document indexes; canonical identities remain server-owned. The service maps a chosen document back to its authorized seed. It never chooses documents from a filename allowlist.

Internal inspection proposes short answer fragments with source addresses. Selection is mechanically derived from those addresses; model-authored fragments are never final evidence or released prose. Each partition's schema enumerates its actual allowed addresses, preventing FAQ numbers and another partition's addresses from creating correction round trips. If selected exact evidence still overflows, scope assessment and a bounded draft-assisted sentence refinement run under the existing total work limits. Final composition, entailment, consistency, safety and independent full-document omission checks remain mandatory.

The first concurrency candidate changed internal partition concurrency from 1 to 2. After a repeated broad review question still timed out, the next frozen candidate explicitly sets internal partition concurrency and service inference slots to 3. Customer partition concurrency remains 2. All other MS65 budget values remain unchanged, including the 50-second service deadline, 6,500 selected bytes, 128 proof spans, 50 calls, 400,000 aggregate bytes and 120,000 aggregate reserved output tokens. The changed budget digest invalidates older acceptance manifests; it is not an unreported fallback or a relaxation of inherited acceptance thresholds. Tests verify that every partition is inspected, the selected concurrency ceiling is enforced, a distant omitted restriction prevents release, and failure cancels other in-flight partition work.

The first two-case measurement of concurrency 2 returned SUPPORTED for payment review in 53.1 seconds and orientation in 48.9 seconds, including gateway transport and final checks. A later repeat timed out on review. These timings remain close to the gateway deadline and do not meet the inherited typical-answer latency target. The partial continuation replay is recorded separately in continued-final-replay.jsonl; it was stopped to test the next candidate and must not be presented as a completed eleven-case pass. Earlier packing, scoped, grouped and draft-selection replay files record failed intermediate candidates and must not be treated as acceptance passes. Concurrency 3 repeat measurements are in concurrency-three-replay.jsonl.

The first concurrency 3 repeat set returned three supported responses and one orientation evidence overflow. The subsequent candidate adds explicit minimal-support descriptions to the draft citation schema: equivalent FAQ/body rules are alternative support, not cumulative evidence obligations. This changes selection instructions, not proof capacity or required policy coverage. minimal-support-replay.jsonl includes the repeated broad orientation/review measurements with numeric Server-Timing stages. Final source revalidation is a fraction of a second in these observations; hosted inference is the dominant remaining latency cost.

The minimal-support repeat set returned three supported answers: orientation at 37.9 seconds, review at 40.8 seconds and orientation again at 38.0 seconds. These are component observations on the local gateway with real published evidence and the configured hosted model. When an additional normal-browser broad-question check was attempted, the browser tool reported that local browser use was disabled in Work settings. That additional browser check was not performed. The earlier normal sign-in and check-in-data browser result remains valid; component replays must not be relabeled as browser verification. The remaining regression questions are recorded in continued-regression-replay.jsonl.

One remaining allocation answer failed deterministically after composition because a block cited the same valid span three times. Distinct evidence was valid; rejecting repeated addresses prevented independent verification from running. Generated block support is now deduplicated before any verifier sees it. The implementation never removes a distinct reference, rewrites a canonical quotation or accepts an unknown address. Tests demonstrate that duplicate valid citations pass independent checks while fabricated addresses still fail before release. The allocation-repeat-replay.jsonl artifact retains the pre-fix failures; final-citation-repair-replay.jsonl records allocation twice and the broad orientation/review questions after the fix.

Inspection schema-invalid output now receives the same single bounded correction as an invalid returned inspection address, with the original bundle and explicit allowed addresses. A second invalid result fails, and independent policy verdicts are never retried. A separate presentation regression verifies that an empty relevant-document selection reports an evidence gap rather than claiming the service is unavailable.

The first post-citation-fix allocation answer passed. Its repeat and a subsequent orientation attempt failed during the 10-second retrieval read, with substantial auth/catalog delay, while the complete TypeScript suite was also running. The next review attempt recorded invalid output followed by catalog deadline exhaustion. Those contended observations remain in final-citation-repair-replay.jsonl and are not reported as clean passes. After the complete test workload finished, the unchanged candidate was replayed again: review returned SUPPORTED in 43.9 seconds and allocation returned SUPPORTED in 27.3 seconds, with all independent checks passing. See idle-replay.jsonl. This is evidence of the observed workload difference, not proof that every retrieval outage is caused by local tests or a guarantee of reliability under load.

All eight authored document questions and the three current-operation questions produced supported answers during the latest candidate's separate runs, including repeated orientation/review and the repaired allocation answer. They were not all accepted in a single clean repeated batch. Historical failed attempts are retained. Hosted inference remains slow, and database-read timeouts under the contended run remain a material acceptance limitation. The inherited latency and one/five-user acceptance requirements are not certified by this audit.

After removing all tracing wrappers and restarting the normal isolated service, the compatibility preflight passed. The final English check-in, booking-count and Taglish check-in probes all returned SUPPORTED live tables in 0.72 to 0.97 seconds, with 3 current check-ins at the observed timestamps. See final-data-replay.jsonl. The successful candidate override checks local release compatibility; the saved production flag is still not configured by this task.

Continuation checks: 676 Python tests passed with 16 skipped and the existing Starlette deprecation warning. Focused TypeScript checks passed 107 tests. The final full TypeScript suite passed 2,525 tests with 43 skipped and the same four unrelated baseline failures; see final-typescript-checks.log. Build, typecheck, lint and the candidate reader preflight passed. Temporary trace wrappers and diagnostic probes were removed after diagnosis. Production configuration, publications and deployments remain unchanged.
