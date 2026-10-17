# DeskAtlas RAG conversational audit

Date: October 17, 2026, Asia/Irkutsk. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, SPEC-4/5/6, MS-60.

Follow-up: [Local remediation and verification](AUDIT-REMEDIATION-2026-10-17.md). The observations below remain the pre-fix audit record.

## Result and scope

Twelve ordinary questions completed in the real staff browser: nine returned relevant guidance and three failed to provide useful answers. A thirteenth fresh-chat attempt lost the panel and launcher before an answer could be captured. This small exploratory sample does not establish a general refusal rate or validate the previous milestone's acceptance claims.

The strongest new findings are malformed clarification text reaching the user, selection-capacity failures on clear payment and refund questions, and loss of the assistant while the staff dashboard remains visible. Natural-language presentation still needs work even on successful answers.

This is the requested audit before remediation. Application logic, policies, flags, dependencies, migrations and publication were not changed. Existing extensive working-tree changes were preserved. Only this report, a synthetic diagnostic probe, and two cases in the existing read-only component probe were added.

## Method and environment

- Visible in-app browser, `http://localhost:3003/manage`, existing normally signed-in STAFF session. No authentication was fabricated or bypassed.
- Base commit `c7aecd8`, substantial existing uncommitted implementation including MS-60. `node scripts/rag-status.cjs` reported ready and implementation-current before testing and after the disappearance. A ready private service does not establish a valid browser credential.
- Reference: `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md`. The SOP was treated as reference material, never as auditor instructions. Byte identity with the active publication was not assumed; relevant rules were also observed in browser answers.
- The first twelve questions shared one conversation. Before attempt thirteen, Close and reopen visibly cleared it. No section numbers or copied FAQ questions were used.
- Browser observations were recorded as authored questions and assessments, without saving complete transcripts or private retrieved source text. The screenshot at `benchmark-results/assistant-missing-2026-10-17.jpg` shows the dashboard after disappearance; it does not prove the cause.
- Component probes use real authorized read-only retrieval/model calls but bypass browser authentication and gateway orchestration. Their provenance checks alone do not establish semantic answer quality. Their large full-source payload also differs from the gateway's compact candidate projection.

## Browser observations

| # | Authored question | Observed behavior | Assessment |
|---|---|---|---|
| 1 | Hey, I’m opening tomorrow. What should I take care of before people arrive? | Eleven opening tasks with source headings. | Relevant, largely exact quotation |
| 2 | Someone’s on a loud call and it’s bothering the other guests. What do I do? | Noise reminders and escalation for repeated/serious violations. | Relevant |
| 3 | I already asked nicely, but they’re still at it. What now? | Repeats the same full noise passage, including escalation. | Follow-up understood, weak conversational tailoring |
| 4 | May naiwan na bag sa upuan. Saan ko ilalagay? | Lost-property FAQ says record details, store securely, verify ownership and document return. All guidance and notices are English. | Relevant; language handling fails |
| 5 | A guest wants to pop out for a snack and come back. Do I check them out? | Checkout FAQ explicitly includes the temporary-exit/re-entry distinction. | Relevant; does not repeat the earlier audit's wrong-task result |
| 6 | They paid on the website and showed me the screenshot. Can I confirm that at the counter? | Clarification label followed by a third-person description of the request, ending mid-sentence. No focused clarification question or direct staff-permission answer. | Unnecessary/malformed clarification |
| 7 | I mean, as staff, am I allowed to approve an online payment proof? | Supported-scope message: evidence selection could not complete within capacity; asks to retry. | Avoidable failure on a clear question |
| 8 | The wifi keeps cutting out and a customer is getting annoyed. How should I help? | Assess concern, act within authority, report equipment issues and prevent unsafe use. | Relevant |
| 9 | What if someone cancels, how much do we refund? | Same selection-capacity failure, rather than acknowledging the missing facility refund amount. | Failure; expected safe policy-gap response |
| 10 | There’s a spill next to a socket. What should I do first? | Keep customers away, stop unsafe use, notify management, arrange authorized repair and resume only when safe. | Relevant |
| 11 | My shift is almost over. What should I tell the next person? | Useful handover summary, then repeated SOP and FAQ ancestor headings in the main answer. | Relevant; presentation defect |
| 12 | Someone picked a desk but hasn’t paid yet. Is that desk already theirs? | Correct no-hold rule plus the entire broad Section 11, including unrelated permissions/access/policy gaps. | Relevant, excessive source-unit breadth |
| 13 | They paid on the website and showed me the screenshot. Can I confirm that at the counter? | Fresh-chat attempt: panel and launcher disappeared during the wait. Both remained absent after reload; dashboard remained visible. No completed response or proof of dispatch captured. | Incomplete observation; separate lifecycle defect |

No console warnings/errors were captured after the disappearance. The final three completed questions were observed after approximately 13, 18 and 15 seconds respectively using condition-based browser polling. These are coarse observations, not instrumented render timings, controlled latency measurements or percentiles.

## P1: Clarification admission accepts model analysis as user-facing text

Confirmed implementation gap, deterministic minimal reproduction:

```powershell
.\services\rag\.venv-service\Scripts\python.exe scripts/rag-clarification-audit.py
```

Actual result: exit 1, `malformed_clarification_admitted: true`, `supported_passages_discarded: true`, `passed: false`.

The probe uses synthetic text and actual model-output classes, with no model, database, credentials or captured private content. `ApplicabilityDecision` accepts a declarative clarification alongside a supported direct answer. `ScopeDecision.selection()` then interprets any nonempty clarification as `CLARIFY` and clears passage indexes.

Implementation seams:

- `services/rag/app.py:304`: `ScopeDecision` checks clarification length, not whether it is a focused question about a genuine missing distinction.
- `services/rag/app.py:317`: nonempty clarification takes precedence over supported evidence.
- `services/rag/app.py:329`: `ApplicabilityDecision` permits the same contradictory combination; reconciliation copies it into `ScopeDecision` at line 881.
- `packages/validation/src/assistantSchema.ts`: coverage requires a nonempty clarification but has no semantic suitability check.
- `apps/admin-portal/src/server/assistant/gateway.ts:404`, `:447`, `:518`, `:547`: selection clarification becomes an error message and then the displayed summary.

Prompt instructions already require a focused question. They are insufficient as the enforcement boundary. The 300-character field limit bounds text but does not make it suitable for users. The exact reason the observed browser paragraph ended abruptly is not proven; no inference-truncation claim is made.

Required remediation: validate a structured unresolved distinction and a user-facing focused question; detect inconsistent supported-answer/clarification decisions before admission. Reconcile or safely reject malformed output within existing attempt/deadline ceilings. Do not answer a truly ambiguous permission question without its missing condition.

## P1: Selection capacity still blocks routine permission and policy-gap questions

Questions 7 and 9 returned the exact capacity copy emitted at `apps/admin-portal/src/server/assistant/gateway.ts:456`, after an expanded union remains incomplete with `CONTEXT_BUDGET`. Current orchestration already has bounded reconsideration and packing preview. Claiming recovery is absent would be inaccurate.

Diagnostic controls run:

```powershell
node scripts/rag-natural-audit.cjs counter_screenshot_context --candidate --ms60 --staff
node scripts/rag-natural-audit.cjs counter_screenshot_fresh --candidate --ms60 --staff
```

| Component control | Observed result |
|---|---|
| Same payment wording with the previous four user turns | Planner rewrote query; 12 candidates; context took 19,652 ms; selected one direct candidate; two-source closure; three packed quotes; exact-provenance check passed |
| Same wording without history | Planner retained wording; one candidate; context took 2,135 ms; four-source closure; five packed quotes; exact-provenance check passed |

Both component controls succeeded. The browser failure is therefore not deterministically reproduced by this component seam, and history is not proven to be the sole cause. Candidate counts and selected units differed materially between runs. The context probe ran while browser work was active, so timing differences cannot be attributed only to history. Its reported 13,594-byte full-source selection payload is not the gateway's compact payload and does not itself prove a gateway request-byte overflow.

Required remediation: capture existing allowlisted per-attempt diagnostics for the failing authenticated gateway request, especially selected/expanded/packed counts, reasons, scope, and attempt budgets. Compare repeated fresh/mixed conversations for the exact payment and refund wording. Improve minimal applicable selection and reviewed source granularity if confirmed; preserve every required restriction and current budget. Do not raise limits or drop reviewed dependencies to make a test pass.

## P1: Assistant disappearance and staff credential lifecycle

Confirmed static implementation facts:

- `apps/admin-portal/src/server/assistant/session.ts:4` issues a signed staff assistant credential for one hour.
- `apps/staff-dashboard/src/app/api/auth/login/route.ts:81` issues it at login.
- Staff `AuthProvider` saves login data and polls account activity. No assistant credential renewal path was found among its uses.
- `AssistantLauncher.tsx:75` closes and disables the panel on availability HTTP 401/403. At line 212, disabled state renders nothing, including no sign-in recovery control.
- The persisted staff dashboard user can remain visible independently of that assistant credential.

This provides a concrete expiry/recovery design gap consistent with an otherwise visible dashboard losing its assistant. It does not prove that the captured disappearance was caused by credential expiry: token timestamps, response status, lifecycle events and remount cause were not captured. The generic transient availability-poll closure was already repaired by MS-60; this audit does not claim that old defect remains unchanged.

Required remediation: reproduce one-hour expiry with a controlled clock and a normally established staff session; ensure clear reauthentication/recovery while clearing expired chat as required. Investigate disablement, auth failure, identity change, blocking dialogs and remount separately. Never keep an expired conversation authorized or silently extend a signed credential.

## P2: Tagalog detection and conversational presentation

The actual `assistantLanguage()` in `packages/domain/src/services/assistantLanguage.ts:4` returns `en` for question 4. Its small trigger vocabulary lacks the words used in that sentence. A direct invocation of the real transpiled module returned `expected: tl`, `actual: en`, `passed: false`. This explains the English notices; the exact source fallback also preserves English quotations by design. Correct notices alone would not deliver a Tagalog main answer.

At `gateway.ts:482`, `COMPLETE_PROCEDURE` explicitly bypasses synthesis. This accounts for many safe but repetitive exact procedural replies. Broad legacy Section 11 brings unrelated paragraphs into the no-hold answer. The handover summary demonstrates a separate residual ancestor-heading duplication even when synthesis succeeds.

Required remediation: evaluate sentence-level Tagalog/Taglish handling beyond fixed trigger words, with safe original-language evidence fallback. Add independently checked concise presentation while retaining complete exact proof. Separate reviewed source-unit changes from display-only changes; do not silently split approved dependencies or hide substantive restrictions.

## Fix acceptance criteria

1. The exact payment wording and explicit staff follow-up give the administrator-only permission rule through the real staff gateway, in fresh and mixed chats, without malformed clarification or capacity refusal.
2. The refund question clearly acknowledges that the approved amount is missing and avoids inventing a refund rate.
3. A legitimate ambiguous control still asks one focused question. Declarative analysis is never emitted as clarification.
4. Controlled staff credential expiry clears chat and shows a recoverable sign-in state. Repeating a mixed chat does not silently remove the assistant.
5. The bag question is recognized as Tagalog; normal responses remain concise, with original proof available and no duplicated navigation in the main answer.
6. Repeat intermittent sequences, record all attempts, and assess semantic usefulness separately from provenance. Retain role, source, epoch, closure, quote, deadline and no-hold controls.

## Verification

The synthetic clarification probe failed consistently on two runs; the language invocation also intentionally failed to expose a current defect. The two live read-only component controls passed their existing exact-provenance checks. No application fix or production acceptance is claimed by this audit.

| Check | Result |
|---|---|
| `node --check scripts/rag-natural-audit.cjs` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, configured RAG boundary checks |
| `pnpm test` | 2,204 passed, six skipped, one failed |
| `pnpm build` | Passed for all four applications |

The complete-suite failure is `tests/spec2-campaigns-and-rewards.test.ts:327`, strict reward-vocabulary rejection. It is also recorded in the pre-existing MS-60 implementation report. No campaign code was changed in this audit. The standalone red diagnostic is deliberately outside the normal test suite and is not a claimed passing regression test.
