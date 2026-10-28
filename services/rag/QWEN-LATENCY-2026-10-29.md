# Qwen answering pipeline candidate

Date: October 29, 2026, Asia/Irkutsk.

Authority: maintainer request to retain Qwen while targeting complete useful
answers within 10-15 seconds, preferably below 10 seconds. Traceability:
PRD-F26/F27, SDD-C20-C24 and QAD-TC44-TC46.

## Latest matching-build sequential results

The implementation retains only the three already-approved Qwen models.
The normal customer discovery planner uses Qwen3-32B; larger internal catalog
selection, document drafting and independent verification use Qwen3.6-35B-A3B.
All run on the standard provider tier, with reasoning disabled and no fallback.
The 235B model remains selectable through the existing explicit roles.

| Surface and question | Complete HTTP time | Observed result |
|---|---:|---|
| Customer: online booking | 12,607 ms | Useful, cited; under 15 seconds |
| Customer: account requirement follow-up | 8,656 ms | Useful, cited; under 10 seconds |
| Customer: payment-proof deadline follow-up | 13,655 ms | Useful, cited; under 15 seconds |
| Admin: payment-review checks | 9,675 ms | Supported, synthesized; under 10 seconds |
| STAFF: already-paid guest arrival checks | 10,190 ms | Supported, synthesized; under 15 seconds |
| Customer: whether a queue number secures inventory | 12,705 ms | Useful, cited; under 15 seconds |
| Customer: first booking without Customer ID | 20,405 ms | Useful, cited; latency target failed |

These were sequential local warm runs against matching production-mode builds,
not simultaneous probes. All seven returned cited useful answers; six met
15 seconds and two met 10 seconds. The final Customer ID outlier spent 15,855 ms
inside catalog discovery. Consistent under-15-second delivery is NOT established.
No p95, production SLA, cold-start/browser or sustained-load acceptance is claimed.
Final rows are `release-customer-http.jsonl`, `release-additional-http.jsonl`,
`release-admin-http.jsonl` and `release-staff-http.jsonl` in the output directory.
Public session bootstrap was separately 49-232 ms; browser rendering is excluded.

The earlier faster customer five-case sample below remains historical evidence,
not the final distribution. Concurrent intermediate probes also reached 21,881 ms
for a customer booking answer, and internal iterations produced source-review
refusals and an irrelevant arrival/departure answer despite a model SUPPORTED
verdict. Those failures are retained and cannot be counted as useful fast answers.
The broader final STAFF answer addresses arrival and active-window check-in;
the earlier irrelevant departure answer is not acceptance evidence.

## Final implementation

- One approved Qwen planner/answer model pair, with explicit model-specific
  context bounds, pinned tokenizer checks and startup canaries. Larger internal
  catalogs may explicitly use the already-verified document role; an unverified
  third inference role is rejected.
- One catalog-discovery round replaces separate query planning, embedding and
  source-selection calls for admitted policy tasks. The authenticated gateway
  passes its existing read-only classification as `document_task`; its catalog
  schema then permits DOCUMENT only, so it cannot redundantly DEFER a known
  procedure to the planner/embedding path. The existing mixed/record/report
  exclusions remain, including the added staff/employee wording tests. An
  incompatible DEFER response for a known document task fails closed.
- Compact, stable discovery schemas preserve all source addresses, dependency
  quotations, preferences and intent fields. Redundant references to an already
  selected complete primary are normalized without dropping original coverage.
  Other malformed discovery output may retry once; permission, budget and
  provider failures do not retry.
- Customer drafts use compact stable output and are rebound to the actual
  canonical source-address bounds before verification. Internal drafts retain
  the original source-specific bounds and enable the existing task/participant
  framing to avoid confusing arrival with adjacent departure procedures.
- An omitted no-hold rule for a general customer booking flow can be completed
  from an exact original canonical unit, after composition and before independent
  verification. It invents no missing policy, adds no model call, and remains
  subject to answer/proof budgets and verifier rejection.
- Every inspected original, mapped claim, principal, source hash and final epoch
  remains checked. Public quotas, cancellation and role boundaries are retained.
  No stored transcript/answer cache, third-party dependency, migration or source
  publication was introduced.

The implementation improves the common path and fixes reproduced routing and
structured-output failures. It does not guarantee the requested latency across
all cases or provider load conditions. Priority pricing is not enabled as a
workaround. Hosted deployment and performance acceptance remain separate.

## Approved-model continuation (current candidate)

The maintainer chose to retain the existing approved Qwen models. No smaller
model or provider was added. The current preview defaults to Qwen3-32B for
customer planning/discovery and Qwen3.6-35B-A3B for larger internal discovery,
full-original drafting and independent verification, on standard pricing. The 235B model remains explicitly selectable.

A reproduced scope bug made catalog discovery use the document model whenever
its larger context was enabled. Planning endpoints now bind both the actual
planner model and that model's own context/tokenizer bounds. Context is restored
on success and failure; hosted startup checks the required tokenizer.

Compact catalog output retains every intent, preference and explicit-reference
field. It restores the canonical schema before admission. A dependency on an
already-selected complete primary is redundant: normalizing it preserves all
original coverage. This fixed the reproduced deadline failure, where Qwen
repeatedly returned document 5 as both the primary and its own missing dependency.
No extra model request is needed for that normalization. Other malformed output
may retry once with the SAME authorized catalog. Permission, provider and budget
failures do not retry; two invalid outputs still fail closed.

For a general customer booking flow, an omitted no-hold statement is completed
from an exact original canonical unit before final independent verification.
No absent rule is invented, and rejection, output budgets and final source/epoch
checks remain effective. This adds no generation call. It runs after any
partition composition, so composition cannot silently discard the boundary.

The corrected normal public HTTP campaign returned:

| Customer question | Complete HTTP time | Result |
|---|---:|---|
| Online booking | 9,031 ms | Useful, cited; under 10 seconds |
| Account requirement follow-up | 7,434 ms | Useful, cited; under 10 seconds |
| Payment deadline follow-up | 8,655 ms | Useful, cited; under 10 seconds |
| Whether a queue number secures inventory | 9,400 ms | Useful, cited; under 10 seconds |
| First booking without a Unique Customer ID | 11,616 ms | Useful, cited; under 15 seconds |

Session bootstrap was separately 45-47 ms. These five exposed smoke questions
all met 15 seconds and four met 10 seconds. This is a small local observation,
not a p95, cold-start/load/browser acceptance campaign or production guarantee.
Use `approved-qwen-repaired-http.jsonl` and
`approved-qwen-additional-http.jsonl` for these rows. Earlier failed reports are
retained. Two earlier account/no-hold checks were false negatives caused by
narrow regex wording; the current checks accept the supported paraphrases without
removing the no-hold, deadline or administrator-review checks.

Internal role probes also exposed general procedure requests deferring to a
second planner and embedding search. The final implementation reuses the gateway's existing read-only classification
through the compatible document_task contract. Actual record lookups, reports
and action requests retain their existing planner boundaries.

## Initial implementation and retained mechanisms

- The initial standard-tier Qwen-only preview selected Qwen3.6-35B-A3B for both
  discovery and answering. It enables the existing one-pass authorized catalog
  discovery and full-original batched support paths, avoiding the sequential
  embedding/selection round trip for admitted knowledge requests. There is no
  Gemini fallback or priority-tier default.
- Compact provisional answers use `s,b,t,p` instead of repeating presentation
  fields. The server restores the canonical answer shape and validates the
  actual source-address bounds before independent verification. Stable customer wire schemas avoid document-size-specific output grammars;
  internal drafts retain source-specific bounds. A provider compilation speedup
  has not been established by these samples.
- Every original source partition and mapped claim still receives independent
  relevance, support, completeness, consistency and safety review. Source hashes,
  final authorization, epoch checks, cancellation and public quotas remain.
- Payment guidance must retain the documented reviewer role alongside review,
  as well as the explicit no-hold boundary when supported by the originals.
- Runtime fingerprint parity includes the new transport module in Python and
  the Node status checker. Actual compact prompt/schema bytes count toward the
  existing aggregate work budget. Invalid compact addresses fail closed before
  verification.
- A normal public HTTP smoke runner uses one session and real quotas, checks
  content and citations, and counts timeouts/refusals/quality failures against
  latency acceptance. Its optional loopback ingress overwrites the trusted IP
  header from the actual socket; it never invents IPs or clears quota records.

## Earlier all-3.6 measurements and limitations

All HTTP rows below include retrieval, model work and final gateway checks.
They exclude the separately reported session bootstrap and browser rendering.
These exposed regression samples are not independent quality acceptance, a p95,
a hosted-load measurement or an SLA.

| Local candidate | Question | Complete HTTP time | Result |
|---|---|---:|---|
| Initial compact Qwen3.6 | Online booking | 15,320 ms | CLARIFY; failed usefulness |
| Initial compact Qwen3.6 | Account requirement follow-up | 14,265 ms | Cited useful answer |
| Initial compact Qwen3.6 | Proof deadline follow-up | 10,765 ms | Cited useful answer |
| Booking repeat | Online booking | 14,974 ms | Cited answer; failed explicit reviewer-role check |
| Stable schema and reviewer-role prompt | Online booking | 18,357 ms | Cited useful answer; latency failed |
| Stable schema and reviewer-role prompt | Account requirement follow-up | 15,910 ms | Cited useful answer; latency failed |
| Stable schema and reviewer-role prompt | Proof deadline follow-up | 11,614 ms | Cited useful answer |

The earlier all-3.6 three-question HTTP run passed usefulness smoke checks for all three,
but only one met 15 seconds. No HTTP sample in that earlier run met 10 seconds. That initial candidate
must not be represented as achieving the requested latency across questions.

Component probes are separate: fresh-source Qwen3.6 baseline support took
10,652 ms; indexed-only support took 11,098 ms; compact standard took 18,556 ms;
compact priority took 10,159 ms. These were changing candidate samples, not a
controlled proof that compact output improves latency. Compact output used
202-203 generated draft tokens compared with 258 in the fresh-source baseline,
but answer wording also varied. Priority has a surcharge and remains disabled.
Qwen3-235B compact support took 24,822 ms and Qwen3-32B took 13,136 ms, with
zero reported reasoning tokens. Neither component result establishes complete
HTTP acceptance for that model.

The shared-source-prefix experiment took 19,396 ms, reported zero cached tokens
and omitted explicit no-hold wording. Its serving changes were removed. The
lossless indexed-source experiment remains optional and disabled in the preview;
it showed no useful improvement on the single-guide probe. Old cached-source
probes are not current-source quality evidence. Two early 235B diagnostics lost
their reports when optional usage details were null; the reporter was corrected
and only the subsequent complete report is used above.

Raw reports: `outputs/qwen-latency-2026-10-29/`. Diagnostic-only reports contain
generated answers and private local trace paths, but no credentials. Keep them
out of deploy artifacts. No source publication, database migration, hosted model
configuration or production routing was changed.

## Reproduction

Use separate terminals from the repository root:

```powershell
node scripts/rag-qwen-preview.cjs api
node scripts/rag-qwen-preview.cjs customer-production
```

The API uses loopback port 8014; the customer application uses 3011. Production
preview requires the successful existing application build. Wait for the API
startup canaries to finish before testing; a listening protected `/health`
returns 401 without credentials. Run:

```powershell
node scripts/rag-qwen-latency.cjs http://127.0.0.1:3011 --production-proxy
```

Use `--booking-only` for one request. Do not rerun through public quotas, change
identity to bypass a limit, or count a rejected admission as a fast answer.
Admin/staff previews use `node scripts/rag-qwen-preview.cjs admin` or `staff`.
Role probes are separate from the five customer questions above.

## Verification

- `pnpm typecheck`: passed across the monorepo.
- `pnpm lint`: passed, including the final 47 Python serving files.
- `pnpm test`: 2,771 passed, one expected failure, 43 skips.
- `pnpm build`: passed for all four applications.
- Focused Python serving/security/identity suites: 190 passed.
- `git diff --check` and new CLI syntax checks passed.

The final typecheck, lint, test and four-application build commands were repeated
after the domain/gateway classification contract changes. Existing
uncommitted customer-context work was preserved.

## Model boundary and rollout

The maintainer explicitly selected keeping the current approved Qwen models.
The preview rejects model IDs outside the existing three-model allowlist. No
smaller-model benchmark is pending and no Gemini fallback or priority surcharge
is enabled. Primary-source guidance remains in
[the research note](QWEN-LATENCY-RESEARCH-2026-10-29.md).

No hosted service, production model/flags, scaling settings, source publication
or database migration was changed. Deploy the compatible API reader before enabling the matching gateway flags.
Older API readers reject the new trusted classification field safely. Roll back
the gateway/flag first if reverting to an older reader. Before hosted adoption, test the deployed
runtime's cold starts, concurrency and source freshness; the previously observed
single-request Cloud Run concurrency/minimum-zero configuration can still queue
requests or add startup latency independently of the local pipeline.
