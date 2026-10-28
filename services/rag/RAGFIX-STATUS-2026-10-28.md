# RAG repair checkpoint: release gate failed

Latest continuation: [customer discovery/batching, measurements and remaining
quality gates](RAGFIX-CONTINUATION-2026-10-28.md). An ordinary customer account
question rendered within an observed 7,536 ms, but all-three-surface acceptance
remains unachieved. The fast booking sample conflicts with the application's
one-hour payment flow through its published 24-hour customer guide. The final
original-rule canary audited all 84 payment units and rejected every binding;
no new rule artifact served. The continuation adds no database or published-source
mutation and does not start the release chain. The checkpoint below is retained
as the preceding historical state.

October 28, 2026, Asia/Irkutsk. Branch `ragfix`. PRD-F26/F27, SDD-C20-C24, ERD-E24-E29 and QAD-TC44-TC46.

The requested complete, useful answer below ten seconds remains unachieved. No commit, remote push, branch merge, application deployment or production serving flag change has occurred. Five additive private derived-index migrations were applied through the maintainer's signed-in native Supabase browser. Published source text, booking data and inventory were not modified. Supabase migration-history reconciliation remains pending before any future CLI database push.

## Current evidence

The prepared corpus contains all 13 current internal documents under compiler fingerprint `ad9bed26a6c6f3f3bcbb20858d551c62473b8fda5ddd4285b3589f73fbed472a`. Six customer-only preparation jobs were cancelled by the internal audience boundary. A prepared map passing model checks does not establish a complete, fast answer.

The exact-original transport (`ragfix-prepared-v2`) fixes request-body capacity failures by dictionary-encoding canonical units, headings and source identities. Migration `202610280005` was tested and applied after migrations 001-004. Source versions, hashes, exact UTF-16 slices, original-unit completeness, actor/audience and catalog epoch remain checked before response release. These schema migrations must not be edited or reapplied blindly.

| Exposed regression variant | Complete response observations | Acceptance |
|---|---|---|
| Initial prepared v2 | First five replies reported supported at 38.4, 34.4, 37.0, 19.5 and 19.8 seconds | Latency failed; arrival conditions also failed review |
| Internal JSON-object transport | 17,419 / 9,993 / 14,580 ms for daily operations, payments, arrival | No useful supported answers; removed |
| Source-first draft plan | 17,469 / 8,440 / 11,564 ms | Two source-review failures and invalid arrival output; removed |
| Scope-first verifier | 12,164 / 7,972 / 8,031 ms | First two refused. Arrival marked supported but still demanded unconditional payment, so quality failed; reverted |
| Native browser, ordinary payment question | Source review needed, no useful answer | Failed. Screenshot `prepared-browser-payment-failure.png`; observation was too late to claim an exact elapsed time |

Artifacts are under `outputs/admin-rag-audit-2026-10-28/`. These are repeated, exposed regression questions. They are not unseen acceptance or cold-start measurements. Fast errors/refusals and an unsafe supported verdict never count toward the ten-second goal.

## Specific implementation problems still unresolved

1. Condition expansion operates at whole-workflow granularity. A required original condition causes its entire workflow and transitive dependencies to be admitted. Conservative DOCUMENT obligations can expand a source to all original units. Daily operations also selects numerous neighboring UI guides, producing about 79,000 aggregate input tokens across draft and verification. Merely reducing HTTP serialization does not remove this inference work.
2. Draft coverage and verifier coverage are unreliable. Some refusals demand a neighboring procedure or a rule already paraphrased. More seriously, both original and experimental verifiers can accept conditional payment collection phrased unconditionally. A model's positive verdict cannot be the release acceptance criterion. Changing verifier scope language made this false approval reproducible and was rejected.
3. Whole-document compact-guide audits are insufficient provenance. A model approved a guide omitting normal procedures. The experimental heading filter also incorrectly excluded atomic FAQ question-and-answer units starting with Markdown headings. That filter is fixed and regression-tested in the isolated experiment, but further per-workflow auditing still rejected the guide. No compact-guide artifact is eligible to serve.
4. Hosted inference varies materially. Even successful complete-document variants exceed ten seconds. Priority tier, model changes within the approved set, heading inheritance and object-output transport have not established the target. Cold-start and concurrent-load acceptance remain outstanding.

The next architecture seam is per-original-rule applicability and prerequisite binding, independently validated against the full source before serving. It must preserve exact original policy and bind decision-changing conditions to the actual answer claim, rather than trusting a workflow label or a broad positive completeness boolean. This is proposed next work, not an implemented or validated fix. No new model family is authorized.

## Changes retained in the candidate

The candidate retains opt-in guidance routing, operational wording fixes, source-bound preparation and exact-original transport, audience isolation, lease recovery, explicit bounded retries, final freshness checks, provider-neutral failure messages and failed-turn history. Startup embedding readiness retries one transient failure with a bounded delay; request-time embedding calls remain unchanged. Internal citation annotations are removed before independent verification, with a regression covering identical text in different documents and headings. Failed query/preparation prototypes are isolated under `services/rag/experiments/ragfix/`, outside API imports and deployment allowlists. Temporary DEBUG logs and the embedding probe were removed.

## Verification

Final typecheck and lint passed. All four production application builds passed. The final monorepo suite passed 2,738 tests with one expected failure and 43 skips across 297 passing and seven skipped files after the provider-neutral copy cleanup. See `final-checkpoint-typecheck.log`, `final-checkpoint-lint.log`, `final-checkpoint-tests.log` and `final-checkpoint-build.log` in the audit output directory. The final focused Python suite passes 117 cases after reverting rejected serving experiments. Earlier disposable PostgreSQL checks cover all five migrations, role/audience boundaries, source withdrawal, leases, stale artifacts, idempotence and rollback. They are not hosted production workload or pgvector performance acceptance.

Held-out natural browser questions, follow-ups, full useful-answer timing, role/lifecycle checks, cold starts and concurrent requests remain necessary after a future working candidate exists. The authorized push `ragfix`, merge/push `dev`, merge/push `main`, deploy chain remains conditional and has not started.
