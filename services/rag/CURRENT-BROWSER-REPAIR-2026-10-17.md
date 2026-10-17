# Broad-question audit repair and verification

Date: October 17, 2026, Asia/Irkutsk.
Traceability: PRD-F13/F26/F27, SDD-C20/C21/C22, DSD-UI16, QAD-TC23/44/46, SPEC-4, MS-60/62/63.

Authority: the maintainer requested repair of all issues in [the current browser audit](CURRENT-BROWSER-AUDIT-2026-10-17.md). The original audit and red runs remain unchanged. Existing unrelated working-tree changes were preserved.

## Repairs

| Audited issue | Change and verification boundary |
|---|---|
| Advice dispatches operational tools | Requests without explicit measured-data intent use a knowledge-only inference schema with zero tools. Role checks remain before reconciliation. Explicit counts, reports, availability, mixed requests and genuine date continuations retain the data planner. |
| Stale operational selections contaminate a new task | The planner removes a prior tool selection unless the current message actually continues its filters. New named tasks do not automatically receive the previous question during synthesis/support. Short references retain both authored user inputs as intent, never policy evidence. |
| Invalid plan on an ordinary follow-up | A direct private-planner probe identified an invalid `tools[0].args.floor_id`, rather than guessing the malformed field. Knowledge-only generation eliminates that unrequested tool/filter path. Gateway diagnostics count invalid filter/clarification fields without reflecting values. Recovery copy now asks for rephrasing/retry rather than metrics and dates. |
| Follow-ups route correctly but find no evidence | Bounded search normalization covers ordinary extension, noise, complaint, property and opening tasks using the current input or its admitted resolution. Every search retains the original question. The prior similarity threshold, four-query limit, candidate cap and independently checked source expansion remain unchanged. |
| Noise continuation reaches correct evidence but is refused | The resolved task and literal preceding user question are retained together. Independent support review resolves a follow-up's subject from user context and compares continued behavior against the source's qualifications. The verifier can still reject an unrelated or unsupported answer. |
| Required opening duties disappear from main guidance | A numbered workflow is admitted as a complete procedure even if the selector mislabels its scope. Python generation and TypeScript validation independently reject missing or reordered numbered duties in the actual main answer. Citation coverage and hidden proof do not satisfy this check. An unordered general explanation is distinguished from an explicit full workflow while retaining the complete proof and independent support review. |
| Broad advice chooses an arbitrary task | A fresh task-free request asks which task or part of the shift needs help. Ending the day asks whether the employee is handing over or closing, rather than guessing. Named tasks continue through published retrieval. |
| Dashboard identity outlives assistant credential | Staff heartbeat now uses the assistant's signed-credential and active-role verifier. The shared session lifecycle supports staff credentials and withholds restored dashboard identity until verified, clears expired sessions, retains retryable outages and ignores stale results. Expiry timers, cross-tab synchronization and deactivation handling remain active. |

No model, dependency, similarity threshold, evidence budget, database migration, knowledge publication or production activation was introduced. The owned local API was restarted through the existing saved GPU launch profile, then checked for current implementation identity.

## Verification record

The initial new Python caller-pattern tests failed 11 cases before repair. The initial TypeScript session/main-answer tests failed all four cases before repair. A direct private-plan probe failed the public plan schema on `tools[0].args.floor_id`. These red logs are retained in `outputs/current-fix-python-red.log`, `outputs/current-fix-ts-red.log` and `outputs/current-fix-plan-red.log`.

The first live repair run still failed five questions through evidence gaps. A subsequent three-case run passed complaint and extension but failed noise at final applicability. Those failures remain in `outputs/current-fix-live-first.log` and `outputs/current-fix-live-second.log`. They were used to distinguish routing repair from retrieval and final-verification repair.

Focused TypeScript verification passed 61 tests. Final Python verification passed 480 tests with 16 opt-in/external skips and one dependency deprecation warning. All three noise continuation cases passed, including new wording and the minimized one-prior-turn scenario. Typecheck, lint and all four production builds passed.

The expanded live suite passed all 17 checks, recorded in `outputs/current-fix-live-verified.log`. It covers the original failures, fresh and contextual extension questions, minimal noise follow-ups, full opening/closing duties, clarifications, explicit measured-data intent and the private planner schema. Date continuations retain earlier data intent across successive follow-ups; a task change clears the stale selection. A subsequent isolated fix honors `search_enabled=false` while preserving resolved intent. That branch has a red regression log and passes in the final Python suite; live gateway tests enable search aids and do not exercise the disabled branch. After the final restart, local runtime status reported `ready=true` and `implementation_current=true`.

The full repository suite passed 2,277 tests, skipped 40 and failed one pre-existing campaign-validation test: `SPEC2-TC05` in `tests/spec2-campaigns-and-rewards.test.ts`, line 327. It expects an invalid reward to fail schema validation. The same failure was present in the baseline before these repairs. The campaign schema was left unchanged. The full repository suite is therefore not entirely green. Final logs are `outputs/current-fix-python-complete.log`, `outputs/current-fix-lint-complete.log`, `outputs/current-fix-typecheck-final.log`, `outputs/current-fix-build-final.log` and `outputs/current-fix-test-final-second.log`.

## Browser acceptance

The normally signed-in STAFF browser was reloaded. It visibly showed session verification before showing the dashboard, then opened the assistant without a sign-in mismatch. The original broad advice question asked for the task/shift stage. The opening follow-up displayed all eleven published duties in the main response.

![Broad advice now clarifies the task](benchmark-results/current-browser-fix-2026-10-17/broad-clarification-browser.png)

The complaint follow-up returned escalation guidance, rather than operational counts. The extension question was answerable after the topic change. Lost-property guidance contained secure storage and ownership verification with no operational table. Ending the day asked whether this meant handover or closing. A natural reply that the facility was closing produced all ten published closing duties, including unresolved-issue reporting and handover.

In the fresh second chat, the extension question returned a concise paragraph with complete approved-policy/availability/recording qualifications and the original source available through proof controls. The general noise question returned the four published noise-control duties. "They ignored me. Now what?" also returned the noise-control guidance including escalation, without an invalid-plan error or operational table.

All ten original browser questions were rechecked, plus a natural reply to the closing clarification: eleven submissions total, with nine useful answers and two targeted clarifications. Browser checks were performed during the repair sequence. The explanation-scope refinement was loaded before the closing reply and second conversation; its final context/fresh controls are also included in the expanded live suite. This is regression verification, not a frozen independent MS-63 browser-quality certification.

The repository run additionally exposed an older bounded-batch fixture that returned only one embedding even when two permitted aid queries were supplied. Its mocked response now matches the actual bounded query count, while retaining the original-answer assertion, original wording in every query, three-aid ceiling and prohibition on hybrid SQL access. Its six focused tests passed.

The browser session later expired naturally during verification. The dashboard returned to the normal sign-in form with "Your session ended. Sign in again." instead of retaining a staff identity while the assistant rejected its credential. This confirms the observed expiry behavior as well as the automated signed-session checks.

## Reproduction commands and limits

```powershell
$env:RAG_CURRENT_BROWSER_AUDIT='1'
pnpm exec vitest run tests/ms63-current-browser-audit-live.test.ts
pnpm exec vitest run tests/ms63-current-browser-repair.test.ts tests/ms47-admin-session-consistency.test.ts
services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests -q
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/rag-status.cjs
```

Live component capabilities are diagnostic controls, separate from normal browser authentication. Stored artifacts contain enum/numeric/boolean measurements and hashed source identities, not model transcripts, canonical excerpts, credentials or operational records. These authored regression cases are not independent held-out quality certification, bilingual acceptance or five-user complete-render performance acceptance.

Exact fallback still retains required conditions and source distinctions. The published closing procedure contains repeated reconciliation wording with a separate POS qualification; this repair does not silently edit published policy to remove that distinction. Source publication and production deployment remain separate authorized workflows.
