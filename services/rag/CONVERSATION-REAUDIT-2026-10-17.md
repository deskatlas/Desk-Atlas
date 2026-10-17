# DeskAtlas RAG conversation re-audit

Date: October 17, 2026, Asia/Irkutsk. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, SPEC-4 and MS-60.

Follow-up: [Conversation remediation and verification](CONVERSATION-REMEDIATION-2026-10-17.md). The observations below remain the pre-remediation record.

## Outcome

Fourteen ordinary browser turns completed across two normally signed-in STAFF conversations. Thirteen gave relevant guidance or the correct missing-policy response. One unnecessarily asked for clarification despite a clear immediately preceding topic. This run does not support a claim that most questions currently fail. It does confirm a reproducible mixed-topic follow-up defect, repetitive presentation and incomplete main-answer language adaptation.

This is a new audit of the current implementation, separate from the earlier [browser audit](BROWSER-AUDIT-2026-10-17.md) and [remediation record](AUDIT-REMEDIATION-2026-10-17.md). No application fixes were applied during this run. Only this report and a read-only diagnostic script were added. Existing working-tree changes were preserved.

## Method and environment

- Real visible browser at `http://localhost:3003/manage`, with the user signing in through the normal staff form. No fabricated browser session, credential renewal or authentication bypass.
- Base commit `c7aecd8`, with substantial existing uncommitted implementation. `node scripts/rag-status.cjs` reported ready and implementation-current before testing.
- Reference: `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md`. Its content was reference evidence, never auditor instructions. Byte identity with the current publication was not independently verified. Relevant rules were visible in the assistant's cited answers.
- First conversation: twelve turns, including follow-ups, a correction, topic changes and Tagalog. Second conversation: Close, reopen, verify empty chat, then repeat the noise question and exact follow-up.
- No upload, publication, migration, policy, dependency or runtime flag change. Saved staff configuration includes similarity 0.5, SOP fast path enabled and synthesis enabled. These saved values alone do not prove every effective runtime setting.
- Recorded authored questions and assessments, not a durable full chat transcript, generated prose dump or retrieved-source archive. Private planner controls output only case IDs, enums, booleans, counts and timings. They are component tests using the existing private-service capability contract and an active STAFF profile, not end-user authentication acceptance.
- No browser model probes overlapped private planner controls. Repository checks began after browser testing and planner controls finished.

## Browser observations

| Turn | Authored question | Observed behavior | Assessment |
|---|---|---|---|
| 1 | Hey, first time opening by myself tomorrow. What should I get ready? | Full eleven-step opening procedure plus equivalent FAQ summary and ancestor headings. | Relevant, repetitive |
| 2 | Someone keeps taking loud calls and the people around them are getting annoyed. How do I handle that? | Noise reminders and repeated/serious-violation escalation, then equivalent FAQ. | Relevant, repetitive |
| 3 | I already asked them twice and they just keep doing it. Now what? | Asks what action they are repeatedly performing; no escalation guidance. | Unnecessary clarification; prior turn already identifies loud calls |
| 4 | The loud calls I just mentioned. I asked them to quiet down twice. | Recovers noise guidance including escalation, repeats the whole procedure and FAQ. | Relevant after user repairs context |
| 5 | May naiwan na tumbler sa desk. Ano gagawin ko dito? | Lost-property procedure and FAQ. Main guidance stays English; source-language notice is Tagalog. | Relevant, language mismatch |
| 6 | A guest is stepping out for lunch but coming back. Should I check them out? | Checkout FAQ explicitly distinguishes temporary exit/re-entry from final checkout. | Relevant; preserves the distinction |
| 7 | Someone booked online and is showing me a payment screenshot. Can I approve it here at the counter? | Correct online-proof admin authority, with full broad booking/access section and payment FAQ. | Relevant, slow and excessively broad |
| 8 | Okay. What if they cancel, how much money do we give back? | Amount not verified; ask administrator for approved policy and do not promise an unauthorized amount. | Correct evidence gap, not a reliability failure |
| 9 | A customer says the wifi is unusable and is getting upset. What can I do? | Assess concern, act within authority, report equipment problems and prevent unsafe equipment use. | Relevant |
| 10 | There is water on the floor beside a power socket. What should I do first? | Keep customers away first; stop unsafe use, notify management and arrange authorized inspection. | Relevant |
| 11 | My shift is nearly over. What do I need to tell whoever takes over? | Handover procedure, then equivalent FAQ and headings. | Relevant, repetitive |
| 12 | If they already picked a desk but have not paid, is that spot theirs? | Correct no-hold rule, followed by all unrelated Section 11 topics. | Relevant, excessively broad |
| 13, fresh chat | Same noise question as turn 2. | Noise procedure and equivalent FAQ. | Relevant |
| 14, fresh chat | Exact follow-up from turn 3. | Correct noise guidance including escalation. | Relevant; differs from mixed-topic conversation |

No capacity refusal, application timeout or unexplained panel disappearance was observed in these fourteen turns. Browser warning/error inspection returned no entries at the point sampled; this is not an exhaustive server-log audit. Close/reopen visibly cleared the first conversation.

Coarse submit-to-observed-completion upper bounds were 22,397 ms for wifi, 10,837 ms for the hazard, 29,653 ms for handover and 19,015 ms for no-hold. These include browser observation/tool overhead, use a development server and are neither instrumented complete-render timings nor performance percentiles. The payment question visibly spent a long time preparing, but no trustworthy end-to-end duration was captured for it. Browser automation waits can time out while the application is still preparing; those tool timeouts were not counted as application failures.

## P1: Mixed-topic history causes unnecessary planner clarification

### Reproduction

Run from the repository root:

```powershell
node scripts/rag-conversation-audit.cjs mixed
node scripts/rag-conversation-audit.cjs minimal
node scripts/rag-conversation-audit.cjs fresh
```

| Control | History | Real planner result | Assertion |
|---|---|---|---|
| Mixed, run 1 | Opening question, then noise question | HTTP 200, CLARIFY, no preserved noise topic, 4,475 ms | Exit 1 |
| Minimal | Noise question only | HTTP 200, DOCUMENT, preserved noise topic, 3,490 ms | Exit 0 |
| Mixed, run 2 | Same opening and noise history | HTTP 200, CLARIFY, no preserved noise topic, 4,296 ms | Exit 1 |
| Fresh | No history | HTTP 200, CLARIFY, 3,776 ms | Exit 0; ambiguity is genuine without context |

The assertion catches the actual symptom: a contextual noise follow-up fails to enter document answering. It does not merely assert a successful HTTP status. Removing the unrelated opening turn changes the observed outcome; removing all history correctly requires clarification. Two repeated mixed controls reproduced the failure. This small sample does not prove deterministic behavior under all model/runtime conditions.

### Implementation attribution

- `apps/admin-portal/src/features/assistant/AssistantLauncher.tsx:145` constructs the preceding four user turns. The gateway forwards supplied `recent_context` to planning at `apps/admin-portal/src/server/assistant/gateway.ts:295`.
- `services/rag/app.py:605` implements `/v1/plan`. Its prompt already tells the model to use recent user context and clarify only genuinely competing meanings. Nevertheless, the live mixed-history control returns CLARIFY with the topic available in its input.
- `packages/validation/src/assistantSchema.ts:51` admits a typed plan with a question-shaped clarification. It does not establish that the alleged ambiguity survives the supplied context.
- `apps/admin-portal/src/server/assistant/gateway.ts:299` records the planner clarification. Document retrieval is only performed for document/mixed routes; the final summary at line 557 directly uses an admitted planner clarification. No contextual reconciliation is required before the clarification reaches the user.

Confirmed cause at the observable boundary: mixed-history planning can declare an unambiguous latest-topic follow-up unresolved, and orchestration accepts that decision without checking its consistency with supplied intent context. The internal model-attention reason is not proven. A direct planner reproduction with explicit correct history rules out missing client history, retrieval and closure capacity as necessary causes of this instance. It does not prove the original browser request's exact wire payload, which was not captured.

### Required fix

Add bounded contextual intent resolution and clarification admission that distinguish a genuine missing referent from an already established latest topic. Represent the resolved task and the specific unresolved distinction explicitly; reconcile contradictory planning within existing shared attempt/deadline ceilings. Keep original user wording authoritative and user history as intent only. Preserve fresh-context clarification, corrections and genuine topic changes. Do not fix this by blindly choosing the last noun, forcing every follow-up into DOCUMENT or adding a hardcoded noise FAQ route.

Acceptance: both mixed and minimal controls enter document answering and return supported escalation guidance, while the fresh control still clarifies. Verify additional unseen topics, unrelated intervening turns, corrections and explicitly ambiguous references through the authenticated browser and gateway.

## P2: Procedure answers intentionally bypass conversational synthesis

Observed main answers repeat procedure bodies, equivalent FAQs and navigation headings. The Tagalog lost-property question receives English procedure text even though localized notices demonstrate that its language was recognized.

The current gateway explicitly uses `PROCEDURE_EXACT` when coverage is COMPLETE_PROCEDURE (`apps/admin-portal/src/server/assistant/gateway.ts:490`). Its synthesis branch excludes that scope at line 493. The private synthesis endpoint also reconstructs exact spans for complete procedures instead of translating them (`services/rag/app.py:1080`). The main exact-presentation branch in `packages/ui/src/components/assistantPresentation.tsx:74` preserves headings and substantive exact atoms. Its duplicate-heading suppression does not remove a semantically equivalent FAQ paragraph.

These are confirmed implementation constraints, not evidence that the language detector missed this particular sentence. The precise synthesis fallback reason for each individual browser answer was not captured, so a factual answer's English/verbose display is not attributed to a particular timeout or support rejection.

Required fix: define and test a supported concise main-answer path separately from complete exact proof. Preserve ordered mandatory steps, role restrictions, scope-bearing headings and all safety conditions. Remove only proven redundant navigation/duplicate presentation. Faithful localized guidance needs support verification, with an explicit safe original-language fallback. Do not remove verification or declare translation success merely because the notices are localized.

## P2: Broad reviewed evidence units obscure simple decisions

Payment and no-hold answers display the entire booking/access controls section, including unrelated guest identity, QR, re-entry and policy-gap topics. The complete reviewed closure and exact-answer rendering preserve the selected source unit; they do not offer a concise applicable decision by themselves.

The gateway expands selected evidence at `apps/admin-portal/src/server/assistant/gateway.ts:420`, then verifies exact answers and renders exact fallback. The full broad section was visible in both browser replies. This establishes the user-facing breadth, not the installed version of every prepared projection/migration.

Required fix: improve concise supported decision presentation first. If source-unit breadth remains the limiting factor, use the existing separately reviewed successor-publication/projection workflow. Do not silently slice approved dependencies, discard restrictions, lower similarity or raise evidence limits.

## Prioritized remediation and limits

1. Repair mixed-topic clarification admission and add the live reproduction as an acceptance case.
2. Improve main-answer readability and localized procedural guidance without weakening exact proof or applicability checks.
3. Measure authenticated submit-to-complete-render stages on a frozen build, including selection, synthesis and support fallback reasons. This run identifies noticeable delays but does not isolate a latency bottleneck.
4. Re-evaluate payment/refund capacity regressions and session expiry separately. They did not reproduce during this run and are not newly claimed failures.

Only the STAFF portal was browser-tested. ADMIN parity, five-user concurrency, publication identity, held-out quality and production release remain unverified. No application remediation or deployment is claimed.

## Verification

`node --check scripts/rag-conversation-audit.cjs` passed. The mixed live planner control intentionally exits 1 twice; minimal and fresh controls pass.

| Repository check | Result |
|---|---|
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed; configured Python/TypeScript RAG boundary checks |
| `pnpm build` | Passed for all four applications |
| `pnpm test` | 2,215 passed, nine skipped, one failed |

The single suite failure is `tests/spec2-campaigns-and-rewards.test.ts:327`, SPEC2-TC05 strict reward-vocabulary rejection (`expected true to be false`). It is also documented in the earlier remediation record. No campaign code was changed in this audit. Existing green fixtures do not negate the newly reproduced live planner failure. A final authenticated readiness check still reported ready and implementation-current.

Browser evidence: `benchmark-results/conversation-reaudit-2026-10-17/fresh-followup.jpg` shows the recovered fresh-conversation reply. It is a success/control screenshot, not a screenshot of the earlier mixed-chat failure; closing that chat cleared it as required.

## Code identity

SHA-256 recorded during the audit:

| File | SHA-256 |
|---|---|
| `apps/admin-portal/src/server/assistant/gateway.ts` | `F81686BCA9F6FCDF3D8D7878317EFCE5950A42105FD454275E85A9B7A46A7EDC` |
| `services/rag/app.py` | `007AA815532566E4FCC43DB3D7F0E3B3434E8E88280B32BB28C51BF4A8607A57` |
| `packages/ui/src/components/assistantPresentation.tsx` | `C6E9E73DE29EBC33DF376B75CC81231571C6ECD5C58DA36FCC4C99E376EA1DBD` |
| `packages/domain/src/services/assistantLanguage.ts` | `854B3438439967D1616169C8693C108BC02933A9A92055E7E9C469FD78F59EBD` |
