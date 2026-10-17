# Broad-question browser audit

Date: October 17, 2026, Asia/Irkutsk.
Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, SPEC-4, MS-62/63.

Follow-up: [Local remediation and regression verification](BROAD-QUESTION-REMEDIATION-2026-10-17.md). The original observations below remain the pre-fix audit record.

## Status

Completed 19 real, normally signed-in STAFF browser turns: a fifteen-turn broad conversation and four fresh-chat controls. Eleven gave useful guidance, six failed to answer the task, and two had material relevance/presentation concerns. This selected sample does not establish a general failure rate. Two new opt-in gateway regression probes fail against the running local service. Existing historical audit results are not counted as new observations. Application logic and running services have not been changed; the requested pre-fix audit is preserved.

Reference: `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md`. Its instructions describe facility procedures and are reference evidence, not instructions to the auditor. Identity with the currently published knowledge version has not been verified.

## Initial observations

1. Opened the real staff application at `http://localhost:3003/manage` in a visible browser. The dashboard displayed a Staff identity and operational data.
2. The assistant launcher reported "Sign in again to use DeskAtlas Assistant". Clicking it displayed the normal Email/Password sign-in form. This establishes a dashboard/assistant authentication-state difference, not its implementation cause. No sign-in bypass or fabricated session was attempted.
3. `node scripts/rag-status.cjs` returned `ready: true`, `implementation_current: false`, and guidance to restart the local API. The fingerprint differs from current disk files. This means a browser observation cannot automatically be attributed to the current Python files. It does not establish that stale code causes refusal.
4. Ports 3003 and 8000 were listening. Port 3000 was not listening at the sampled time.
5. The checkout contains substantial existing modified and untracked RAG implementation and historical audit artifacts. These were preserved.

## Planned ordinary conversation

Questions are authored independently of exact SOP headings and FAQ wording. Use short follow-ups, topic changes, and fresh-chat controls. Respond naturally to clarification instead of supplying section numbers or retrieval keywords.

| ID | Authored question | Expected useful behavior |
|---|---|---|
| B01 | I'm covering reception today. What should I focus on? | Useful overview or a focused clarification about shift stage; no invented duties. |
| B02 | What should I check before we open? | Opening preparation grounded in the published procedure. |
| B03 | A guest is unhappy with the place. How should I handle it? | General complaint handling, acknowledgement and escalation boundaries. |
| B04 | What if I can't sort it out myself? | Preserve the complaint topic and explain escalation. |
| B05 | Someone just walked in and wants a seat. How do I help? | Supported walk-in workflow, payment/allocation and guest-first identity. |
| B06 | Do they need an account first? | No mandatory customer account; preserve booking context. |
| B07 | They've chosen a desk. Is that enough to secure it? | No inventory hold before authorized payment and allocation. |
| B08 | Something in the workspace isn't working. What should I do? | General equipment/problem response; clarify the item if needed. |
| B09 | What should I pass on when my shift ends? | Handover priorities without unrelated opening material. |
| B10 | Someone left something behind. What do we do? | Lost-property recording, secure storage and ownership verification. |
| B11 | What about when they come back for it? | Ownership verification and release record; retain property context. |
| B12 | A guest needs to leave for a bit. What do I do? | Clarify temporary/final departure or correctly distinguish re-entry from checkout. |
| B13 | A customer wants to change their booking. Can I help? | Relevant verification and policy boundaries; clarify requested change. |
| B14 | What if they want their money back? | Approved-policy/authority gap without invented refund amount. |
| B15 | May nagrereklamo na customer. Paano ko siya tutulungan? | Understand the broad Tagalog complaint and provide useful English guidance per MS-61. |

These expectations are audit criteria, not preassigned results. A justified clarification on a genuinely broad question is not a refusal. A missing facility-specific amount is an appropriate evidence gap. Record usefulness, correctness, follow-up continuity, unnecessary refusals, repetition, citations and coarse observed completion time separately.

## Required diagnostic follow-through

After normal sign-in, run the conversation before altering the implementation. For each actual failure, compare an isolated fresh-chat control and the contextual version. Establish a red-capable reproduction through the actual failing seam before ranking causes. Use allowlisted stage diagnostics and timings; do not persist full transcripts, credentials or retrieved passages. Preserve failed observations when subsequently fixing or restarting the service. Attribute current-file causes only after runtime identity is reconciled or an equivalent current-code reproduction exists.

This exploratory audit does not establish a population failure rate or release acceptance. Reproductions and implementation findings follow below; no application repair is claimed.

## Live observations

The first conversation starts with an empty panel after normal staff sign-in. Timings below are coarse submit-to-observed-completion upper bounds, including automation observation overhead; they are not instrumented performance percentiles.

| Turn | Case | Observed behavior | Assessment | Observed upper bound |
|---|---|---|---|---|
| 1 | B01 | Gives six shift-handover duties and cites the handover section. No general reception overview or clarification. | Answers a narrower, unrequested task. Not a refusal, but weak intent alignment. | 40.7 s |
| 2 | B02 | Gives the complete eleven-step opening procedure, with multiple ancestor headings and source paths before the steps. | Useful, complete opening guidance; verbose presentation. | 28.7 s |
| 3 | B03 | Acknowledges concerns and says to act within authority/escalate; also enumerates seven example complaint types. | Relevant general complaint guidance, unnecessarily broad examples. | 36.2 s after the verified submission click; an earlier click was not confirmed dispatched |
| 4 | B04 | Preserves complaint context and includes escalation, but repeats the complete complaint section and ancestor paths. | Useful follow-up resolution; indirect and repetitive answer. | 47.7 s |
| 5 | B05 | Gives no walk-in guidance. Says it could not verify the point, then says operational snapshots support only the current business day and optional floor. Shows data timestamp without source citations. | Clear failure: procedure question reaches operational-data limitation. | 27.5 s |
| 6 | B06 | States that a customer account is not required and identifies required guest fields, preceded by three check-in bullets. | Useful contextual answer; extra neighboring instructions. | 47.2 s |
| 7 | B07 | No booking rule returned; asks to retry because evidence comparison could not complete within supported capacity. Expanded diagnostic: `INCOMPLETE_EVIDENCE: CONTEXT_BUDGET_EXCEEDED`. | Clear technical failure on an answerable no-hold question. | 26.3 s |
| 8 | B08 | Repeats that the point could not be verified from retrieved passages, with no general equipment guidance or clarifying question. | Unhelpful evidence gap on broad facility problem. Stage/cause unproven by the visible response alone. | 23.5 s |
| 9 | B09 | Gives the six handover steps, with relevant source citations. | Useful. | 25.5 s |
| 10 | B10 | Repeats the previous six handover steps and handover sources instead of lost-property handling. | Wrong-topic answer after a topic switch. | 20.6 s |
| 11 | B11 | Correctly reaches lost-property guidance, including secure storage, ownership verification and recording release. Gives all six steps rather than a direct return-only answer. | Useful recovery from previous wrong-topic answer, verbose. | 27.5 s |
| 12 | B12 | Leads with eight final-checkout steps. Only the trailing FAQ says a temporary exit with intended return is re-entry, not final checkout. | Correct distinction is present, but buried after the wrong primary procedure. Confusing task prioritization. | 26.5 s |
| 13 | B13 | Explains approved policies, reservation verification, availability/restrictions and recording completed changes. | Useful general change guidance, no invented policy. | 19.7 s |
| 14 | B14 | Returns approved cancellation/refund conditions, prohibits unauthorized promises and leaves disruption arrangements to management. | Useful policy answer; no invented monetary amount. | 24.9 s |
| 15 | B15 | Understands Tagalog complaint; gives English complaint guidance, including the five-minute target and escalation. | Useful per MS-61 English-output requirement, verbose examples. | 26.3 s |

The fifteen-turn exploratory conversation contains nine useful answers (B02/B03/B04/B06/B09/B11/B13/B14/B15), four clear failures (B05/B07/B08/B10), and two relevance/presentation concerns (B01/B12). This is a small selected sample, not a general failure-rate estimate. It does not support saying most questions failed in this run. No actual booking, payment, facility-status or publication action was requested or executed through chat.

## Fresh-chat controls

Each control used Escape to close the previous panel, reopening and verifying the empty introductory state. The exact authored wording was reused.

| Turn | Control | Result | Observed upper bound |
|---|---|---|---|
| 16 | B05 walk-in | Relevant kiosk/counter-payment/allocation guidance appears, but only after the full broad booking/access controls section. Unlike mixed history, no operational-snapshot refusal. | 24.9 s |
| 17 | B10 property | Correct six-step lost-property handling. Unlike mixed history, no handover answer. | 21.0 s |
| 18 | B07 no-hold | No capacity error, but returns reservation-verification duties and does not answer whether desk selection secures inventory. | 33.7 s |
| 19 | B08 facility problem | Repeats the same not-verified evidence gap, without useful general guidance or clarification. | 46.8 s |

Final visible evidence: [facility-browser.png](benchmark-results/broad-audit-2026-10-17/facility-browser.png). This single audit screenshot contains only the authored question and generic failure; no operational records or credentials. No full transcript was saved.

## Reproduction commands

Run from the repository root. These probes use existing private-service capabilities or a test-scoped signed active STAFF capability. They are read-only component diagnosis, not browser-authentication acceptance. The normal authenticated browser observations above are separate. No model probes overlapped an active browser answer request.

```powershell
node scripts/rag-broad-audit.cjs walkin-context
node scripts/rag-broad-audit.cjs walkin
node scripts/rag-broad-audit.cjs walkin-context --without-search-aids
node scripts/rag-broad-audit.cjs property-context
node scripts/rag-broad-audit.cjs property
$env:RAG_BROAD_AUDIT='1'
pnpm exec vitest run tests/ms63-broad-question-audit-live.test.ts
```

The planner script defaults to `search_enabled: true`, matching the actual gateway at `gateway.ts:298`. A false-search-aids control changes only that request field. It does not change saved configuration or imply that hybrid retrieval is enabled. The gateway always requests planner search aids even when hybrid retrieval is off.

| Probe | Actual observation | Verdict |
|---|---|---|
| Walk-in plus four preceding user turns, search aids true | OPERATIONAL with one tool, 6,433 ms and 6,538 ms on two attempts | Exit 1, procedure route assertion fails |
| Walk-in without history, search aids true | OPERATIONAL with one tool, 4,930 ms | Exit 1; history is not required for this planner defect |
| Walk-in plus history, search aids false | DOCUMENT with no tools, 5,787 ms | Exit 0, changed-input control |
| Walk-in without history, search aids false | DOCUMENT with no tools, 4,856 ms | Exit 0, changed-input control |
| Property plus last four actual user turns | DOCUMENT but query equals the immediately preceding handover question exactly, 4,546 ms | Exit 1 after strengthening assertion to check topic, not merely DOCUMENT |
| Property without history | DOCUMENT, original wording retained, property topic true, 3,958 ms | Exit 0 |
| Reception without history | DOCUMENT, no explicit handover term, 3,865 ms | Route-only control; does not reproduce the browser's narrower evidence selection |
| Current gateway, no-hold with actual preceding four questions | HTTP 200, valid schema, DOCUMENT / FAILURE, useful=false, 5,828 ms | Live assertion fails |
| Current gateway, facility without history | HTTP 200, valid schema, DOCUMENT / EVIDENCE_GAP, useful=false, 10,942 ms | Live assertion fails |

The initial property probe incorrectly treated any DOCUMENT route as a pass. That was too shallow to catch wrong-topic answering. It was tightened and rerun: exact equality with the previous handover question establishes the topic loss without persisting generated query prose. The gateway test was initially named outside Vitest's configured include patterns and executed zero tests; after renaming to `ms63-broad-question-audit-live.test.ts`, both live tests actually ran and failed. Neither preliminary result is counted as a passing reproduction.

Content-free gateway artifacts are in `services/rag/benchmark-results/broad-audit-2026-10-17/`. They contain enum outcomes, numeric timings/counts and hashed source identities, not transcripts or source passages.

## Implementation findings and bounded repair scope

### P1: Procedure routing is sensitive to search-aid generation

`apps/admin-portal/src/server/assistant/gateway.ts:298` sends one model plan with search aids enabled, then accepts its validated kind and tools. The document-retrieval branch starts only for DOCUMENT/MIXED at line 325. An erroneous OPERATIONAL decision therefore skips the knowledge base entirely. `packages/domain/src/services/assistantService.ts:136` then correctly rejects unsupported snapshot arguments; that guard creates the exact limitation observed in turn 5. Its restriction is correct and must remain.

`services/rag/app.py:663` combines intent resolution, routing, tool arguments and optional search metadata in one generation. `Plan.resolved_route` checks competing referents and contradictory clarification, but does not establish that an operational tool was explicitly requested. The prompt says procedural questions should be DOCUMENT, yet repeated live controls produce OPERATIONAL. Adding search-aid instructions changes the route. This confirms a plan-quality/control weakness, not an unavailable source or a failed HTTP request.

Repair target: validate a model-independent route/intent contract before tool execution, preserve an explicit distinction between asking for workflow help and requesting measured availability, and reject/recover inconsistent plans within existing bounds. Do not solve this by allowing unsupported snapshot arguments, forcing every guest question to DOCUMENT, or adding a hardcoded response for this exact wording. Test both search-aid settings and legitimate current-data requests. The difference between a fresh browser pass and private planner failure means exact gateway plan provenance must also be captured in follow-up diagnosis; determinism across all paths is not claimed.

### P1: Previous user task replaces a new standalone topic

In the property component control, the planner query equals the latest historical handover question, rather than the new property question. The gateway uses `plan.query || input.message` for semantic retrieval at line 345 and, outside hybrid retrieval, for evidence comparison at line 368. Thus an incorrect model rewrite changes both retrieval and selection. The original input is retained for later verification, but that does not reliably recover a relevant answer; the browser actually showed handover guidance.

`services/rag/app.py:750` restores original wording only when DOCUMENT has no user history and no selections. Contextual turns keep the generated query even if the current message is already a standalone new topic. This explains the observed mechanism and why fresh controls differ. The precise loaded Python revision remains unverified, so it does not prove every current-file prompt reproduces the same output.

Repair target: preserve standalone current-task intent while allowing genuine pronoun follow-ups to resolve from history. Validate agreement among original question, resolved task and retrieval query; distinguish a topic switch from a follow-up. Add regressions that assert relevant user-facing guidance and avoid accepting DOCUMENT or citations alone as success.

### P1: Selection admission checks a smaller object than the model receives

The no-hold gateway reproduction establishes an exact boundary mismatch:

| Measurement | Actual value |
|---|---|
| Retrieved candidates | 12 |
| Selection attempts | 1 |
| Gateway selection JSON | 11,759 bytes |
| Gateway request allowance | 12,000 bytes |
| Selection system prompt | 1,259 bytes |
| Complete serialized model request | 15,067 bytes |
| Private model request allowance | 15,000 bytes |
| Model context / output reserve / template reserve | 16,384 / 384 / 512 |
| Failure stage | context, before answer expansion or synthesis |

`gateway.ts:392` checks selection JSON against `evidenceBudget.request_bytes`; it fits. `services/rag/app.py:626` checks the complete inference envelope, including schema, messages and options, against the stricter minimum of byte and context limits; it fails by 67 bytes. The gateway maps that private 400 into a valid HTTP-200 answer with mode FAILURE. The selection catch retries malformed output only; expansion reconsideration is later and cannot recover this first-selection admission failure. A generic retry with identical input is therefore poor recovery guidance.

Repair target: use the same full-envelope admission contract before selecting, with explicit bounded recovery that preserves complete candidate text, applicable restrictions and contrary rules. A byte-budget failure is not a token-overflow measurement and must be described accurately. Do not raise limits, truncate source text, silently drop relevant candidates or count a successful HTTP status as answer success.

### P2: Evidence selection and final support checking disagree without actionable reason

The facility gateway control retrieves one candidate, selects one supported requested detail, expands three sources, and fits three quotes (maximum 445 UTF-16 characters). It then returns EVIDENCE_GAP with only a grounding NO_RELEVANT_SOURCE diagnostic. This is not the no-hold capacity failure.

`services/rag/app.py:1037` independently verifies complete quotes after selection. The MS60 path returns an empty quote list when packing produces no quotes or `check_evidence` rejects support. `groundedQuotes` at `gateway.ts:202` accepts an empty list as an empty result; lines 533-536 collapse it into a generic evidence-gap outcome. Current diagnostics do not distinguish those private rejection paths. The exact semantic cause, including whether the sole retrieved candidate was appropriate, remains unresolved. It would be inaccurate to claim the source is absent or simply disable verification.

Repair target: add allowlisted, content-free reason attribution for packing versus independent support rejection, then test candidate relevance and broad-problem applicability separately. Preserve independent evidence verification. Existing source evidence and the browser's correct complaint/handover/property controls should remain intact.

### P2: Relevant evidence is not consistently a direct answer

B01 selects handover duties without asking which reception task is meant. B12 places final-checkout instructions before the re-entry distinction. B02/B04/B14 repeat heading paths and broad source units. Fresh B07 gives verification duties without answering inventory security. These are relevance and presentation defects, not all refusals. Main projection, exact fallback and semantic completeness need separate evaluation in `gateway.ts`, `services/rag/app.py`, `packages/domain/src/services/assistantSynthesis.ts` and the shared `packages/ui/src/components/assistantPresentation.tsx`.

Repair target: present the applicable decision first, retain every operative qualification, and keep complete original evidence available. Do not trim a safety or permission condition merely to make an answer shorter. Determine the actual main/fallback reason before modifying rendering.

## Runtime identity and next implementation boundary

Authenticated runtime checks before and after testing report ready but implementation-current=false. The real browser and probes audit the running local Python service; the gateway test loads current TypeScript files against that same service. Current-file references identify inspectable seams and confirmed mechanical admission behavior, not proof of current Python semantic acceptance. Keep the failed observations, then reconcile the loaded candidate identity before evaluating repairs. No service restart, flag, threshold, model, dependency, migration, publication or application-logic change was made in this audit.

## Repair order and acceptance

1. Freeze the reviewed source/runtime identities and retain this failing baseline. Reconcile serving code before attributing a repair to current files.
2. Repair plan/query agreement and broad topic switching. The contextual walk-in query must provide the supported workflow without requesting live-data parameters; the property query after handover must answer property handling. Legitimate availability questions and genuine ambiguous follow-ups must remain distinct.
3. Repair selection admission against the complete model envelope. The frozen no-hold case must provide the payment/allocation distinction without increasing limits or weakening evidence fidelity. Assert useful behavior rather than HTTP status alone.
4. Attribute and resolve the facility support rejection. Require general safe guidance or a useful targeted clarification, with correct evidence. A verifier rejection must not be hidden as an unexplained general gap.
5. Independently review directness and completeness for temporary exits, general reception, refunds and complete procedures. Keep concise main-answer quality separate from safe exact fallback, then repeat normal STAFF and ADMIN browser acceptance.

The new live tests are intentionally red against this baseline and opt-in for ordinary repository runs. They are regression probes for observed failures, not evidence of a successful repair or MS-63 release acceptance. Search-aid and source-term assertions are narrow diagnostic signals, not a substitute for semantic review.

## Validation

| Check | Result |
|---|---|
| Real STAFF browser | 19 completed turns; observations above |
| Planner controls | Reproduced routing and history-query substitution; changed-input controls retained |
| Opt-in gateway probes | 2 executed, 2 failed on useful-answer assertions; HTTP and schema checks pass |
| `node --check scripts/rag-broad-audit.cjs` | Passed |
| `pnpm typecheck` | Passed across shared packages and all four applications |
| `pnpm lint` | Passed; 28 Python boundary files and 28 TypeScript boundary files, zero failures |
| `pnpm test` | 2,253 passed, 16 skipped, one failed: pre-existing SPEC2-TC05 strict campaign-vocabulary assertion at `tests/spec2-campaigns-and-rewards.test.ts:327`. The two new opt-in live probes skip in this default run. |
| `pnpm build` | Passed for all four applications |

Check logs: `outputs/broad-audit-typecheck.log`, `outputs/broad-audit-lint.log`, `outputs/broad-audit-test.log`, `outputs/broad-audit-build.log`. No Python implementation was edited. Existing unrelated working-tree changes were preserved. This audit added only this report, the planner diagnostic script and the opt-in gateway test, plus ignored diagnostic artifacts/logs.
