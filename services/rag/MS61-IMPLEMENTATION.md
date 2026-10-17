# MS-61 current scope: multilingual input, concise English output

## Maintainer scope correction (October 17, 2026)

The maintainer clarified that Tagalog/Taglish output is not required. Understand Tagalog and Taglish questions and produce concise grounded English. This supersedes the translation-output objectives, bilingual-output review gate, reviewed-variant comparison and localized-success percentages in the historical record below. The previously prepared review package is diagnostic history; the user does not need to complete it for the corrected MS-61 scope.

The gateway now chooses an explicit English answer policy independently of detected input language. It uses English system copy and deterministic tool narratives and sends `language: en` to negotiated main projection/support for any input language. The original multilingual question and bounded intent context remain unchanged for planning, retrieval and verification. Thus Tagalog input no longer skips concise English synthesis. The private explicit non-English-output guard remains in place; English projection does not enable Tagalog translation. The legacy free-prose prompt requests English, and planner clarification instructions request English. Canonical proof, source/action validation, final role/epoch checks, contracts, dependencies and budgets remain unchanged.

`docs/milestone/ms61.md` version 2 is the current requirement. Local regressions cover English main-answer synthesis for Tagalog/Taglish input, the unchanged original question at planning/synthesis/support, English fallback/clarification copy, full English procedure actions and explicit private non-English output rejection. The earlier `rag:ms61:review` tool remains a historical translation experiment and is not current acceptance tooling. Current test commands remain `pnpm test:ms61` and `pnpm test:ms61:python`.

Current verification:

| Check | Result |
|---|---|
| `pnpm test:ms61` | 43 passed |
| `pnpm test:ms61:python` / isolated full Python suite | Current focused tests are included in 401 passed, 16 skipped in the full suite |
| `pnpm typecheck` / `pnpm lint` | Passed |
| `pnpm build` | All four application production builds passed |
| `pnpm test` | 2,238 passed, 14 skipped, the same preexisting campaign vocabulary failure at `tests/spec2-campaigns-and-rewards.test.ts:327` |
| Actual pinned local-model development probe | Four of four cases planned as DOCUMENT and returned canonical concise English main guidance, unchanged proof and positive support verdicts |

The development probe is `outputs/ms61-english-2026-10-17/probe.py`, with authorized synthetic material in `results-current-transport.json`. It exercises the actual pinned model through current Python planning, main projection and separate support functions. It includes fresh/mixed-topic Tagalog lost property, Taglish online-payment permission and uncertain-ownership release. The main answers preserve the supplied source restrictions and the original multilingual question. It does not run retrieval, normal gateway authentication or a browser. This is development component evidence, not independent held-out acceptance or complete-render timing. Its 6.1-7.0 second observed component times do not establish the inherited sub-five-second full-render target.

The initial probe used an eight-second HTTP transport timeout for planning as well as synthesis, which was stricter than the service's existing forty-five-second transport setting. Its first planning call failed; the other three cases completed. That initial result and script are preserved. The corrected probe uses the existing transport timeout and retains the unchanged eight-second combined main-synthesis/support ceiling; all four cases completed. No service ceiling was increased to obtain the result. Both runs are development samples, not a performance denominator or blind acceptance.

No service restart, production deployment or source publication was performed. English projection itself is already compatible with the existing private contract; a normal coordinated rollout must load changed service prompts before claiming current serving-code identity. Independent question-understanding/correctness, normal browser, complete-render performance and release acceptance remain MS-63 concerns; independent review of Tagalog/Taglish generated output is removed.

---

# Historical MS-61 version 1 record (superseded output requirement)

# MS-61 localization admission and independent review

Date: October 17, 2026, Asia/Irkutsk. Authority: the subsequent maintainer request to implement MS-61 supersedes its historical Markdown-only authoring restriction. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46, MS61-TC01 through MS61-TC08.

## Delivered behavior

The negotiated main-answer path continues to return verified original-language evidence and the existing source-language notice for Tagalog and Taglish. English wording that explicitly requests Tagalog, Filipino or Taglish now also takes this path. A later explicit English request is respected, and a negated language request is not treated as consent to that language. Language detection selects intent only; it proves no translation quality.

The pure domain admission function is used by the gateway. Private synthesis and support endpoints enforce the same closed non-English admission after capability authorization, before any generation or model support verdict. A client-supplied candidate or positive model flags cannot bypass this gate. Ordinary English and legacy contract behavior remain compatible. No new request field, output schema, activation flag, dependency, model, publication contract, migration or resource ceiling was introduced. The unchanged final source/epoch and role checks still apply.

## Diagnosis and selected strategy

The [recorded live remediation](CONVERSATION-REMEDIATION-2026-10-17.md) establishes two separate failures: generated storage/ownership/release instructions changed meaning, and the pinned model's support reviewer accepted that drift. Removing history did not establish reliable source-only translation. Mechanical proof/action mapping is useful integrity checking but cannot establish bilingual fidelity.

The selected production behavior is the existing safe fallback. The pinned request-time translation path has no independent evidence sufficient to reopen admission. Reviewed published variants are not available as an approved alternative in this implementation; adding persistent variants or changing publication semantics needs its own explicit architecture and migration decision. No translation dictionary or cache was introduced. This is a bounded safety and evaluation delivery; reliable localized main answers remain unresolved.

## Frozen evaluation material

`evaluation/ms61-localization.json` contains eight synthetic, unreviewed cases with a hash lock. Four development cases cover fresh/mixed-topic lost property, role authority, negation and conditional release. Four reserved cases cover no-hold, candidate priority, synthetic money/timing, complete procedure with equivalent FAQ, scope and exact UI labels. Adversarial candidates include fluent wrong instructions, omissions and invented questions. Meanings and negative labels are draft evaluation material, not approved facility rules or independent bilingual judgments. The money amount is explicitly fictional.

The reserved partition is not used to tune prompts or language rules. Regression tests read it only to exercise closed admission and report accounting. These agent-authored fixtures are not an independent unseen acceptance corpus. A bilingual reviewer must validate source meanings, negative labels and naturalness; MS-63 still requires independently prepared held-out material. Changing a fixture requires deliberate refreezing, never automatic lock refresh during evaluation.

Freeze a synthetic baseline without contacting a service:

```powershell
pnpm rag:ms61:review --freeze --split development --out services/rag/benchmark-results/ms61-development.json
```

The result contains the existing candidate identity (Git revision plus dirty source snapshot, model/parser/embedding/configuration/corpus/case hashes and run ID), the dataset digest and an empty record list. This is an offline synthetic baseline with synthesis disabled, not a live published-corpus or runtime-health assertion. Freeze before collecting candidates; any subsequent relevant code/model/configuration/fixture change invalidates CLI review. Output uses exclusive creation in the existing ignored metadata directory.

## Independent review protocol

1. Use only authorized synthetic evaluation material. Keep production transcripts, credentials and private source excerpts out of fixtures, records and reports. Review the visible main answer against the entire applicable canonical closure, including source hashes, offsets, scope, conditions and ordered actions. Hidden exact proof cannot compensate for missing main instructions.
2. Freeze each candidate's full review artifact before human inspection. Include visible main text, canonical evidence/provenance, closure and action mappings in that separately controlled artifact. `candidate_digest` identifies the exact candidate; `artifact_digest` identifies the complete material the reviewer inspected. Never join a review to another candidate, source fixture or run. Reviewer identity is represented only by a digest.
3. A qualified bilingual human, independent of the generator and model support reviewer, supplies one fidelity boolean per draft source meaning, one rejection result per adversarial candidate, safety/directness/naturalness and fixed failure categories. Validate the draft meanings independently first. Do not treat a second invocation of the same model, citations, native-word regex or schema validity as human review. Attestation provenance and reviewer qualifications require human governance; parsing the record cannot prove them.
4. Enter only metadata into the frozen bundle's `records`. A row has exactly `id`, `fixture_digest`, `candidate_digest`, `outcome`, `retrieval_ok`, `model_supported`, `review`. Outcomes are `LOCALIZED`, `EXACT_FALLBACK`, `REJECTED`, `TIMEOUT`, `UNAVAILABLE`. Do not invent a candidate/review for an unattempted case; missing cases stay in the denominator.
5. A non-null review has exactly `kind: independent_bilingual_human`, `reviewer_digest`, `artifact_digest`, `identity_digest`, `fixture_digest`, `candidate_digest`, `meanings` (booleans in source-meaning order), `failures`, `safe`, `direct`, `natural`, `negative_rejected` (booleans in negative-fixture order). Digests use the existing canonical SHA-256 helper. Failure categories are storage, ownership, release, role, negation, condition, amount, timing, order, omission, ui_label and wrong_task. A null review remains unreviewed regardless of model support.
6. Report with `pnpm rag:ms61:review --bundle services/rag/benchmark-results/ms61-development.json --out services/rag/benchmark-results/ms61-development-report.json`. The report emits per-language fixed denominators, missing/unreviewed cases, retrieval success, localized success, safe fallback, dangerous emitted answers, verifier false acceptance, negative acceptance and failure categories. Missing and failed cases cannot disappear from the localization rate. Safe English fallback never counts as localized success. The CLI exits nonzero while acceptance remains pending.

This evaluator cannot enable translation. Even perfect supplied review metadata leaves fixture-meaning review, the published-variant comparison and MS-63 integrated acceptance explicit. Per-language 90% localized acceptance and zero dangerous/negative/false-accepted fidelity cases are reported as unmet when applicable. Recall, refusal thresholds, live authorization, sample independence, full-render percentiles and capacity remain MS-54/58/63 gates; this supplemental tool does not replace them.

## Verification and rollback

| Check | Local result |
|---|---|
| `pnpm test:ms61` | 39 passed |
| `pnpm test:ms61:python` | 18 passed, including final CLI identity regression |
| Full isolated Python suite | 397 passed, 16 skipped; run before the final added CLI regression, which then passed in the focused suite |
| `pnpm typecheck` | Passed across the workspace |
| `pnpm lint` | Passed; repeated after evaluator changes, including its Python AST lint |
| `pnpm test` | 2,234 passed, 14 skipped, one preexisting unrelated campaign vocabulary failure at `tests/spec2-campaigns-and-rewards.test.ts:327` (SPEC2-TC05) |
| `pnpm build` | Passed all four Next.js application production builds |
| Offline CLI freeze/review smoke | Freeze succeeded; empty-review report returned pending with exit 1 and translation disabled, as required |
| `git diff --check` | Passed; existing line-ending conversion notices only |

The content-free synthetic baseline and pending report are in the existing ignored `benchmark-results/ms61-2026-10-17-baseline.json` and `benchmark-results/ms61-2026-10-17-pending.json`. Neither contains generated candidates or human review, and neither claims bilingual quality or live performance. The passing CLI smoke checks missing-review behavior only.

The tests establish mechanical rejection, exact fallback, compatibility and accounting. They are not semantic translation acceptance. MS61-TC01/02/04/07 localized quality and MS61-TC08 one/five-user complete-render performance remain pending independent/live evaluation. No service restart, source processing, source publication or deployment was performed. Rollback preserves the already closed gate; disabling existing synthesis restores exact behavior, and the preexisting off-mode/deadline/source-withdrawal/role-revocation tests remain in the focused gateway suite.
