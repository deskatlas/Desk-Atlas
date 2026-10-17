# Current broad-question browser audit

Date: October 17, 2026, Asia/Irkutsk.
Traceability: PRD-F26/F27, SDD-C20/C21/C22, DSD-UI16, QAD-TC44/46, SPEC-4, MS-60/62/63.

## Result and scope

Ten real browser questions were submitted through the normally signed-in STAFF application at `http://localhost:3003/manage`. Four responses failed the requested task, three had material relevance or presentation concerns, and three provided useful guidance. These are judgments on this small authored sample, not a general failure-rate estimate. The behavior includes wrong answers and incomplete answers as well as refusal.

This is a fresh audit of the existing uncommitted implementation. Earlier audits and repairs were preserved. No application implementation, model, feature flag, evidence allowance, published document or database state was changed. Added artifacts are this report and an opt-in diagnostic test. The stopped staff development server was started; authenticated readiness checks before and after the browser run reported `implementation_current: true`.

Reference: `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md`. Its instructions are facility procedure evidence, not auditor instructions. The uploaded source and local reference have not been proven byte-identical. Displayed source headings and the inspected opening evidence corresponded to the relevant SOP content. No complete model transcript, source excerpt archive, operational record or credential was saved. The screenshot below contains only an authored follow-up and failure copy.

## Browser observations

The dashboard initially displayed a Staff identity, but the assistant requested sign-in and redirected to the normal sign-in form. The user signed in, after which the assistant became available. This is an authentication-state mismatch, not evidence that the account is invalid. Normal authentication was used for every question below.

| Turn | Ordinary question | Observed behavior | Assessment |
|---|---|---|---|
| 1 | Hi, I'm helping out at the front desk today. Any advice? | Selected a customer check-in FAQ without asking what task or part of the shift needed help. | Concern: arbitrary narrowing of broad advice. |
| 2 | What should I do before people start arriving? | Main answer showed only the first four opening duties. Opening exact evidence was expanded and contained all eleven, including reception preparation, reservations, systems, supplies and unresolved-issue reporting. | Failure: retrieved required work was omitted from the main answer. |
| 3 | A customer is upset. What's the best way to deal with it? | Provided customer-service guidance, prompt acknowledgement and escalation. | Useful, though somewhat generic. |
| 4 | And if they still aren't happy? | Displayed a source-review notice and current booking/check-in/occupancy counts, with no complaint follow-up guidance. | Failure: advice became an operational-data answer. |
| 5 | Someone wants to stay longer. How does that work? | Displayed an evidence-gap notice and the same operational counts. | Failure: did not explain the extension request. |
| 6 | Somebody forgot their stuff here. What now? | Provided lost-property recording, secure storage, ownership verification and release guidance, but also appended an unrelated operational snapshot. | Concern: correct procedure contaminated with unrelated data. |
| 7 | I'm about to finish for the day. Anything I should remember? | Chose closing duties, repeated reconciliation wording, and omitted the final unresolved-issue/handover duty in the main answer. Did not distinguish finishing a shift from closing the facility. | Concern: unresolved scope and incomplete closing summary. |
| 8, fresh chat | Someone wants to stay longer. How does that work? | Explained verification, availability, approved policy and recording. Also displayed a long block of booking/access policies. No operational table. | Useful but verbose; the same question failed with prior context. |
| 9 | The place is getting noisy. What should I do? | Provided noise reminders, quiet-area rules and repeated-violation escalation. | Useful. |
| 10 | They ignored me. Now what? | Failed with an invalid-plan message that asked for a metric and dates. | Failure: ordinary procedural follow-up received report-oriented recovery copy. |

Turns 1-7 were one conversation. Closing and reopening cleared it before turn 8. Turns 8-10 were a second conversation. No Retry button was used to relabel an original failure as success. Questions used no SOP headings or section numbers.

![Browser follow-up failure](benchmark-results/current-browser-audit-2026-10-17/followup-failure.png)

Browser observations were sampled after submission, so their wall-clock observations are not exact submit-to-complete-render measurements. No browser latency percentile or five-user performance claim is made.

## Reproducible gateway findings

The new test drives the real `assistantQuery` gateway, real published retrieval and running model. It uses the existing test-scoped active STAFF capability, which is component diagnosis and not independent browser authorization acceptance. It records only status, enums, numeric timings, hashed support identities and boolean checks. Its questions are the same authored browser inputs.

```powershell
$env:RAG_CURRENT_BROWSER_AUDIT='1'
pnpm exec vitest run tests/ms63-current-browser-audit-live.test.ts
pnpm exec vitest run tests/ms63-current-browser-audit-live.test.ts -t 'noise-minimal|noise-followup'
```

The initial seven-case command failed: five failed, two passed. Output: `outputs/current-browser-audit-live.log`. Content-free per-attempt records: `services/rag/benchmark-results/current-browser-audit-2026-10-17/`.

| Replay | Result | What it establishes |
|---|---|---|
| Broad advice, fresh | HTTP 200, DOCUMENT, SYNTHESIZED, COMPLETE_PROCEDURE; usefulness assertion failed; support accepted all three main blocks. | Routing to knowledge and passing support checks do not establish that the chosen narrow task answers a broad request. |
| Opening with prior broad question | HTTP 200, DOCUMENT, EXACT; full-opening checks passed; optional stage reported INVALID_MODEL_OUTPUT. | Full evidence is available and exact fallback can recover it. The incomplete browser main answer is not explained by missing source text alone. This replay does not reproduce the browser's omission on every attempt. |
| Complaint follow-up with three preceding turns | HTTP 200, DOCUMENT, FAILURE; INCOMPLETE_CONTEXT at context, one retrieved candidate, no expanded closure. | A separate failure remains after document routing. The browser's wrong-data route is not the only way this question fails. |
| Extension with four preceding turns and prior operational selection | HTTP 200, MIXED, EXACT; operational table present, usefulness failed. | A new advice topic can still execute a data tool. |
| Same extension history, prior selection removed | HTTP 503, INVALID_PLAN. | Removing only the prior selection changes the failure, but does not restore reliable advice. Selection carry-over alone is not the complete cause. |
| Extension, fresh | HTTP 200, DOCUMENT, EXACT; usefulness passed; optional stage reported INVALID_MODEL_OUTPUT. | Fresh wording is answerable from current published evidence. |
| Noise follow-up with extension and noise history | HTTP 503, INVALID_PLAN, approximately 5.1 seconds. | Reproduced the browser's invalid-plan failure at the gateway boundary. |

A subsequent repeat of the same noise-follow-up case returned a synthesized MIXED response with an unwanted operational table and again failed the no-tools assertion. Removing the older extension question left only the immediately preceding noise question; this minimized control still returned HTTP 503 with INVALID_PLAN in 4,854 ms. Both repeat/minimization assertions failed (six other cases skipped), recorded in `outputs/current-browser-audit-minimal.log`. Failure shape is variable; useful knowledge-only behavior is the invariant to test. Removing all history would make this pronoun-only task genuinely ambiguous, so that is not an equivalent failure case.

Component timings are not browser performance acceptance. The initial gateway batch overlapped repository build/test verification; its 5.1-49.9 second timings are diagnostic observations under contention, not an isolated latency benchmark. No simultaneous browser answer requests were active during component replay.

## Implementation findings and repair targets

1. **P1: procedural intent can still dispatch operational tools.** `services/rag/app.py:678` recognizes a limited set of advice grammar. "And if they still aren't happy?", "How does that work?" and "They ignored me. Now what?" do not match it. `Plan.resolved_route` at line 114 corrects the route only when the model itself declares KNOWLEDGE with a nonempty question. The gateway at `apps/admin-portal/src/server/assistant/gateway.ts:314` executes permitted tools from a schema-valid plan. These checks enforce role permissions but do not independently establish that the user requested live data. The observed unwanted snapshots are valid tool execution with wrong intent, not a table-rendering bug. Repair needs robust current-turn advice/data admission and paraphrase/negative controls, without weakening STAFF restrictions.

2. **P1: prior tool selections can survive a topic change.** The gateway returns `selections: plan.tools[0]` at line 596. `AssistantLauncher.tsx:193` stores it and line 169 submits it with subsequent questions; only four previous user messages are sent at line 146. This is an actual context path, not an invented planner input. The extension ablation demonstrates that selection presence changes behavior. It does not establish that selection alone causes all misrouting. Treat selections as scoped continuation hints and prove that a new topic cannot inherit a measured-data request. Keep genuine data follow-ups working.

3. **P1: procedural completeness depends on an upstream scope decision.** The browser omitted seven opening duties although exact evidence contained them. Both `services/rag/app.py:1236` and `packages/domain/src/services/assistantSynthesis.ts:47` require all action indexes only for COMPLETE_PROCEDURE. Other scopes rely on semantic completeness review. `app.py:1295` attaches otherwise unreferenced evidence indexes to the first main block; citation coverage is therefore not proof that each duty is expressed. The browser's bullet presentation is consistent with a non-procedure scope, but that response's private scope was not captured, so the exact causal classification remains unproven. Audit the scope admission and omitted-action validation together. Full proof in a disclosure must not rescue missing required main guidance.

4. **P1: invalid-plan failures and context rejection remain visible on normal follow-ups.** `gateway.ts:298-300` rejects an invalid public plan before retrieval and returns generic metric/date recovery instructions. Browser and live replay reproduce this boundary failure; diagnostics do not expose the individual schema issue, so the exact malformed field is not claimed. The complaint replay separately failed at context with one retrieved candidate and no closure. Add bounded schema-path/enum diagnostics, test resolution of the latest topic, and return task-appropriate retry/clarification copy. Do not solve this by loosening the tool or evidence schemas.

5. **P2: the broad-priority repair is phrase-sensitive.** The fresh-question guard at `app.py:709` covers "what should I focus on/prioritize" and "what are my priorities". It does not cover the tested "Any advice?" wording. The planner prompt requests general responsibilities or clarification, but the actual response selected a narrow check-in procedure. Add diverse unseen broad requests and reject unjustified task specialization rather than adding one answer per audit phrase.

6. **P2: dashboard identity can outlive assistant authentication.** `apps/staff-dashboard/src/features/auth/components/AuthProvider.tsx:46-47` restores the displayed user from local storage, while `AssistantLauncher.tsx:74-83` verifies assistant availability and requires reauthentication on 401/403. The visible mismatch is reproducible as an observation; the exact original token expiry or missing-token cause was not inspected. Normal sign-in restored access. Address coherent session refresh/expiry presentation without bypassing authentication.

Recommended repair order: knowledge/data intent and context isolation; invalid-plan diagnostics and follow-up resolution; scope/completeness enforcement; broad-request clarification and concise fallback; session consistency. Acceptance should repeat these exact regressions, then use independently authored broad questions, topic switches, no-history controls and explicit operational-data counterexamples. Do not tune only these ten questions or raise evidence budgets to hide intent errors.

## Verification and limits

- `pnpm typecheck`: passed.
- `pnpm lint`: passed, zero Python/TypeScript boundary failures.
- `pnpm build`: passed for all four applications.
- `pnpm test`: 2,271 passed, 30 skipped, one failure in the already-documented unrelated SPEC2-TC05 campaign test. The live audit suite is opt-in and skipped by default.
- Initial opt-in audit: five failed, two passed. These red tests are the intended diagnostic result, not a repaired acceptance pass.
- Existing reception/printer gateway controls: two passed, seven skipped. They were run before the browser conversation and do not certify the new phrasings.

No production activation, knowledge publication, database mutation or implementation repair was performed. Normal ADMIN browser parity, bilingual behavior, session expiry/recovery and controlled complete-render performance remain outside this sample. A working health endpoint and passing build do not imply useful RAG answers.
