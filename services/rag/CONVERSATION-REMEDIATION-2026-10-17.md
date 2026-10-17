# Conversation audit remediation

Date: October 17, 2026, Asia/Irkutsk. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46 and MS-60.

Authority: the maintainer requested resolution of the [conversation re-audit](CONVERSATION-REAUDIT-2026-10-17.md). This record supplements its historical observations rather than replacing them.

## Changes

| Audited problem | Repair |
|---|---|
| Mixed-topic follow-up unnecessarily clarifies | The existing planner round resolves indexed user intent, newest first, before routing. Its private resolution identifies the process, antecedent turn, faithful English task and genuine unresolved distinction. A resolved task cannot also claim clarification. |
| Fresh Tagalog wording can miss retrieval | The resolved process and English task remain bounded search aids even if optional generated search metadata is missing or malformed. The original question remains in every search input and in final applicability checks. No threshold change. |
| Procedure and FAQ both appear in main reply | A negotiated main projection chooses unchanged canonical units for English, retaining every procedure action once in order. Every exact span remains unchanged in the proof view. Independent review checks main coverage against the whole closure. |
| Tagalog receives English procedure only | Retrieval now handles the question, but generated localization is not accepted as resolved. Live semantic inspection found incorrect Tagalog accepted by the pinned model's reviewer. The negotiated path therefore skips generated non-English synthesis and returns verified English evidence with its existing language notice. The private main endpoint also rejects unreviewed translation. Reliable localized main answers remain an open gate. |
| Broad source unit overwhelms a simple decision | The main projection selects the direct applicable decision and its conditions rather than neighboring policies. Complete reviewed source expansion, exact proof and final identity checks remain mandatory. |
| Presentation verifier returns wrong flag count | Its inference grammar requires one support flag per main block. The gateway separately verifies that count. Hidden exact proof is excluded from candidate prose review. |
| Presentation verifier says fully supported/complete but source unsafe/inconsistent | On the negotiated main path that contradictory verdict is malformed output and cannot create a spurious source-conflict answer. Legacy verdict behavior is retained. Genuine incomplete/unsafe/conflicting verdicts remain representable and fail closed. |
| Money policy question misrouted to staff financial report | Planner instructions distinguish general fee/refund policy from actual aggregate financial data. Staff financial tool restrictions remain unchanged. |
| Opening preparation misrouted to tomorrow's snapshot | A task date does not authorize a data request. Preparation and procedure questions remain DOCUMENT. A fresh conversation's private antecedent pointer is normalized to -1 because no earlier turn exists. |
| Ordinary longer conversation exceeds planner capacity | Duplicate planner instructions were removed. A regression checks the serialized inference schema plus four ordinary user turns against unchanged capacity, including reserved transport/output headroom. |

No source publication, migration, policy, model, similarity or evidence-budget change. The eight-second synthesis/support subdeadline and overall gateway deadline remain unchanged. Transcripts remain ephemeral. Existing extensive working-tree changes were preserved.

Implementation surfaces: `services/rag/app.py` owns intent resolution, prompt capacity and canonical English projection; `apps/admin-portal/src/server/assistant/gateway.ts` owns negotiation, the non-English synthesis gate, deadlines and support admission; `packages/domain/src/services/assistantSynthesis.ts` enforces proof/action fidelity; `packages/validation/src/assistantSchema.ts` defines additive main blocks; the shared UI renderer and launcher render/opt in to that contract. Diagnostics remain numeric and allowlisted. Regression fixtures are in `services/rag/tests/test_conversation_remediation.py`, `tests/ms60-conversation-remediation.test.ts`, `tests/ms57-gateway.test.ts` and the opt-in `tests/ms60-conversation-gateway-live.test.ts`.

## Compatibility and proof

The shared launcher negotiates both `X-DeskAtlas-Answer-Contract: ms59-v1` and `X-DeskAtlas-Main-Answer-Contract: ms60-v1`. Only those callers receive the additive `main_blocks` path. Legacy callers keep their previous schema/behavior, and an unnegotiated main projection is rejected. Unknown main contracts fail safely.

The gateway negotiates `presentation_contract: ms60-concise-v1` only with the private service. `main_blocks` do not replace canonical `blocks` or `evidence_spans`. Every source hash, offset, closure and publication epoch check remains. Complete-procedure main actions map all canonical action indexes exactly once in source order. Main translation cannot use an intact hidden proof to pass an incomplete semantic review. English canonical selection reduces rewriting, while translations remain generated claims.

The independent verifier receives the complete original evidence, compact candidate claims and action mappings, without generator rationale or the hidden fallback text. Fixed numeric support diagnostics distinguish unsupported claims, incomplete coverage and source-safety decisions. No prose or credentials enter diagnostics. These checks did not reliably detect Tagalog translation drift; generated localization is consequently disabled for negotiated callers rather than trusted on these flags alone.

## Verification and remaining gates

Development failures are retained in ignored content-free artifacts under `benchmark-results/conversation-remediation-2026-10-17/`; they are not relabeled as successful final acceptance.

Repository verification: `pnpm typecheck`, `pnpm lint` and `pnpm build` passed, including all four application builds. `pnpm test` recorded 2,220 passed, 13 skipped and one preexisting unrelated failure at `tests/spec2-campaigns-and-rewards.test.ts:327` (SPEC2-TC05 reward vocabulary). Subsequent changes were confined to private Python behavior, its regression tests and the opt-in live test. The final Python suite passed 380 tests with 16 skipped; boundary lint was repeated successfully.

Final normally signed-in STAFF browser sequence: opening preparation, noise complaint, mixed-history repeated-noise follow-up, Tagalog lost property, unpaid desk selection, online payment permission and refund amount. Opening returned ten applicable preparation actions. Noise and its follow-up reached supervisor escalation without unnecessary clarification. The no-hold decision and online-payment permission were concise main answers with exact supporting proof. Refund remained an explicit evidence gap, with no promised amount. The longer Tagalog turn retrieved the complete lost-property procedure but displayed English exact fallback, and the noise follow-up also used repetitive exact fallback. These are remaining presentation limitations, not successful localized/concise acceptance. No browser authentication bypass was used.

The final five-case real gateway run passed in 76.02 seconds after the last planner change: opening preparation, mixed-history follow-up, explicitly named property safe fallback, concise no-hold decision and refund evidence gap. The safe-fallback case includes the prior three ordinary user turns and requires exact English storage/ownership guidance with no generated main. This gateway run uses an ephemeral test credential for an active STAFF profile, separate from browser authentication acceptance. The final focused TypeScript regression run passed 29 tests, followed by all 23 gateway tests after adding the non-English synthesis-blocking regression. Typecheck, lint and all application builds were repeated successfully after the final gateway change.

After prompt compaction, the competing-requests control temporarily regressed to a guessed DOCUMENT route. A focused distinction was restored without increasing capacity. All six final planner controls passed: mixed history, minimal history, context-free clarification, lost-property follow-up, explicit topic correction and two-current-requests clarification. The 13 focused Python remediation tests also passed after that final prompt change.

Browser screenshot: `benchmark-results/conversation-remediation-2026-10-17/final-browser.jpg` records the concise online-payment permission and explicit refund gap. It is success evidence for those scenarios, not proof of a successful Tagalog translation.

After the final reload, a fresh normal STAFF browser question in Tagalog visibly returned the complete unchanged English lost-property procedure and its language notice, with no generated translation. `benchmark-results/conversation-remediation-2026-10-17/final-safe-language.jpg` records that deliberately limited behavior. Final readiness reported ready and implementation-current.

The initial mixed-history planner replay failed before changes. Focused Python and TypeScript regressions passed after implementation. Live development controls also caught zero-hit Tagalog retrieval, an overly broad main projection, verifier count mismatches, translation timeout, contradictory verifier flags and one refund-policy route error; these drove the subsequent repairs. A later five-case gateway run passed four cases but failed localized-property quality despite HTTP 200 and accepted support flags. Browser inspection confirmed mistranslations of storage, ownership verification and release. This failure is retained. The replacement `property-safe-fallback` case explicitly checks original-language evidence and absence of generated main text; it does not substitute for or pass the failed translation-quality gate.

The service environment was missing `olefile==0.47`, already pinned in `knowledge-requirements.txt`. That existing dependency was restored in `.venv-service`, without adding a new dependency or changing global packages. Two stale Python fixtures were reconciled with the current contracts: genuine clarification uses no supported indexes, and the independent-relevance test uses a non-amount question so it reaches its intended semantic-verification seam instead of the deterministic missing-amount guard.

Universal multilingual quality, held-out evaluation, production deployment, five-user concurrency and performance release targets remain separate from these local repairs. Exact fallback is not counted as successful localized or concise presentation. Gateway timing artifacts do not establish complete-render percentiles.

## Operation and rollback

The local private API was restarted through the existing `rag-start.cjs api` workflow to load Python changes. Compatible gateway, validation, domain and shared UI changes must travel together. Reverting the new main header disables the additive main view while retaining canonical evidence and existing exact behavior. Revert request-local planning changes with their tests if necessary; never restore expired sessions or bypass publication/role checks. There is no SQL or publication rollback in this remediation.
