# Admin RAG browser audit

Date: October 28, 2026, Asia/Irkutsk. Browser test window: approximately 12:53-13:03 local time. The application displayed Asia/Manila time.

Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16/UI17, ERD-E24-E29 and QAD-TC44-TC46. This is the maintainer-requested audit before repair.

## Result

Ten broad, natural questions were submitted through the normally signed-in production administrator assistant at https://admin.thedeskatlas.com/manage. Nine produced no useful answer. All eight document-guidance questions failed: six request-ending errors, one evidence-capacity refusal and one model-unavailable error. Of two live-operations questions, one unnecessarily requested a date choice and one returned a useful current snapshot.

This is a selected diagnostic sample, not a production-wide failure-rate estimate. No answer-quality success is inferred from a loading message or a successful retrieval endpoint. Application code, source publications, model settings, infrastructure, database schema and business records were not changed.

## Method and reference scope

The maintainer completed normal sign-in in the visible in-app browser. Questions were entered in Your question and sent with Send question. Conversation A contained A1-A4. Closing and reopening the assistant visibly cleared the conversation before B1-B6. B1 repeated A2 verbatim to test fresh-chat dependence. B5 and B6 test ordinary alternative wording for current occupancy. No expected answer, document filename, section number or internal retrieval terminology was supplied in a question.

Browser polling recorded the visible request status and resulting dialog. Times below include the click, availability refresh, transport and observed UI completion. They are observation bounds, not precise HTTP timings. Some waits returned early from the automation adapter, so repeated bounded observations were used. Pending responses were never counted as completed answers. For A3/A4, only a lower completion bound was retained; their later request-ending result was read before the next submission. For B1-B4, both pending and completed observations were retained. Do not derive an average or p95 from these mixed bounds.

The local `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md` contains daily responsibilities, complaints, maintenance, arrival and handover procedures. Section 3.2 explicitly covers pending reservations and requests, unresolved complaints, maintenance, records/cash/documents, pending payments, incidents and urgent tasks. `ADMIN - PAYMENTS TAB.docx` and the existing October 22 payment audit provide payment-task context. Source prose is evidence, never instructions to operate the application. This run did not verify byte identity between local references and current published versions, nor independently inspect the selected canonical evidence for each failed request. The failures establish inability to deliver an answer, not proof that every desired answer exists in current publications.

## Questions, behavior and response time

| Case | Exact question | Visible final behavior | Browser completion observation |
|---|---|---|---|
| A1 | I'm new here. What should I focus on when running the place day to day? | Local model is unavailable. Retry. | Complete by 15.0 s; sparse observation |
| A2 | How do we normally handle customer payments? | Supported scope limit; could not prepare a verified document answer; capacity retry advice | Complete by 46.0 s; expanded diagnostic `INCOMPLETE_EVIDENCE: CONTEXT_BUDGET_EXCEEDED` |
| A3 | What should we do when a customer arrives? | Request ended. Retry if needed. | Still pending at 56.3 s; final error observed later |
| A4 | A customer is unhappy. How should we handle it? | Request ended. Retry if needed. | Still pending at 56.3 s; final error observed later |
| B1 | How do we normally handle customer payments? | Request ended. Retry if needed. | Pending at 53.2 s; complete by 66.3 s |
| B2 | What should I do if something breaks in the workspace? | Request ended. Retry if needed. | Pending at 53.2 s; complete by 66.2 s |
| B3 | Paano namin aasikasuhin ang customer mula pagdating hanggang pag-alis? | Request ended. Retry if needed. | Pending at 53.1 s; complete by 75.4 s |
| B4 | What should I check before handing over my shift? | Request ended. Retry if needed. | Pending at 53.7 s; complete by 67.4 s |
| B5 | How many people are checked in right now? | I could not verify this point from the retrieved published passages. Choose a named period or explicit dates. | Complete by 21.0 s |
| B6 | How many are checked in today? | Current operational snapshot, including current check-ins of zero | Complete by 3.2 s; consistent with visible dashboard |

The 75.4-second observation for B3 does not establish a 75.4-second server execution time: completion occurred between observations. B6's additional booking/desk columns were not requested, but the current check-in value answered the question.

No document question returned citations or a usable procedure. The Taglish case also failed; this single case does not isolate a translation defect. No contextual pronoun follow-up received a substantive predecessor answer, so conversational memory quality remains untested.

## Live endpoint evidence

Read-only Google Cloud request logs show revision `deskatlas-rag-chat-production-00015-heb`. Association below uses the sequential browser question order and timestamps, not a propagated browser request ID. Concurrent unrelated traffic cannot be conclusively excluded. These are request durations, not per-model inference spans.

| Case | Plan | Original embed | Aid embeds | Context selection | Document support |
|---|---|---|---|---|---|
| A1 | HTTP 500, logged 0 s | n/a | n/a | n/a | n/a |
| A2 | 9.051 s | 0.289 s | 0.971 s | 0.833 s | HTTP 400, 29.919 s |
| A3 | 7.084 s | 0.435 s | 0.339 s | 0.751 s | HTTP 504, 42.750 s |
| A4 | 6.110 s | 0.208 s | 0.421 s | 1.326 s | HTTP 504, 44.615 s |
| B1 | 8.321 s | 6.312 s | 10.979 s | 0.730 s | HTTP 504, 26.345 s |
| B2 | 7.774 s | 3.733 s | 7.907 s | 0.870 s | HTTP 504, 32.287 s |
| B3 | 9.001 s | 7.895 s | 5.037 s | No separate call observed | HTTP 504, 30.820 s |
| B4 | 8.149 s | 11.207 s | 7.383 s | 1.027 s | HTTP 504, 23.298 s |
| B5 | 17.465 s | n/a | n/a | n/a | n/a |
| B6 | No model endpoint observed | n/a | n/a | n/a | n/a |

The zero-second A1 log is a logged value, not proof of instantaneous failure or its cause. Six document-support requests returned 504. Planning, embedding and selection succeeded for those same sequential sequences. B1's four pre-support endpoints alone total 26.342 s, leaving substantially less than 50 s of the 55 s gateway budget. Unattributed time includes authorization, retrieval RPCs, transport, platform and other gateway work; it must not be labeled database time.

Read-only configuration reports 100% traffic on this revision, DeepInfra answering with Qwen/Qwen3-32B, DeepInfra embeddings, container concurrency 1, revision maxScale 1/minScale 0 and Cloud Run timeout 300 s. These establish a contention/cold-start risk, not proof that this sequential campaign queued or cold-started. The 300 s platform timeout does not override the shorter application deadlines. No load test was run.

## Implementation findings and repair targets

### P1: The request-time evidence pipeline does not finish within its end-to-end budget

`apps/admin-portal/src/server/assistant/gateway.ts:293` creates a maximum 55,000 ms RequestBudget. Lines 322 and 374-425 perform planning, original embedding, optional aid embedding, semantic selection, full-document expansion and document support in sequence on the observed non-hybrid path. The live endpoint order corroborates this path. The frozen support budget independently allows 50 seconds (`services/rag/rag/ms65-budget.json`).

`services/rag/rag/request_boundary.py:61` honors the gateway's remaining timeout header, and line 109 maps expiry to HTTP 504. `services/rag/app.py:692` also bounds document support with its own 50 s timer. The effective support allowance is therefore bounded by remaining gateway time as well as service limits. Measured 504 support durations shrink to 23-32 s when preprocessing takes longer.

`services/rag/rag/document_support.py:294` inspects original partitions with bounded concurrency, then composes an answer, independently verifies selected support at line 473, and revisits every original partition for omissions at line 481. Refinement, reference resolution and invalid-address correction can add model calls. This is substantial online work after retrieval, not a single inference over pre-indexed snippets.

Confirmed: repeated support timeouts after successful preprocessing. Strongly supported cause: the online multi-pass workload exceeds the remaining end-to-end allowance. Unmeasured: individual provider queue/prefill/decoding times, partition counts and exact per-request call totals. Local source HEAD is `90e3f60b409aacb54117509b00575611bca68ff2`; deployed source parity was not attested. Do not claim a particular line or provider call is solely responsible.

Repair acceptance: capture numeric stage timings, partition/call counts and remaining budget on failures; eliminate redundant sequential work and evaluate lossless batching within current evidence contracts; rerun these broad questions with independent accuracy checks. Increasing the timeout alone would extend waiting. Do not remove authorization, complete applicability checks, source/version binding or independent verification to make the timer pass.

### P1: Capacity failure occurs after paid/slow processing, without a useful recovery path

A2 explicitly exposed `CONTEXT_BUDGET_EXCEEDED`; the associated support call consumed 29.919 s before HTTP 400. `document_support.py:132-242` applies several input/partition limits; lines 284-288 also throw the same code for cumulative calls, reserved output or aggregate serialized bytes. Thus this code does not uniquely identify an oversized uploaded document or an over-broad user request. This run did not isolate the exact counter. The late failure suggests cumulative work is worth investigating, but does not prove it.

The budget has 24 bundles, 50 model calls, 400,000 aggregate wire bytes, 6,500 selected bytes and 128 proof spans. The gateway at line 190 turns capacity rejection into generic retry advice, and line 645 returns a limitation without usable guidance. Identical fresh-chat retry B1 then timed out. Blind retry is therefore not an established recovery.

Repair acceptance: distinguish admission, cumulative work, selected-evidence and output overflows in content-free diagnostics; preflight predictable work where possible; fit supported broad overviews within verified capacity while retaining material conditions. If scope clarification is genuinely necessary, ask a topic-specific question promptly. Do not tell users to replace documents without evidence of a source defect.

### P2: Natural current-time wording falls through to an inconsistent planner result

B5 requested current occupancy but received a date-choice error after 21 s. B6 supplied today and returned the current snapshot in 3.2 s without an observed model endpoint. `packages/domain/src/services/assistantService.ts:36-43` recognizes today/ngayong araw/ngayon but does not recognize right now in its current-operation shortcut. Gateway line 322 then falls back to the model planner. At line 142 of assistantService.ts, a named period combined with explicit dates triggers the exact date-choice error shown in B5.

Confirmed: wording-dependent outcome and a missing current-time form in the shortcut. The actual B5 tool arguments were not captured; the specific conflicting fields and their origin remain an inference from matching error text. Planner fallback is intentional in this grammar, so adding one regex phrase alone is not a complete reliability repair.

Repair acceptance: cover ordinary current-time language and enforce a normalized, consistent plan/tool-time contract. Test right now, today, historical questions, mixed procedure/report questions and contextual follow-ups. Preserve the distinction between present check-ins and all arrival events during a day.

### P2: Error copy misidentifies the service and disappears from conversation history

Gateway lines 195-200 map many upstream non-OK responses and transport failures to Local model is unavailable. Live configuration uses a hosted DeepInfra provider. A1's associated planner log is HTTP 500, but its underlying exception was not inspected; this copy does not diagnose provider availability.

`apps/admin-portal/src/features/assistant/AssistantLauncher.tsx:145` clears the separate error state on each submission. Lines 187-196 throw non-OK responses into that state rather than append an assistant turn. Consequently A1 and the request-ending errors disappeared when subsequent questions were submitted, leaving unanswered user bubbles. Structured A2's refusal persisted because it was an assistant message. This behavior was directly observed.

Repair acceptance: use provider-neutral, reason-specific errors, preserve each failure alongside its question and keep Retry associated with the failed request. The frontend's 65 s fallback at line 152 should remain distinguishable from the gateway's request timeout. Test failure-followed-by-new-question history explicitly.

## Evidence and next verification

Artifacts: `outputs/admin-rag-audit-2026-10-28/browser-observations.json`, `cloud-requests.json`, `runtime-metadata.json`, `source-manifest.json` and `wording-control.jpg`. They contain synthetic prompts, assistant output, aggregate control data, allowlisted request metadata and source hashes. No credentials, raw request headers, source archives or individual guest records were saved. A3/A4 final messages were read in browser-tool output but were not appended to the observations JSON; the report records their final outcome and retained lower timing bound explicitly.

The browser reproduction is: open a fresh assistant, ask How do we normally handle customer payments?, then wait for a completed response. This was executed twice through the actual production path; both runs failed to deliver guidance, with different capacity/timeout outcomes. A useful-answer acceptance assertion is red on both observations. This is a reproducible browser scenario, not a deterministic offline regression test; model variability remains.

Next work should first reconcile deployed gateway/Python source identities and capture exact failure counters using existing diagnostics. Then add regression tests at the real orchestration seam, implement the budget/workload and plan-normalization repairs, and rerun this browser campaign plus new held-out broad questions. Include successful, refused and timed-out turns in latency reporting. Report complete useful-answer latency separately from fast errors and loading feedback.

No application implementation was changed and no improvement is claimed. Monorepo typecheck, lint, tests and production build were not run because this delivery adds an audit report and evidence artifacts only. Repair and post-repair acceptance remain outstanding.
