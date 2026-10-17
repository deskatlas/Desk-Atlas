# Broad-question audit remediation

Date: October 17, 2026, Asia/Irkutsk.
Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, SPEC-4, MS-53/55/60/62/63.

Authority: the maintainer requested resolution of the [broad-question audit](BROAD-QUESTION-AUDIT-2026-10-17.md). This is a bounded local repair and verification record. The original audit and failed attempts remain intact.

## Changes

| Audited issue | Repair |
|---|---|
| Workflow help reaches operational tools | The private planner declares request purpose separately from its route. Declared knowledge intent cannot dispatch data tools. A conservative grammar guard recognizes advice and conditional follow-ups; explicit data, mixed and execution requests retain their existing checks. Resolved non-clarification plans clear unused clarification text before the strict gateway boundary. |
| Old task replaces a new topic | The authoritative current question is last in the planner payload. Standalone tasks and unjustified copies of historical questions retain current wording. Genuine resolved references can still reuse an earlier task. The first semantic search always retains the current input; generated interpretations are additional bounded search aids. |
| Weak nonempty retrieval stops better searches | The existing single bounded semantic-aid batch now runs even if the first branch returns a weak hit. Original and aid results use the existing deterministic fusion, twelve-candidate ceiling and authorized source filters. |
| Casual booking/fault language retrieves an unrelated process | Pure-domain task normalization supplies search categories for workspace-selection guarantees and facility-equipment faults. These categories contain no policy answers, required actions, prices or permissions. Original wording remains in every search input. At most four queries are retained; physical-security counterexamples do not become booking-guarantee questions. |
| Selection payload fits gateway but full inference request overflows | Admission and HTTP transport use the same compact lossless UTF-8 serialization, including the full schema, options and messages. Both nested content JSON and the complete envelope are measured as actually sent. Existing byte, context, output and template limits remain unchanged; no candidate/source text is removed. A byte-exact boundary test rejects before inference when the real envelope exceeds its allowance. |
| Wrong procedure answers a sufficiency question | Applicability compares the original question after all candidate/cost data, explicitly distinguishing a state-establishing rule from a related verification procedure. Final support checking also receives the current question after quotations. Complete-source expansion and independent verification remain mandatory. |
| Inventory rule is retrieved but a checklist is still selected | A bounded pure-domain selector requires an explicit published no-hold witness for a single workspace-selection guarantee question. It selects that witness and explicit matching/contrary selection-to-reservation claims in either grammatical direction. Ordinary workflow references, verification checklists, physical-security questions, privacy guarantees and multiple requested tasks do not qualify. Support is provisional until canonical expansion and independent final applicability succeed. If complete selected support exceeds capacity, the gateway fails closed instead of pruning a contrary rule. |
| Broad reception priorities invent a shift stage | A fresh task-free priorities question asks which task or part of the shift needs help. It does not arbitrarily choose opening or handover, or claim missing published policy. Qualified questions and contextual follow-ups still use planning. |
| An unnamed fault receives an unhelpful evidence gap | A new explicitly unnamed fault asks which equipment or part of the workspace is affected, rather than inventing an item or inheriting an unrelated topic. Named faults continue to retrieve published guidance. The original audit criterion permits this targeted clarification; a generic not-verified reply still fails the live regression. A named-printer follow-up independently checks that clarification is not a dead end. |
| Evidence rejection hides its failing stage | Numeric request-local diagnostics distinguish packing success from final support rejection. Synthesis/support failures are attributed to their actual stage. Optional capacity failure retains safe exact evidence and is classified as budget admission, rather than service failure. |

Implementation surfaces: `services/rag/app.py`, `services/rag/rag/request_timing.py`, `apps/admin-portal/src/server/assistant/gateway.ts`, `apps/admin-portal/src/server/assistant/diagnostics.ts` and `packages/domain/src/services/assistantHybridRetrieval.ts`.

No new dependency, model, migration, publication, similarity threshold, evidence allowance, permission, business policy or feature flag was introduced. No booking/payment mutation was executed. Existing unrelated working-tree edits were preserved. The private purpose field is excluded from the public plan; existing browser response contracts remain in place.

## Diagnosis and retained failures

The existing local API was restarted through its verified launcher ownership, using the same saved GPU profile. The authenticated health probe then reported implementation-current=true. Walk-in misrouting, property topic substitution and both initial gateway failures reproduced against current Python code, so stale code was not their only cause.

Focused regressions were written and observed failing before the corresponding changes: route agreement, current-question preservation, lossless wire admission, semantic-aid recovery after a nonempty weak branch, genuine reference preservation, advice/data separation, general-priorities clarification, diagnostic stage attribution, and task normalization with physical-security counterexamples.

Early two-case live gateway controls passed after initial fixes. Expanding the tests revealed further failures, which were retained rather than relabeled: malformed public plans, temporary-departure advice interpreted as execution, a no-hold question selecting a verification checklist, an equipment evidence rejection and a conditional complaint follow-up interpreted as unsupported. A later eight-case run had six passes and two failures. These findings drove the additional repairs above. Passing a smaller earlier subset is not the final acceptance result.

The no-hold control independently demonstrated that a source carrying the inventory rule was present in bounded semantic branches, while a later selection picked other material. This recurred in longer tests despite successful earlier attempts. A first conservative witness selector included too many related workflow roots and correctly failed capacity admission; it was refined to retain actual binding claims and contrary rules rather than any inventory mention. Both fresh and contextual controls then passed with one selected root, two canonical sources and accepted independent support. A synthetic gateway regression proves that an empty final verification result still withholds the answer and citations even when the witness is present, and that a contrary rule remains in expansion.

The equipment control had zero original-query candidates and a single generated-aid candidate, followed by final rejection. Adding bounded symptom normalization recovered further candidates but did not reliably resolve an unnamed item. The final behavior therefore asks a focused item question and then answers the named-printer follow-up. These are distinct retrieval/applicability failure modes; neither justifies disabling verification or increasing limits. The final test assertion for the unnamed fault was aligned with the audit's existing allowance for a useful targeted clarification, not changed to accept generic failure.

Content-free attempt artifacts remain in `services/rag/benchmark-results/broad-audit-2026-10-17/`. New artifact names use unique IDs so failed attempts remain alongside successful attempts. The audit script emits only enum outcomes, counts, booleans, timings and hashed unit IDs. No full transcript, source passage, generated rewrite or credential is saved by these probes.

## Verification

The final live regression command passed nine cases. It uses the real authorized source catalog and private model through current gateway code, not mocked answers. Two fresh scope clarifications are successful conversational outcomes; they are not counted as synthesized document answers.

| Check | Actual result so far |
|---|---|
| Full Python suite | 457 passed, 16 skipped; one existing Starlette/AnyIO deprecation warning |
| TypeScript focused source selection, gateway and presentation suites | 70 passed across five files |
| Live gateway regressions | 9 passed, 0 failed in the final full run |
| Runtime identity | Authenticated health: ready=true and implementation_current=true |
| `pnpm typecheck` | Passed across shared packages and all four apps after the compatibility correction |
| `pnpm lint` | Passed on current code; 28 Python and 28 TypeScript boundary files |
| `pnpm test` | 2,271 passed, 23 skipped, one pre-existing SPEC2-TC05 campaign-vocabulary failure at `tests/spec2-campaigns-and-rewards.test.ts:327` |
| `pnpm build` | Passed for all four Next.js apps after the compatibility correction |

The staff app initially rejected the new seed-selector call because its Zod-inferred fields appear optional under that app's compiler settings. The gateway now maps the already runtime-validated required IDs/content using the same non-null mapping pattern as its existing FAQ selector. This changes type compatibility, not the runtime source values. The focused suites were repeated after this correction. The later task-normalization narrowing only excludes physical-security/privacy counterexamples; its positive audit inputs remain covered by the focused suite.

Final live outcomes:

| Case | Actual mode | Assessment | Gateway duration |
|---|---|---|---|
| Contextual selection/desk guarantee | SYNTHESIZED | Published no-hold decision verified | 12,430 ms |
| Unnamed workspace fault | CLARIFICATION | Asks which equipment/part is affected | 493 ms |
| Named printer after the fault question | SYNTHESIZED | Verified reporting/maintenance guidance | 13,967 ms |
| Fresh selection/desk guarantee | SYNTHESIZED | Published no-hold decision verified | 11,192 ms |
| General reception priorities | CLARIFICATION | Asks which task/part of the shift | 510 ms |
| Walk-in after unrelated topics | EXACT | Relevant kiosk/payment/allocation guidance; concise candidate rejected | 15,246 ms |
| Property after handover | SYNTHESIZED | Ownership/storage guidance; handover topic not substituted | 15,137 ms |
| Temporary departure | SYNTHESIZED | Re-entry distinction without directing final checkout | 11,306 ms |
| Conditional complaint follow-up | EXACT | Relevant escalation guidance; concise candidate rejected | 12,232 ms |

These are individual gateway durations, not browser complete-render timings or performance percentiles. Local test/build activity and warm/cold runtime state varied during development; no performance target is certified. The two exact fallbacks have diagnostic SCHEMA_REJECTED at synthesis. Their canonical evidence remained available and independently verified. They are useful-answer passes, not concise-main presentation passes.

Relevant test files: `services/rag/tests/test_broad_remediation.py`, `services/rag/tests/test_conversation_remediation.py`, `services/rag/tests/test_ms55.py`, `tests/ms63-natural-task-search.test.ts`, `tests/ms55-hybrid-gateway.test.ts`, `tests/ms57-gateway.test.ts` and `tests/ms63-broad-question-audit-live.test.ts`.

Commands and inspectable logs:

```powershell
$env:RAG_BROAD_AUDIT='1'
pnpm exec vitest run tests/ms63-broad-question-audit-live.test.ts
pnpm exec vitest run tests/ms63-natural-task-search.test.ts tests/ms55-hybrid-gateway.test.ts tests/ms57-gateway.test.ts tests/ms60-gateway.test.ts tests/ms62-exact-fallback.test.ts
services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests -q
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/rag-status.cjs
```

Final command logs: `outputs/broad-fix-live-final-candidate.log`, `outputs/broad-fix-ts-final.log`, `outputs/broad-fix-python-final.log`, `outputs/broad-fix-typecheck-final.log`, `outputs/broad-fix-lint-final.log`, `outputs/broad-fix-test-final.log` and `outputs/broad-fix-build-final.log`. Earlier `broad-fix-*.log` attempts are retained, including red tests and intermediate live failures. Default repository tests skip the opt-in live suite; those skips are not live acceptance passes.

## Practical limits

The browser initially verified that the broad reception question still over-selected opening duties, which prompted the scope repair. Browser control was subsequently disabled in Work settings. Further verification uses the real gateway with the existing test-scoped active STAFF capability; it is not a claim of completed normal STAFF/ADMIN browser acceptance. The original browser audit remains separate evidence. No new successful browser screenshot is claimed.

These are repaired regression cases, not independently held-out MS-63 quality or production-release acceptance. Full five-user, cold-start, ingestion-contention and complete-render performance profiles were not measured. Exact fallback deliberately retains unreviewed FAQ/body differences and all operative qualifications when a concise projection fails independent support checks. It may still be longer than a natural conversation answer; the repair does not certify universal concision or remove evidence merely to achieve it.

The known campaign test failure is unrelated to these RAG changes and remains reported as a failing full-suite result. No campaign logic or assertion was altered. Deployment and production activation were not performed.
