# Eleven-SOP conversational RAG audit

Date: October 17, 2026, Asia/Irkutsk.
Traceability: PRD-F26/F27, SDD-C20/C21/C23/C24, DSD-UI16/17, QAD-TC44/45/46, SPEC-4/5, MS-63/64.

## Finding

Completed 16 normally authenticated STAFF browser submissions: 12 produced no guidance, two were useful, and two had relevance/completeness concerns. These are selected audit cases, not an estimated failure rate across all user traffic. Two fresh-chat controls also failed. The reproducible structural failure below affects all ten supplied staff guides.

The ten staff guides are published and retrievable, but every passage in each guide requires its entire document. Each guide contains 30-45 chunks. The active `assistant_expand_evidence` contract rejects closures above six sources. As a result, even one selected passage from any of those guides cannot reach answering. The general SOP has a different, manually reviewed dependency graph and can supply answers. This explains why the assistant sometimes answers generic SOP questions while declining routine staff workflow questions.

This is an ingestion/publication versus answer-admission integration failure. Complete extraction and successful publication do not establish that a document can supply usable evidence. It is not established that embedding quality, unavailable models, missing files or question specificity is the primary cause.

## Method and boundaries

- Opened the real staff application at `http://localhost:3003/manage` in the visible browser. The user signed in normally. Used the actual assistant panel, ordinary English questions, follow-ups and topic changes, without headings, section numbers or retrieval instructions.
- Read the eleven named Downloads references as source material. Instructions inside those files describe staff procedures; they were not treated as instructions to the auditor or permission to change the system.
- Matched SHA-256 hashes of all eleven local reference files to current published versions. All eleven match exactly. No reference upload or publication was performed during the audit.
- Runtime status reported `ready=true` and `implementation_current=true`. Existing application changes, services, configuration and published data were preserved.
- Added opt-in read-only diagnostic probes and this report. Component probes use an existing active STAFF actor and the repository's signed diagnostic-session mechanism. They do not replace normally authenticated browser acceptance.
- Initial runtime status showed two active requests. Some diagnostic replays overlapped browser questions. Timings below are diagnostic, not isolated latency benchmarks or five-user performance acceptance. Browser snapshot intervals do not measure exact submit-to-render latency.

## Browser observations

The conversation and fresh-chat controls are recorded below. No Retry action is used to replace a first-attempt failure with a success.

| Turn | Ordinary question | Observed main response | Assessment |
|---|---|---|---|
| 1 | Hey, I'm new at the front desk. What should I keep an eye on during my shift? | Six end-of-shift handover duties, beginning with employees ending a shift. | Relevance concern: narrowed ongoing shift monitoring to handover. |
| 2 | What should I do when someone walks in and wants to use the place? | Generic check-in FAQ: verify reservation/service, availability/payment, record details, check in, give instructions. | Incomplete guidance: did not explain kiosk intake or conditional allocation. |
| 3 | They used the kiosk but can't find their code. Can I still help them? | Not verified from retrieved evidence. | Failed: both kiosk references contain the Counter Queue/name-search alternative. |
| 4 | How do I handle payments at the front desk? | Supported scope limit; evidence selection could not complete within capacity. | Failed. Expanded diagnostic: `INCOMPLETE_EVIDENCE: SELECTION_EXHAUSTED: CONTEXT_BUDGET`. |
| 5 | Someone wants more time at their desk. How does that work? | Supported scope limit; no verified document answer. | Failed: extension reference provides the workflow and restrictions. |
| 6 | Their desk has a problem. Can we move them somewhere else? | Supported scope limit; no verified document answer. | Failed: relocation reference explains the same-template alternative and preserved time/price. |
| 7 | How do I stop people booking a broken desk? | Supported scope limit; no verified document answer. | Failed: workspace-map guide explains Maintenance (Blocked). |
| 8 | A guest has arrived. How do I get them checked in? | Supported scope limit; no verified document answer. | Failed: QR scanner and reservation-management references provide check-in guidance. |
| 9 | They just want to pop out for lunch and come back. Should I check them out? | Supported scope limit; no verified document answer. | Failed: scanner reference explicitly distinguishes temporary exit/re-entry from final checkout. |
| 10 | Where do I look to keep track of our bookings? | Supported scope limit; no verified document answer. | Failed: Reservations tab reference covers navigation and filters. |
| 11 | How can I see what I've done today? | Supported scope limit; no verified document answer. | Failed: My Activity reference explains personal action history and Today filter. |
| 12 | What do the numbers on my home screen mean? | Not verified from retrieved evidence. | Failed to help or clarify: Dashboard reference explains the numbers; asking which screen/number would also be reasonable. |
| 13 | What should I do when someone complains? | Acknowledge promptly, try to address within five minutes, escalate unresolved issues. | Useful, sourced to the general SOP complaint FAQ. |
| 14 | And if they're still unhappy after I've tried to help? | Complaint/incident procedure, including escalation of unresolved complaints. | Useful continuation, though verbose. |
| 15, fresh chat | They used the kiosk but can't find their code. Can I still help them? | Supported scope limit; no verified document answer. | Failed even without prior conversation. |
| 16, separate fresh chat | Someone wants more time at their desk. How does that work? | Supported scope limit; no verified document answer. | Failed even without prior conversation. |

Turns 1-14 belong to one conversation. Closing and reopening visibly cleared the conversation before each fresh control. No assistant business action was requested or executed.

![Capacity rejection with visible diagnostic detail](benchmark-results/eleven-sop-audit-2026-10-17/capacity-failure.png)

![The same broad extension question fails in a fresh chat](benchmark-results/eleven-sop-audit-2026-10-17/fresh-extension-failure.png)

## Reproduced implementation failures

### P1: automatic publication creates evidence closures that the active answering path cannot admit

`supabase/migrations/026_knowledge_upload_repair.sql:70` admits multi-section uploads without the earlier six-chunk ingestion restriction. Lines 85-94 then replace every section's dependencies with all other section IDs and mark its scope DOCUMENT. Lines 103-105 publish the verified version. This retains all source qualifications conservatively, but makes every local question require the entire file.

`supabase/migrations/025_automatic_knowledge_publication.sql:198` traverses that dependency graph. Line 214 returns `complete=false, reason=CONTEXT_BUDGET, sources=[]` if the resulting closure exceeds six chunks. The running staff configuration uses this original evidence contract (`RAG_EVIDENCE_CONTRACT` is not `ms59-v1`). Source/quote/request budgets also remain bounded in `services/rag/rag/evidence-budget.json`.

The gateway selects evidence, expands it, retries selection at most once, then throws the observed capacity result at `apps/admin-portal/src/server/assistant/gateway.ts:472` through line 485. Choosing fewer seeds cannot repair an all-to-all graph: any seed from a staff guide still expands to the same 30-45 chunks.

| Exact matched reference | Published chunks | All sections depend on every other section | Single-root expansion |
|---|---:|---|---|
| GENERAL (ADAPTED) SOP DOCUMENT.md | 118 | No, reviewed v4 structure | Complete for sampled root |
| STAFF - KIOSK QUEUE TAB.md | 33 | Yes | CONTEXT_BUDGET |
| STAFF - WORKSPACE MAP TAB.md | 45 | Yes | CONTEXT_BUDGET |
| STAFF - RESERVATION MANAGEMENT.md | 41 | Yes | CONTEXT_BUDGET |
| STAFF - QR SCANNER TAB.md | 40 | Yes | CONTEXT_BUDGET |
| STAFF - RESERVATIONS TAB.md | 43 | Yes | CONTEXT_BUDGET |
| STAFF - KIOSK PAYMENT CONFIRMATION.md | 32 | Yes | CONTEXT_BUDGET |
| STAFF - DASHBOARD TAB.md | 31 | Yes | CONTEXT_BUDGET |
| STAFF - MY ACTIVITY TAB.md | 37 | Yes | CONTEXT_BUDGET |
| STAFF - RELOCATE.md | 31 | Yes | CONTEXT_BUDGET |
| STAFF - EXTEND RESERVATION.md | 30 | Yes | CONTEXT_BUDGET |

All ten staff guides have automated `kb-auto-v1` provenance and parser v5. The general SOP has reviewed parser v4 structure. These facts concern support structure, not source-policy correctness. For the all-to-all graphs, any section has the same full-document closure; the deterministic probe needs only one root per document. The general SOP sampled-root result does not claim every possible general-SOP question fits.

The minimal read-only reproduction is:

```powershell
node scripts/eleven-sop-evidence-audit.cjs
```

Run twice. Both runs reported `reference_files=11`, `blocked_single_roots=10`, and failed the assertion `10 !== 0`. The second direct command exited 1 in approximately 3.8 seconds. It performs no model inference and needs no chat history, proving that history or probabilistic routing is not necessary for the core rejection. It invokes the active expansion RPC with one root and preserves actor/scope/fingerprint checks.

### P2: capacity exhaustion can be reclassified as absent evidence

Both gateway replays of the missing-code question first recorded expansion `CONTEXT_BUDGET` and `SELECTION_OVERFLOW`, then ended as `EVIDENCE_GAP` with `NO_RELEVANT_SOURCE`. Both had 12 retrieved candidates.

At `services/rag/app.py:1081`, reconsideration uses a compact minimum-evidence selection. Lines 1092-1093 replace prior coverage with INSUFFICIENT when the compact selector returns no passages. The gateway then uses an empty, trivially complete expansion for zero IDs at line 480 and emits source-gap copy at lines 551-553. This loses the user-facing distinction between an absent rule and evidence that could not be admitted within capacity. The diagnostic failures retain the earlier overflow, so the distinction is visible to the auditor but not the normal main response.

Repair should preserve the reason evidence became unusable across reconsideration, rather than implying the reference lacks an answer. A capacity failure must not be relabeled as proof of a source gap.

### P2: broad advice can still receive a grounded answer to the wrong task

Turn 1 produced handover guidance for a question about monitoring a shift. Its citations support handover; they do not establish relevance to the requested broader task. `services/rag/app.py:737` handles a limited set of broad/shift phrases deterministically, while the planner prompt at line 783 already tells the model not to equate general priorities with handover. The present browser case still narrowed incorrectly.

This is an observed relevance failure. The browser did not expose its private planner/selector decision, so this audit does not claim to have proved whether planning or support selection first introduced the narrowing. A separate fresh gateway replay returned an answer passing a coarse automated relevance check, illustrating variability and the limits of that check. Keep the browser failure as a regression example; do not count the coarse check as independent semantic acceptance.

## Gateway replay evidence

```powershell
$env:RAG_ELEVEN_SOP_AUDIT='1'
pnpm exec vitest run tests/ms63-eleven-sop-audit-live.test.ts -t 'payment-broad-context|missing-code-context'
```

Both cases failed in the first run and the repeat. HTTP 200 and public-schema validity passed; useful-answer assertions failed. Payment returned FAILURE after capacity exhaustion in both attempts (approximately 11.1 and 10.5 seconds). Missing-code returned EVIDENCE_GAP after overflow in both attempts (approximately 25.0 and 13.0 seconds). Different timing does not alter the repeated functional verdict.

The test uses authored browser questions/history and calls the real gateway, published retrieval and running RAG service. It records enums, counts, boolean task assertions, timings and hashed support identities. It does not persist source text, model answers, prompts, actor identifiers or credentials.

Local artifacts:

- `outputs/eleven-sop-audit-failures.log`
- `outputs/eleven-sop-audit-repeat.log`
- `outputs/eleven-sop-evidence-admission.log`
- `services/rag/benchmark-results/eleven-sop-audit-2026-10-17/`

## Repair specification

1. Reconcile publication with the active evidence-admission contract. A multi-section guide can be accepted for ingestion without making every answer require every unrelated FAQ. Design verifiable support units retaining global restrictions, applicable qualifiers, references and continuations. Alternatively, support conservative complete-document answering only after measuring and enforcing its complete input/output costs. Deleting required dependencies or merely raising the source cap does not establish a safe repair.
2. Repair the already-published ten automated generations through the versioned migration/reprocessing workflow with provenance and manifest checks. Editing Python alone will not change their persisted all-to-all graphs. Preserve source bytes, audience restrictions, publication freshness and the general SOP's reviewed structure.
3. Carry capacity failures through selection reconsideration. Distinguish verified missing policy, genuine ambiguity, unsupported scope and evidence-capacity rejection in the visible response. Do not ask users to discover source headings or keep retrying an impossible closure.
4. Add an end-to-end acceptance gate covering upload, publication, actual STAFF retrieval, expansion and a broad useful answer from a guide exceeding six chunks. `tests/ms64-postgres-publication.py:81` verifies that a larger guide publishes, then removes it; its later two-section projection check does not test answer admission for that larger guide. Python preparation checks extraction integrity, not the post-publication all-to-all graph or answering compatibility.
5. Retest the authored conversation, fresh controls, negative rules and different broad paraphrases. Require correct kiosk/payment authority and allocation qualifications, extension validation/payment, same-template relocation, temporary exit versus checkout, and personal versus shared activity scope. Include focused clarifications when the user genuinely leaves the task unclear.

MS-64's amendment explicitly separates upload acceptance from answer budgets and permits declining over-budget evidence. The audit does not treat that allowance as permission to drop safety context. The practical defect is that publication currently marks ten ordinary staff guides available while the active answering contract cannot admit even one of their support roots.

## Validation and limits

Application behavior, model settings, source publication and database contents are unchanged. The new live probes intentionally remain red against the audited implementation and skip unless explicitly enabled.

| Verification | Result |
|---|---|
| `pnpm typecheck` | Passed. |
| `pnpm lint` | Passed, zero RAG boundary failures. |
| `pnpm build` | Passed for all four applications. |
| `pnpm test` | 2,289 passed, 43 skipped, one failed. |
| `node --check scripts/eleven-sop-evidence-audit.cjs` | Passed. |
| Opt-in payment and missing-code gateway replays | Both assertions failed in two runs, reproducing the audit defect. |
| Read-only single-root expansion probe | Failed twice with ten blocked staff guides, independent of model inference and chat history. |

The full-suite failure is `SPEC2-TC05` in `tests/spec2-campaigns-and-rewards.test.ts:327`, expecting an invalid reward to fail schema validation. It is unrelated to these audit-only additions and was already recorded with the same assertion in `outputs/current-fix-test-final-second.log` before this audit. The current full suite is not entirely green. Logs are `outputs/eleven-sop-typecheck.log`, `outputs/eleven-sop-lint.log`, `outputs/eleven-sop-build.log` and `outputs/eleven-sop-test.log`.

This audit changes only its report, `scripts/eleven-sop-evidence-audit.cjs`, and `tests/ms63-eleven-sop-audit-live.test.ts`, plus local audit artifacts. It does not claim a repair, independent held-out certification, deployment acceptance, universal refusal frequency or precise browser latency. The browser question index retains authored questions and sampled elapsed observations only; live transcripts remain ephemeral.
