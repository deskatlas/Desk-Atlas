# Admin conversational RAG repair and latency measurements

Date: October 29, 2026, Asia/Irkutsk. Authority: maintainer requested repair after
the browser audit and a 10-15 second answer target, preferably below 10 seconds.
Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16 and QAD-TC44/46.
Original observations: [admin browser audit](../../docs/audits/admin-rag-broad-2026-10-29.md).

## Delivered locally

- Current-day status and multi-metric snapshot questions use the existing
  authorized read-only tool without model planning or document retrieval.
  Named historical periods, other metrics, filters and mixed advice still defer.
  Broad status answers explicitly exclude payment-review and maintenance issues
  from the snapshot's scope; zero bookings does not imply no operational issues.
- Redundant `today` plus explicit current-business-day dates normalize before
  tool authorization. Conflicting dates remain rejected.
- Subject-free troubleshooting asks one focused question. An unconfirmed-payment
  incident without a channel asks whether payment was online or at the counter.
  Both questions satisfy the actual response schema and avoid inference.
- A model-generated QR distinction cannot replace original QR roles or scan
  permissions. QR claims use mapped canonical wording before independent review.
  Adjacent but unsuitable citations recover exact QR rules only from the same
  already-authorized selected originals. The gateway independently rejects a
  synthesized QR claim that does not retain its mapped exact wording.
- Draft labels cannot turn an ordinary task into a whole-document request.
  Overview completeness distinguishes an orientation from every detailed task.
  When a safe, supported overview cannot be verified complete, the assistant
  asks which part to focus on instead of claiming the source needs repair.
  Unsafe, unsupported and conflicting drafts cannot use this clarification path.
- Internal verification returns bounded omission addresses and reason enums.
  At most two repairs can add exact original rules and their section context.
  Large sections fall back to the specifically flagged originals. Every repaired
  candidate is checked again against every original partition. Call, serialized
  input, output, proof-count and deadline limits remain enforced.
- Recovery restores canonical span order, remaps all support indexes, removes
  uncited proof and measures the actual evidence wire representation. Earlier
  paragraphs appended during recovery previously caused gateway rejection.
- Generated section markers are removed before verification. Exact source text
  and offsets remain unchanged. Generic invalid-response copy no longer calls
  every planner or service schema failure an incomplete selection.

No dependency, database migration, published source, credential, production
configuration or deployment was changed. Authentication, role, source hash,
epoch, final actor and complete-original checks remain in place. No answer cache
was introduced.

## Latency candidate

The measured local service uses Qwen/Qwen3.6-35B-A3B for planning and document
work on the existing standard DeepInfra tier, with reasoning disabled. Set the
existing controls `RAG_TASK_FRAMED_DRAFT=false` and
`RAG_QWEN_INDEXED_SOURCES=true`. Keep compact catalog/draft transport and internal
catalog discovery enabled as in the existing Qwen preview profile. The preview
script now permits explicit overrides of the two controls. Their normal defaults
are preserved, so this document does not silently activate a production profile.

Indexed source transport retains every original unit, exact heading and duplicate
occurrence. Compact output still restores and validates actual source bounds.
A final trusted drafting instruction follows the long untrusted original packet
to reduce repetitive answers. No original text is truncated to meet latency.
Successful ordinary answers retain drafting plus independent verification;
omission recovery adds bounded verifier work only when needed.

Run the local API with `node scripts/rag-qwen-preview.cjs api` and the local app
with `node scripts/rag-qwen-preview.cjs admin`, supplying the controls above and
matching `RAG_PREVIEW_API_PORT=8016` in both processes. For this measurement both
also explicitly selected `RAG_ANSWER_MODEL=Qwen/Qwen3.6-35B-A3B`.
Existing environment credentials stay in process memory.

### Final matching-service follow-up samples

These are sequential local complete-HTTP measurements through the real admin
gateway, current published sources and an active role. They are not first-token
times, independent held-out acceptance, a production p95 or cold/load guarantees.

| Question | Result | Complete HTTP time |
|---|---|---:|
| Hey, I'm managing the place today. What should I focus on? | Focus clarification after incomplete overview verification | 5,778 ms |
| Can you give me the big picture of how bookings, payments, and check-ins fit together? | Useful cited answer with original QR controls | 8,652 ms |
| May nagrereklamo sa wifi at ang ingay daw. Paano ko sila tutulungan? | Useful cited English answer | 6,217 ms |
| They paid online. How do I review that payment? | Useful cited answer | 6,476 ms |
| I'm about to hand over my shift. What should I tell the next person? | Useful cited answer | 5,207 ms |

All four substantive answers in this final small sample completed below ten
seconds. The orientation clarification is separate from useful-answer coverage.
Earlier runs included a 20,564 ms broad workflow answer and initial samples of
24-46 seconds. Provider latency and model decisions vary, so consistent under-15
delivery is not established. All earlier failures and outliers remain retained;
the final sample does not erase them. Recovery may include longer exact source
context in the visible answer, as shown by the payment browser check.

The full earlier nine-case run is in `final-verification.jsonl`. It exposed one
remaining payment recovery budget failure. After correcting evidence-wire budget
accounting and adding regression coverage, the final five-case follow-up above
and the natural browser payment conversation succeeded. This is not a claim that
all nine cases were rerun together on the final service.

### Browser verification

The maintainer signed in to the local preview. Normal chat UI submissions showed:

- Troubleshooting clarification: 979 ms to visible text.
- Multi-metric current snapshot: 1,300 ms to the visible table.
- Payment-channel clarification: 856 ms to visible text.
- Natural online-payment follow-up: a substantive cited review answer, retaining
  the conversation. Its exact complete-render latency was not instrumented.

The browser checks confirm the UI path separately from HTTP timing. Some checks
preceded the final source-recovery refinement; the final browser payment answer
used the final service. The preview was left open for inspection.

## Validation

- `pnpm typecheck`: passed.
- `pnpm lint`: passed; no RAG boundary violations.
- `pnpm test`: 301 suites passed, 2,807 tests passed, one existing expected failure,
  seven skipped suites and 43 skipped tests.
- `pnpm build`: all four applications passed.
- Full Python suite: 856 passed, 16 skipped; existing dependency deprecation warning.
- `python scripts/admin-rag-broad-routing-repro.py`: now passes both routing cases.
- `git diff --check`: passed.

New regressions cover normal-language routing, mixed-intent deferral, conflicting
dates, schema-valid clarifications, a positive model verdict on a wrong QR claim,
QR evidence recovery, unsafe-draft rejection, bounded omission repair, overview
scope, canonical source ordering and evidence-budget accounting. Two existing
preparation tests now explicitly set the answering model needed by their hosted
fixture; they no longer depend on the surrounding test process's model setting.
An earlier full run overlapped edits and is retained separately; final results
above come from the subsequent stable run.

## Evidence

All links below are local artifacts under `outputs/admin-rag-broad-audit-2026-10-29/`:

- [Final substantive HTTP samples](../../outputs/admin-rag-broad-audit-2026-10-29/release-candidate-http.jsonl).
- [Earlier full run and remaining failure](../../outputs/admin-rag-broad-audit-2026-10-29/final-verification.jsonl).
- [Original slow repair campaign](../../outputs/admin-rag-broad-audit-2026-10-29/repair-http.jsonl).
- [Browser verification record](../../outputs/admin-rag-broad-audit-2026-10-29/repaired-browser.json).
- [Payment clarification and answer screenshot](../../outputs/admin-rag-broad-audit-2026-10-29/repaired-payment-browser.jpg).
- [TypeScript suite](../../outputs/admin-rag-broad-audit-2026-10-29/tests-verified.log).
- [Python suite](../../outputs/admin-rag-broad-audit-2026-10-29/python-verified.log).
- [Production build](../../outputs/admin-rag-broad-audit-2026-10-29/build.log).

Deploy compatible application and private RAG service code to deliver these
changes at the production URL. Activate the measured controls explicitly during
that rollout, preserve the existing model/provider choice and standard tier,
and repeat normal-role browser checks. No hosted delivery or universal latency
achievement is implied by this local repair.
