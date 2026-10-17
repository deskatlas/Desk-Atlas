# MS-54 implementation and baseline handoff

Authority: MS54-TC01 through MS54-TC08; PRD-F26/F27; SDD-C20/C21; QAD-TC44/45/46. The October 15, 2026 implementation request supersedes the milestone's earlier documentation-only scope.

## Delivered

- Opt-in, authenticated, request-local diagnostics preserve precise retrieval, context selection, expansion, model and final grounding failure reasons. The diagnostic callback does not weaken exact-quote or final authorization checks.
- Ranked top-six chunk hashes and expanded closure hashes permit direct-support and dependency measurement independently. Counts include candidates, selection, closure/groups and serialized evidence bytes. Python supplies system-prompt/serialized-model bytes and context/output/template budgets; existing token and queue timing headers remain available. Size counters describe the last call, while existing timing/token counters aggregate calls. Missing counters are unknown, never zero measurements.
- Nine synthetic documents and 132 fixed cases, split equally into development and held-out partitions. Languages are English, Tagalog and Taglish. Cases cover descriptions, FAQs, tables, permissions, qualifications, recommendations, spelling variants, paired natural/heading questions, multi-passage procedures, separately located restrictions, continuations, long unrelated content, mixed tools, follow-ups, ambiguity, conflict, unsupported intent, injection and lifecycle safety.
- The dataset and both partitions have canonical SHA-256 locks. Labels were authored during implementation without model inference and require independent human review. They are candidate ground truth, not approved production policy. No held-out question was added to production shortcut grammars by MS-54.
- Fail-closed report evaluation retains every expected case in its denominator. Missing attempts are a separate outcome, not recorded as observed refusals. Recall is reported both per support unit (micro) and per question (macro), along with every-direct-unit and post-expansion coverage, language/type strata and sparse counts. Refusals, errors, timeouts and capacity rejections cannot improve accepted-answer latency.
- The probe reaches the actual authenticated application gateway. It uses existing sessions, never fabricates one, and performs no publication or mutation. Revocation/epoch/audience cases require separately established lifecycle conditions and are deliberately left missing by the serial probe.

## Reproducible commands

```powershell
pnpm test:ms54
pnpm test:ms54:python
pnpm rag:ms54:baseline inventory
```

The gateway regression minimizes a known seam: retrieve a direct answer, expand its required rule, return only the first exact quote, then observe `grounding:verification_failure:INCOMPLETE_COVERAGE`. Both natural and heading-specific questions exercise the same actor/corpus/configuration fixture. This reproduces a possible post-retrieval refusal mechanism, not the dominant live cause reported by the user. The original answer still contains no unverified citation. The diagnostic test goes red if that rejection loses its precise reason or leaks source content.

For a real baseline, use an already authorized current synthetic/anonymized publication, or a separately approved read-only private-corpus evaluation workflow. The shipped runner only submits frozen synthetic questions. Do not publish fixtures to satisfy this gate.

Prepare `bindings.json` as an object from dataset support-unit IDs to arrays of SHA-256 hashes of the corresponding current chunk UUID strings. Every chunk of a labeled support unit must be present to count that unit. Confirm source generation/fingerprint/epoch and current actor audience through authorized reads. Empty or incomplete bindings leave recall pending. Prepare `settings.json` using only the nonsecret keys allowed by `rag.identity.SETTINGS`, reflecting actual running configuration.

```powershell
pnpm rag:ms54:baseline freeze --bindings <bindings.json> --settings <settings.json> --publication-epoch <epoch> --role STAFF --app-mode production-build --out services/rag/benchmark-results/ms54-run.json
pnpm rag:ms54:baseline probe --run services/rag/benchmark-results/ms54-run.json --split development --out services/rag/benchmark-results/ms54-development.json
pnpm rag:ms54:baseline report --run services/rag/benchmark-results/ms54-run.json --records services/rag/benchmark-results/ms54-development.json --split development --out services/rag/benchmark-results/ms54-report.json
```

Configure `RAG_BENCHMARK_AUTHORIZATIONS` through the process environment as the existing JSON array of Bearer sessions. Configure `RAG_DIAGNOSTICS_ENABLED=true` only for the controlled gateway run. Neither setting is changed automatically. A missing authorized session fails the command with a content-free pending gate. `--split held_out` is explicit; freeze the candidate before held-out evaluation. Never tune against that partition. Reports reject changed code, settings, bindings or dataset identities.

Observation outcomes are provisional until an independent reviewer inspects the ephemeral answer, citations, language, conditions, procedure completeness and tool/filter behavior. Record only the closed boolean review object and a hashed reviewer identifier, never the answer itself. `--refusal-target <file>` accepts `maximum_rate`, `owner_approval_digest` and `baseline_digest`; leave absent until baseline review and explicit owner agreement. Do not invent an approval digest or target.

## Current evidence and unavailable gates

The pre-change local service health check reported ready/current; ports 3000, 3003, 8000 and 11434 were listening. No `RAG_BENCHMARK_AUTHORIZATIONS` session was configured. Later serving-code edits change the implementation fingerprint, so the earlier health result cannot certify this candidate. Local migration hashes are inventory only; installed SQL definitions and compatibility require a separate authorized database inspection.

Concurrent MS-55/MS-56 edits are present in this shared working tree. Freeze a fresh source snapshot after all coordinated changes settle. Historical twelve-candidate/12,000-byte observations in MS-54 are not assumed to be effective limits after those edits. MS-54 changes no budgets or similarity settings.

Live reproduction, corpus/publication identity, installed RPC definitions, independent label/answer review, owner refusal-target agreement and one/five-user render measurements remain pending. Use `ms53_acceptance.py` for independent submit-to-complete-render profiles: at least 30 representative warm attempts per language, a repeated-question profile, five controlled cold resets, twenty synchronized five-user batches and ingestion contention. Require warm p95 strictly below 5,000 ms; gateway times never certify that target. No current live cause is ranked without reproduction evidence, and MS-54 cannot certify MS-55 through MS-58.

## Verification

Local fixture success is tooling evidence only, not live acceptance.

| Command | Observed result |
|---|---|
| `pnpm test:ms54` | 11 passed, including paired post-retrieval rejection, exact upstream failures and final source-change rejection |
| `pnpm test:ms54:python` | 15 passed |
| `services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests/test_ms54.py services/rag/tests/test_assistant.py services/rag/tests/test_ms44.py -q` | 57 passed; one installed Starlette deprecation warning |
| `pnpm typecheck` | Passed across shared packages and four apps |
| `pnpm lint` | Passed; 24 Python boundary files and 23 TypeScript files |
| `pnpm test` | 2,134 passed, 3 skipped, 1 failed: `tests/spec2-campaigns-and-rewards.test.ts:327`, invalid reward vocabulary validation; outside MS-54 changes |
| `pnpm build` | Blocked by another Next.js build holding the kiosk build lock; the other process was not interrupted |
| `pnpm rag:ms54:baseline inventory --out services/rag/benchmark-results/ms54-inventory.json` | Completed; 12 logical CPUs, 34,281,177,088 physical-memory bytes, local listener/model/migration metadata; installed RPC and actual running limits remain explicitly pending |
| `pnpm rag:ms54:baseline probe` | Expected nonzero pending result: `AUTHORIZED_BENCHMARK_SESSION_PENDING`; no source was published or accessed through a fabricated session |

The saved inventory is a point-in-time artifact, not a frozen acceptance run. Source edits and concurrent changes after capture invalidate its candidate snapshot for benchmarking. The `docs` directory is already ignored by this repository; specification reconciliations are saved locally and no ignore/staging policy was changed.
