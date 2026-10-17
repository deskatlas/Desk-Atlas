# MS-58 implementation and controlled release preparation

Authority: the user request to implement `docs/milestone/ms58.md` and subsequent confirmation that MS-57 is complete supersede the planning baseline's Markdown-only authoring scope. Trace: BRD-M5/M6, PRD-F26/F27, SDD-C20 through C24, DSD-UI16/UI17, ERD-E24 through E29, QAD-TC44/45/46, MS58-TC01 through TC13.

## Delivered behavior

Both portals retain the shared accepted MS-57 answer contract. Consecutive generated steps and bullets form semantic lists. The existing inert formatter handles structural Markdown escapes and emphasis without creating executable HTML or links. Literal examples, amounts, conditions, negation and unchanged canonical evidence remain intact. Generated blocks are labeled evidence-based summaries; exact supporting evidence remains separately disclosed with original offsets. Explicit nonaccepted synthesis statuses cannot carry generated blocks. No rejected candidate or streamed unverified content is presented.

The gateway adds an optional typed presentation outcome after final actor, source and catalog checks, preserving older callers. Supported, safe partial, clarification, insufficient evidence, conflict, source review, evidence limit, service failure and scope outcomes stay distinct. Existing limitations retain verified gaps and diagnostics. Independently verified operational tables remain visible when document answering fails. Ordinary search gaps do not automatically direct users to administrators; structure and policy conflicts retain selective review guidance. Transport failures suggest retry rather than document reprocessing. No administrator contact occurs.

Compact source buttons retain accessible names, page attribution and heading details. Permission-checked exact excerpts receive focus when opened; dismissal returns focus to the originating citation. Source unavailability has a separate notice rather than an answer retry action. Dismissing a pending source request aborts it and prevents a late response from reopening its content. Existing close/cancel/reopen, identity changes, catalog refresh, request deadlines and ephemeral transcripts retain their safeguards. The staff adapter imports the same launcher and panel.

## Candidate acceptance tooling

`pnpm rag:ms58:acceptance --bundle <bundle.json> --out services/rag/benchmark-results/<unique-report.json>` recomputes the frozen MS-54 held-out quality report and MS-53 complete-render profiles. It checks the bundle against the current code snapshot, revision, model/parser/embedding manifests, corpus bindings and frozen nonsecret configuration. It writes only to the existing ignored artifact directory without overwriting an earlier report. It performs no network request, source publication, configuration change or activation.

| Bundle field | Required content |
|---|---|
| `identity` | Existing MS-54 frozen identity, including source snapshot, model, parser, corpus and configuration digests |
| `bindings` | Frozen synthetic support units mapped to hashed current immutable publication chunks |
| `records` | Existing strict MS-54 held-out gateway records, independent reviewer rubric and synthesis status |
| `settings` | Existing allowlisted nonsecret frozen settings, including synthesis mode |
| `measurements` | Existing strict MS-53 submit-to-complete-render records with matching identity |
| `attestations` | Unique allowlisted gate, PASS/FAIL/PENDING status, identity digest and separately reviewed artifact digest |
| `refusal_target` | MS-54 owner-approved maximum rate with baseline and approval digests, fixed before tuning |

Attestations refer to separately inspected evidence; they do not mechanically prove source authenticity, human review or arbitrary semantic truth. Unknown fields, chats, excerpts, notes, mixed identities and duplicate attestations are rejected. Records and measurements retain their existing strict allowlists. Output includes only constructed numeric metrics, fixed case IDs, hashed identity and evidence references. Reviewers inspect actual answers privately and record their decisions without storing transcripts in these reports.

The ledger requires independent MS-54 baseline, MS-55 retrieval, MS-56 closure and MS-57 synthesis evidence; semantic/translation review; source lifecycle; real parser/publication integration; both-portal accessibility; session/privacy; mode/restart/rollback; live reproduction; hardware/resource evidence; and separate long-report and oversized-evidence profiles. Missing or failed entries remain pending. Numerical quality failures cannot be overridden by PASS attestations. Known unsafe or policy-conflicting accepted guidance blocks readiness independently of aggregate acceptance. Accepted synthesis and exact fallback are reported separately overall, by language and by document type.

Performance retains separate representative, repeated, five-user, cold and ingestion profiles, all attempted outcomes, queue measurements and nearest-rank percentiles. Representative and repeated profiles require 30 attempts per language; five-user and ingestion profiles require 20 five-actor batches; cold profiles require five distinct resets. The complete useful-answer warm p95 target remains strictly below 5,000 ms. Separate referenced artifacts must establish synchronization, generation/verification/final-read/transport/render costs, hardware/resource peaks, cold behavior and long/oversized profiles. The evaluator does not reinterpret model-only, refusal or loading latency as full-render success.

`evaluation_ready` describes whether supplied candidate-bound checks are complete. `release_ready` always remains false and activation always requires separate maintainer authorization. Missing independent label approval in the frozen MS-54 dataset is retained, not silently changed. An empty or unavailable live run cannot produce a passing release record.

## Verification

The focused final TypeScript run passed 73 tests across MS-58 presentation, MS-57 synthesis/gateway, MS-56 evidence, MS-53 presentation and launcher lifecycle suites. The Python run passed 69 tests across MS-58, MS-57, MS-54 and MS-53 metrics, with one existing Starlette/AnyIO deprecation warning. Synthetic and mocked tests establish contract, presentation and orchestration behavior, not model factual quality or live acceptance.

The full repository run passed 241 files and 2,185 tests, skipped one file and three tests, and failed the previously documented unrelated `SPEC2-TC05` reward vocabulary rejection assertion. It preceded the final literal-label regression, which passed in the final focused suite. Full-suite success is not claimed. Logs remain under `node_modules/.cache/ms58-final-test.log`.

All four production builds passed. Typecheck and boundary lint passed; the final build/typecheck/lint sequence runs sequentially because a concurrent build can temporarily replace generated Next.js type files. No source workaround or configuration relaxation was introduced for that transient race. Final command logs are `node_modules/.cache/ms58-verified-build.log`, `ms58-verified-typecheck.log` and `ms58-verified-lint.log` in the same directory.

The content-free local inventory is saved in the ignored `services/rag/benchmark-results/ms58-final-inventory.json`. Candidate HEAD: `c7aecd83abd3d2bccee297ec9f4d8478e13e7eac`; workspace source snapshot: `2e53a467a881c6ec03561ce151332ddfaa823eec1ca142c357cf5c004dbdf366`; frozen dataset digest: `50f6e8d1815467b6b7a173193112ae68f7e982f7495797918864c8f4fcb9cdfd`. The host reports 12 logical CPUs and 34,281,177,088 physical-memory bytes. This identifies local artifacts and hardware only. Actual loaded serving identity, installed RPC definitions, current permitted publication manifests and a fully frozen live run remain unverified; the inventory explicitly reports release readiness false.

Browser QA used the synthetic `tests/fixtures/ms58-assistant-browser.tsx` temporarily mounted in both actual portal layouts. Staff/admin answer text matched. Checks covered 320-pixel narrow layouts in both portals, 390-pixel staff and 1,440-pixel staff/admin layouts without document horizontal overflow, ordered-list accessibility semantics, current font delivery, source focus and return, Escape close/focus restoration, exact evidence separation and an unavailable-source notice. Temporary routes and browser viewport overrides were removed. No fixture is shipped as a public route. These checks are synthetic development QA and do not certify real authenticated publication races, every supported browser/screen reader or full-path latency.

## Outstanding acceptance and release controls

| Gate | Candidate status |
|---|---|
| Local contracts, shared rendering and deterministic lifecycle regressions | Delivered and locally verified |
| MS-54 independent held-out labels, owner refusal threshold and live reproduction | Pending; frozen files preserved |
| MS-55 independent retrieval improvement and 95% recall@6 | Pending live evaluation |
| MS-56 complete applicable closure and MS-57 multilingual semantic quality | Pending independent current-corpus review |
| At least 90% reviewer acceptance and mandatory safety/source-race acceptance | Pending |
| Real supported-format parsing through upload, review, publication and answering | Pending current-candidate integration evidence; no sources automatically published |
| Production-build one/five-user warm p95 below five seconds | Pending; no substitute first-token or synthetic latency claim |
| Cold, ingestion contention, long report, oversized evidence and resource profiles | Pending |
| Live flag-off/on restart compatibility and operator rollback acceptance | Pending controlled environment evidence |
| Production activation/deployment | Not performed; separate maintainer authorization required |

Before a future release, collect a fresh matching frozen candidate and current corpus, inspect every referenced artifact, resolve the remaining gates, and obtain authorization for the concrete release candidate. Default-off synthesis remains unchanged. Disabling `RAG_SYNTHESIS_ENABLED` and restarting gateways prevents new admissions; in-flight admitted requests retain their frozen mode and final checks. Exact retrieval, source revocation and read-only tools remain required through rollback. MS-58 adds no SQL migration, dependency or model/runtime replacement. Any rollback involving earlier migrations still requires the existing isolated compatibility and reversible-migration evidence; withdrawn sources must never be restored to visibility.
