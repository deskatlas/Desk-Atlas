# October 17 RAG audit remediation

Date: October 17, 2026, Asia/Irkutsk. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, SPEC-4/5/6, MS-60.

Source finding: [Browser audit](BROWSER-AUDIT-2026-10-17.md). This supplements the existing MS-60 implementation without rewriting the historical audit observations.

## Delivered changes

| Finding | Implementation | Verification |
|---|---|---|
| Model analysis displayed as clarification | Python rejects declarative clarification and clarification paired with supported passages or conflict. The gateway independently checks focused-question shape. Invalid selections can retry within the same two-attempt and deadline ceilings. | Synthetic replay went from exit 1 to exit 0. Actual malformed-output gateway regression passes. Genuine missing payment-channel clarification remains valid. |
| Routine questions exhaust evidence selection | MS-60 overflow reconsideration now uses the compact minimum-support selection seam, preserving the original question, prior coverage and obligations. It expands all reviewed dependencies of the new selection and runs the same packing and final grounding checks. | Real authenticated STAFF gateway reproduced the two-selection/two-expansion failure before changes. Three final rounds of payment-context, explicit-permission and refund-context checks passed, nine requests total. |
| Verbose selection output and misclassified permission decisions | Internal applicability output has shorter keys and bounded short reasoning, within the existing output token limit. A fully supported single yes/no decision may use factual presentation instead of a full how-to. Actual procedure and incomplete/multipart cases retain conservative scope handling. | Compact output, genuine clarification, permission/procedure scope and original-condition regressions pass. |
| Staff assistant silently disappears at credential expiry | An auth failure still cancels work and clears chat. The launcher then offers an explicit sign-in recovery control. In the staff portal it calls the existing logout flow so the normal login form appears. No credential is silently renewed. | The real one-hour credential verifier and launcher hooks are exercised under a controlled clock. Expiry removes the panel, exposes recovery, and invokes the caller's reauthentication callback. Existing role/identity, disablement, cancellation and transient-failure tests still pass. |
| Tagalog bag question detected as English | Sentence cues recognize the audited wording and distinguish an English use of “May” from Filipino phrasing. Original user wording and language now reach synthesis instead of only an English retrieval rewrite. | Seven new language cases and existing language-copy tests pass. Browser observed localized Tagalog notices and, when synthesis was admitted, Tagalog guidance. |
| Repeated generated headings and duplicate claims | Only exact navigation-only blocks proven from citation headings and supporting spans are omitted from the main synthesized view. Full proof remains available. Identical factual blocks merge their support indexes; ordered procedures retain repetitions. | Multiline navigation, scope-bearing heading, exact-proof preservation, duplicate-support union and existing rendering tests pass. |

## Boundaries preserved

No corpus replacement, publication change, migration, dependency, similarity reduction, budget increase or business-policy mutation was made. Existing extensive working-tree changes were preserved. The assistant still uses server-verified roles, current publication/epoch/hash checks, complete reviewed closure, canonical packing, independent grounding and separate synthesis support verification.

Selection and expansion each retain their maximum of two attempts. A malformed-selection retry consumes that existing allowance; it does not create an extra recovery loop. Compact reconsideration cannot delete reviewed dependencies. Insufficient permissions and procedures remain unavailable rather than being answered from partial evidence.

The clarification syntax check is a mechanical guard, not proof that a question is semantically appropriate. Contradictory supported-answer/clarification combinations are rejected separately. Role authorization and evidence sufficiency remain independent of presentation scope. The scope correction applies only to a single supported decision without conflict/clarification, and excludes requests for steps, explanation or a process.

Staff expiry remains one hour. Neither the old unsigned staff account-activity poll nor a persisted dashboard user is treated as authority to renew that credential. Reauthentication remains the existing normal login workflow. An expired transcript is never restored. The original historical disappearance still lacks a captured causal trace; this repair addresses the demonstrated expiry/recovery design gap and does not fabricate that historical attribution.

## Reproduction and tests

```powershell
.\services\rag\.venv-service\Scripts\python.exe scripts/rag-clarification-audit.py
pnpm exec vitest run tests/ms60-gateway.test.ts tests/ms45-assistant-lifecycle.test.ts tests/ms60-audit-language.test.ts tests/ms57-synthesis.test.ts tests/ms59-presentation.test.ts
.\services\rag\.venv-service\Scripts\python.exe -m pytest services/rag/tests/test_ms60_audit.py -q
$env:RAG_AUDIT_GATEWAY='1'
pnpm exec vitest run tests/ms60-audit-gateway-live.test.ts
```

The opt-in live test runs the actual gateway against the current local private service and published corpus. It constructs an ephemeral signed test credential for an active STAFF profile and rechecks authority through the real gateway. This is distinct from a normal browser sign-in and does not replace browser acceptance. It records only fixed case IDs, numeric metrics, enum diagnostics and boolean policy/provenance checks. It never saves prompts, source passages, model prose, credentials or guest data.

The baseline captured an explicit staff-permission failure after two selections and two expanded unions. Final live results include nine successful checks in three rounds. Six content-free artifacts from the last two rounds are in ignored `benchmark-results/audit-remediation-2026-10-17/`. They show the existing two-attempt ceiling, useful exact permission evidence and correct refund gaps. Exact fallback reasons include synthesis timeout, service failure and schema rejection; these are not recorded as successful conversational synthesis. Some runs overlapped ordinary repository tests, so their durations are not a controlled latency benchmark.

## Browser verification

The user signed in again through the normal staff flow. The original twelve-question sequence was replayed, including vague noise follow-up, topic switches, Tagalog lost property, temporary return, both online-payment permission questions, refund amount, hazards, handover and unpaid desk selection. All twelve eventually completed with relevant guidance or the expected refund evidence gap in the final replay sequence; a later payment repeat also completed. The panel remained present through those final questions.

Earlier development failures remain part of the record: one payment turn still returned invalid selection before compact output repair, a Tagalog synthesized answer repeated headings before the rendering refinement, and a conversation was reopened after development source updates. Final scope/prompt refinement was loaded during the later part of the replay, so this is not represented as a frozen-build twelve-turn benchmark. The final gateway rounds separately exercise the final implementation.

A browser automation call spanning two slow answers exceeded its own execution window. Reconnecting showed the intact conversation and the eventual completed payment answer. That tooling timeout is distinct from an application answer timeout or panel disappearance.

## Repository checks

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, configured RAG boundary checks |
| Relevant Python RAG suites | 137 passed; existing Starlette deprecation warning |
| Clarification diagnostic replay | Passed |
| `pnpm test` | 2,215 passed, nine skipped, one existing campaign failure |
| `pnpm build` | Passed for all four applications |

The remaining complete-suite failure is `tests/spec2-campaigns-and-rewards.test.ts:327`, strict reward-vocabulary rejection, already present before this audit. An intermediate language regression for “Can staff approve ba?” was caught by the full suite and corrected; the final suite has only the original campaign failure. No campaign code was changed.

## Remaining practical limitations

The known payment/refund reliability cases now pass locally, but this does not establish a universal refusal rate, independently reviewed multilingual quality or the milestone's latency/concurrency targets. English exact quotations remain the safe fallback for a Tagalog question when generated translation cannot pass support verification. Complete procedures can still repeat an equivalent FAQ, and broadly reviewed legacy Section 11 can still produce long exact answers. The changes remove proven redundant generated navigation and identical generated prose; they do not silently redefine that publication's approved evidence units.

Polished concise synthesis is not consistently admitted by the present local model and bounded synthesis lane. The final artifacts explicitly show this limitation rather than counting exact fallback as fluent localized synthesis. Full exact supporting evidence remains available. Publication granularity changes and independent release/performance acceptance remain separate from the local failure repairs.

## Operation and rollback

The local private API was restarted to load the Python changes using the existing `rag:api` launch workflow. An externally terminated local process was found after a continuation and restarted; its termination is not attributed to application logic without a trace.

At handoff, the authenticated readiness check reported ready and implementation-current, and the staff dev server was restored on port 3003. The first cold restart failed during model preload; a subsequent normal launch completed all readiness stages using the saved GPU profile. The old browser tab retained a browser error page. Browser policy blocked observing its internal error-page protocol, so no new browser observation or screenshot after that restart is claimed. Earlier signed-in browser verification and final gateway artifacts remain the evidence described above.

Deploy the compatible private service and gateway together. Internal applicability aliases do not change the external answer/citation contract. Updated overflow recovery uses the existing context request fields; unknown older contracts must fail safely. Revert these request-local and presentation changes together if rollback is needed, while keeping role checks, expiry enforcement, current-source verification and complete evidence protections. No SQL rollback or source resurrection is required. This record claims local remediation and validation, not a production deployment.
