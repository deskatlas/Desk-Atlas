# MS-60 local implementation and verification

Traceability: PRD-F26/F27; SDD-C20/C21; DSD-UI16; QAD-TC44/45/46. Plan: [MS-60](../../docs/milestone/ms60.md). Baseline: [fourteen-question browser re-audit](BROWSER-REAUDIT-2026-10-16.md).

October 17 follow-up: [Conversational audit remediation](AUDIT-REMEDIATION-2026-10-17.md) records additional clarification, overflow reconsideration, staff expiry recovery and presentation repairs, with their actual validation and remaining limits.

The maintainer subsequently requested implementation, superseding the plan's original Markdown-only authoring scope. This record distinguishes delivered local repairs from independent quality, repeated-conversation, publication, performance and release acceptance. Existing extensive uncommitted work was preserved. No dependency installation, live migration, source upload/review/publication, similarity-threshold change, hybrid admission or production deployment occurred.

## Delivered behavior

### Original conditions and applicable rules

The private context endpoint accepts an explicit `reliability_contract=ms60-v1`. Its bounded inference projection retains every candidate's full canonical text, title, heading and identity while omitting database metadata unused by selection. It does not trim passages, select by rank alone or summarize rule-bearing text to fit a request.

The new condition-aware decision identifies original requested conditions and a request-local direct answer before mapping actual requested parts to candidate support. It sees all retrieved candidates, including previously unselected contrary/applicable rules. Original wording is supplied separately from resolved retrieval intent; source/history content remains untrusted. Draft assessment/answer text is never emitted as evidence or recorded in diagnostics. The obsolete initial selection call is skipped for this contract because its result was discarded by the independent comparison; legacy callers retain their previous behavior.

Final exact answering verifies the entire canonical selected closure independently against the original question and any resolved user intent. It no longer runs a redundant excerpt selector that can lose the only applicable rule after successful retrieval/selection. All required canonical proof remains present. The verifier distinguishes a procedure from whether that procedure applies, accepts supported negative rules and qualified guidance, and matches paraphrases across English/Tagalog/Taglish. Scope, amount-gap, source-conflict and complete-proof gates remain. Deterministic procedure/governance paths cannot ignore changed original conditions merely because a search rewrite matches a generic task grammar.

The lunch reproduction initially still failed during implementation: a safe rejection replaced the wrong answer without yet producing useful guidance. Later live replays selected the published return rule and emitted exact verified evidence containing the temporary-exit/re-entry distinction. Those intermediate failures were not counted as successful remediation.

### Canonical packing admission and shared recovery

Authenticated `/v1/evidence-cost` uses the same `complete_evidence_quotes` and `pack_evidence` implementation as answering. It returns bounded numeric quote/span costs, a typed fit/reason and a SHA-256 binding of the exact authenticated request body. The gateway checks the strict schema and binding before trusting admission. Unknown/malformed contracts and binding mismatches fail without evidence release. No database credential enters Python.

Preview, serialized byte checks and final answering use one gateway payload builder. All reviewed required sources/groups, original query, coverage and context inputs therefore participate in admission. Six source chunks are not assumed to mean six output quotes. An atomic overlong span remains a failure; no seventh quote, condition, dependency or paragraph is discarded.

Packed overflow shares the existing maximum two selection calls and two selected-union expansions across the request, including epoch handling. Preview occurs only for a complete authorized union; at most two corresponding previews occur. Reconsideration retains the same monotonic deadline and greater-than-ten-second admission gate. The source/quote/span/request/token limits were not increased. Initial candidate-comparison failures and later output failures receive truthful preparation/comparison copy rather than a claim that an already-specific user request is inherently too broad.

The payment reproduction previously admitted six sources that packed to seven quotes. Current replay selects one sufficient direct permission unit plus its reviewed dependencies: four sources, five quotes. The server still independently repacks and verifies the final proof. Unexpected final output failures remain safe failures; canonical preview/final parity is regression-tested rather than relying on a client-provided cost.

### Wallet diagnosis and client lifecycle

A real authenticated admin-browser wallet failure was observed with development diagnostics: two candidates, one selected direct source, three complete closure sources, successful packed admission, then `NO_RELEVANT_SOURCE` during final grounding. The authorized lost-property source was present. This identifies an answer-stage rejection for that captured request, not a missing-retrieval or purely translation failure. Exact verification changes above address that demonstrated seam. Broader unseen topic-switch causes remain subject to repeated acceptance.

The signed-in staff browser exposed a second, distinct failure during mixed-topic repetition: the Tagalog wallet turn after opening/noise history retrieved zero candidates, while its fresh-conversation control passed. A real STAFF component replay reproduced the history-dependent miss. Query understanding now supplies an optional conventional English operational topic (for example, lost-and-found handling), prioritized within the existing four-query ceiling. Every embedding aid retains the original question and its conditions. This is a bounded retrieval aid, not invented policy, a lower similarity threshold or permission to bypass reviewed sources. The new query-priority regression went red before this repair. The final STAFF history-dependent replay retrieved the authorized lost-property rule and verified its complete three-source closure.

After the final repair, ten fresh authenticated staff conversations each ran opening, noise complaint, persistent-noise follow-up, Tagalog wallet and English wallet in that order. All 50 turns completed with the expected operational guidance and without generic refusal or panel disappearance. Earlier development failures remain separately recorded. These are known-case browser usefulness checks, not independent human language review or a latency benchmark.

A real-launcher hook test also reproduced that an offline availability poll cleared an open conversation. It went red before the client repair. A transient failure now leaves the same-session panel visible with an explicit unavailable message. Every later dispatch still requires a successful fresh availability read. Verified authorization/identity changes, disablement, logout, user close and navigation retain their cancellation/clearing behavior. Normal evidence gaps are no longer interpreted as sign-out. Both portals use this shared launcher and verified gateway.

Development-only lifecycle events use fixed reason enums. Development requests can opt into existing authenticated content-free gateway diagnostics; the client forwards only allowlisted numeric counters through ephemeral browser events. No console payload logging, transcript storage, source text, token value or rejected prose is added. Production does not enable these development events/headers automatically. This repair does not claim that the original audit's unexplained panel disappearance was proven to be an offline poll; that historical attribution remains unresolved.

### Shared exact presentation

Normal copy strips recognized nested capacity codes into diagnostic details. Exact rendering removes only redundant navigation that is already represented by exact visible headings. Scope-bearing headings and substantive restrictions remain; complete proof and offsets remain unchanged in the evidence view. A regression specifically retains an `Admin only` heading and its permission restriction while removing the duplicated breadcrumb.

Legacy Section 11 remains one broadly reviewed unit. Its unrelated control paragraphs can still accompany a re-entry or permission answer. The implementation does not silently carve that source into newly approved independent units. Tagalog questions can still receive original English proof with localized notices. These behaviors pass provenance safeguards but are not full conversational readability or language acceptance. MS-59's prepared reviewed projection remains separately gated; it was not activated by this work.

## Verification

Baseline commands were run red before changes:

```powershell
node scripts/rag-natural-audit.cjs food_return_context --candidate --original-control
node scripts/rag-natural-audit.cjs payment_frontdesk --candidate --packing-control
```

The first produced valid-provenance checkout text without the return distinction; the second returned HTTP 400 `OUTPUT_BUDGET_EXCEEDED` with seven packed quotes. New Python regressions also went red before their implementation. The transient availability launcher regression went red before the client change.

| Check | Actual local result |
|---|---|
| `pnpm test:ms60` | 21 passed across five gateway, presentation, query-understanding and shared lifecycle suites |
| `pnpm test:ms60:python` | Nine passed, including canonical cost/authentication/binding, UTF-16 limits, compact-contract negotiation and independent applicability |
| Python MS-56/57/58/59 plus MS-60 | 82 passed; existing Starlette deprecation warning |
| Relevant gateway compatibility suites | Updated mocks recognize the new authenticated packing operation; original revocation, conflict, scope and error assertions retained |
| `pnpm test` | 2,204 passed, six skipped, one pre-existing failure in `tests/spec2-campaigns-and-rewards.test.ts:327`, invalid reward vocabulary |
| `pnpm lint`, `pnpm typecheck` | Passed; configured lint is the existing scoped RAG boundary check, not every repository file |
| `pnpm build` | Passed across all four applications |
| Current-corpus component replay | All fifteen ADMIN cases refreshed against final code passed their exact-answer/current-source or expected-gap checks, including explicit temporary-return usefulness assertion; additional STAFF history-dependent Tagalog wallet replay passed |
| Live admin browser | Return distinction and Tagalog lost-property guidance observed after repair; earlier failed wallet answer remained visibly historical in the same chat |
| Live staff browser | Normal user sign-in; online approval restricted to administrators and temporary-return rule observed; final mixed-topic sequence repeated ten times, 50 of 50 usefulness checks passed |

Final current-corpus replay cases: Wi-Fi, food-return with context, front-desk payment, English wallet with context, Tagalog wallet with context, fresh English wallet, first noise, noise follow-up, opening with context, lost laptop, online proof, lunch exit, refund amount gap, unpaid selection and handover. A Wi-Fi replay initially failed during development; its source digest matched the earlier successful MS-59 source. After the paraphrase/language-aware verification correction, the final Wi-Fi replay passed. The saved final set includes failures neither omitted from its development history nor misreported as unseen quality acceptance.

Run the candidate contract explicitly:

```powershell
pnpm test:ms60
pnpm test:ms60:python
node scripts/rag-natural-audit.cjs food_return_context --candidate --ms60
node scripts/rag-natural-audit.cjs payment_frontdesk --candidate --packing-control --ms60
node scripts/rag-natural-audit.cjs wallet_en_context --candidate --ms60
node scripts/rag-natural-audit.cjs wallet_tl_context --candidate --ms60
```

Raw/older probe modes intentionally retain the previous component path for diagnosis. `--ms60` admits the new condition-aware comparison and canonical cost check. The probe uses actual read-only authorized RPCs, model calls and final source/hash/actor checks but bypasses the browser/gateway wrapper. Its bounded semantic-aid union is not a separate browser benchmark or independent human semantic review. Passing general exact-provenance checks does not prove every answer is responsive; the temporary-return case has an additional explicit usefulness assertion.

Content-free final artifacts are in ignored `services/rag/benchmark-results/ms60/`. Code identity hashes bind local results to the relevant working-tree files. Component timings overlapped some tests/browser requests; no percentile or controlled concurrency acceptance is inferred from them. The local private API was restarted to load serving changes; existing limits/flags/publication were retained.

The local browser apps run in Next development mode; all four production builds were separately verified. Hardware identifies an AMD Ryzen 5 5600 and Radeon RX 6650 XT. The saved serving profile uses `qwen3:4b`, digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, GPU layers `-1`, and embedding fingerprint `e8a8211561f2eeee9504e69cb6927ece0cf628c8ad52eb8da07a417849d7e2fe`. Both portal configurations retain similarity `0.5`, hybrid disabled and their existing synthesis flag enabled. The audited legacy reviewed corpus contained 118 chunks at epoch 32; each component replay independently rereads current catalog/source/role state. Existing legacy search/expansion/read RPCs are exercised, with no installation of migration 024 implied. Budget version 1 retains twelve candidates, six sources, six quotes, 1,500 UTF-16 units per quote, 12,000 request bytes and 16,384 context tokens. Exact hashes and the allowlisted runtime/gateway settings are saved with the final artifacts. No production rollout or live rollback was attempted; compatibility and bounded failure behavior are covered locally.

## Explicit remaining gates

1. Ten full authenticated staff-gateway repetitions of the opening/noise/follow-up/Tagalog-wallet/English-wallet sequence passed. The complete fourteen-question sequence, all standalone controls and ten repetitions of every other intermittent sequence remain uncertified. This result does not substitute for those remaining milestone gates.
2. The inherited independently frozen MS-54/MS-59 labels, unseen multilingual conditional-intent set, human support/language/readability review and owner global refusal threshold are not fabricated from development cases.
3. Warm submit-to-complete-render p95 below five seconds for one/five users is not established. Current multi-stage local inference can exceed five seconds. Cold, contention and synchronized five-user acceptance profiles remain pending. No verifier, limit or role check was weakened to claim performance success.
4. Broad legacy source units, occasional equivalent FAQ/body selections and original-language fallback remain readability/language limitations. Full polished main-answer acceptance is separate from the delivered duplicate-navigation/code cleanup and exact safety behavior.
5. No new SQL is required by these request-local changes. Migration 024/reviewed successor publication and its production compatibility/RLS gates remain separate MS-59 work; no live installation is implied by local files.
6. The original audit panel-closure event has no proven historical cause. The demonstrated transient-poll defect is repaired and regression-tested; other remount/auth/timer paths remain covered by existing lifecycle tests and need full live repetition.
7. The unrelated campaign test still prevents a green complete repository suite. No campaign implementation was modified in this remediation.

## Compatibility and rollback

Deploy the compatible private service before the updated gateway. New inference projections require `ms60-v1`; old private clients retain the prior full-source contract and answering path. Old services safely reject unknown fields/operations instead of silently accepting weaker proof. Preview requires existing answer capability, and all final role, hash, source and epoch checks remain server-authoritative.

Rollback gateway/service coherently, preserving legacy evidence readers and no durable conversation state. Never restore a known unsafe accepted conditional answer as the success criterion; use independently safe exact support or a truthful scoped refusal. No database down migration or content resurrection is needed for this repair. Local implementation is delivered; production release and independent acceptance remain pending.
