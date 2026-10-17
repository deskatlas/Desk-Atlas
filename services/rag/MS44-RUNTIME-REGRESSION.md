# MS44 runtime latency regression investigation

Date: October 15, 2026. Traceability: MS44 Sections 4 and 7, MS53,
PRD-F26, SDD-C20/C21, QAD-TC44/46.

## Outcome

The retained profile improves the reproduced FAQ and procedure paths.
The general ten-second requirement is not fully accepted: a broader
paraphrase still fails complete evidence selection. No refusal or wrong
answer is counted as latency success. This is local, single-staff evidence,
not release acceptance, concurrent-user acceptance or a universal latency guarantee.

## Retained changes

- Keep the original pinned Qwen3 4B model, digest, encoder, context window
  16384, source budgets, publication checks and role boundaries.
- Default the GPU launcher to a measured prompt batch of 64. Preserve
  explicit environment overrides; preload and inference use the same batch.
  CPU retains its prior default of 1024. Invalid batch values fail closed.
- Bind a standalone question to one retrieved, published FAQ question when
  literal text or conservative ordered content-word matching is unique.
  Word order, roles, negation, dates and conditions remain significant.
  Conversation-dependent, ambiguous, duplicate and competing permission
  cases use the existing selection path.
- Expand and verify the complete reviewed dependency closure. Verify source
  identities, document versions, epochs and hashes. Preserve exact complete
  quotations, required restrictions and citations.
- Independently check the original user question against that complete FAQ
  evidence, even when the planner rewrites the search query. No answer,
  question, transcript, evidence or embedding cache was introduced.
- Remove all temporary console diagnostics and response headers after the
  live benchmark. Existing content-free request timing remains available.

## Reproduction and measured recovery

The original content-free command `node scripts/rag-context-smoke.cjs`
failed twice with MODEL_TIMEOUT at 45,155 and 45,185 ms. A nine-token
local model request took 16,601 ms. Windows counters showed approximately
7,453 MiB dedicated and 4,835 MiB shared GPU allocations; the model itself
had approximately 1,128 MiB dedicated and 4,052 MiB shared allocations.
A game and AMD recording were major competing allocations. Ollama's
reported GPU residency alone did not establish actual dedicated residency
or throughput.

The user closed the game and disabled Instant Replay. The protected
recording process could not initially be stopped by the agent, but its
recording allocation disappeared after the user's action. No driver was
installed. Installed Ollama reports 0.40.4; the historical report used
0.40.3. No controlled runtime-version regression was established.

After resource recovery, an approximately 811-token fresh prompt still
needed roughly 9 seconds with batch 1024. Batch 64 reduced the measured
fresh prefill to 1,669 ms; batch 32 took 2,712 ms. Context window and model
weights were unchanged. This supports the retained batch setting.

With batch 64, all eleven synthetic answer component cases passed,
including conflict, permission, unsupported, injection, Filipino and
Taglish cases. Six correct nonempty answers took approximately 1.2 to
2.0 seconds. Component results exclude authentication, planning, retrieval,
final source reads and rendering.

### Authenticated staff browser observations

Each question was submitted through the normal signed-in staff UI on the
existing published SOP. Fresh chats cleared conversation context. Complete
render timings came from request-correlated numeric browser diagnostics;
answers were inspected for expected content and citations. Diagnostics
were removed afterward.

| Question | Complete render | Correctness observation |
|---|---|---|
| What should employees do if they have suggestions for improving the SOP? | 4,182.7 ms initial observation; 3,123.2 ms repeat | Employees report procedural problems and suggest improvements for management review; full required context and six citations |
| What should employees do when operational procedures change? | 3,299.3 ms | Follow management's updated instructions and participate in required training; published Q37 and citations |
| how do i checkout a customer | 1,613.5 ms | All eight check-out steps, including approved charges and applicable outstanding payments; three citations |
| Who is responsible for reviewing and updating the SOP? | 2,053.4 ms | Management reviews, communicates revisions and supplies training/resources; published Q45 and citations |

These are individual observations, not percentile estimates. The initial
4,182.7 ms observation was interrupted visually by development refresh;
its 3,123.2 ms repeat was fully inspected in the UI.

The suggestions question originally failed at 49,901 ms. Planning took
3,672 ms, embedding 319 ms, retrieval 215 ms and the answer stage 45,096 ms.
Further diagnostics established that this answer stage was context
selection, before answer generation. Selecting almost every related
candidate made the union exceed the unchanged six-source evidence budget.
The source-bound FAQ path resolves this reproduced wording without
removing reviewed context.

### Remaining failure

`How should suggestions for improving the SOP be submitted?` does not
qualify for the conservative FAQ match. The normal selector chose eleven
of twelve candidates, exceeded the evidence budget, and returned no
verified answer after 15,634.6 ms. The failure remains reproducible and
excludes full general-latency acceptance. Narrow matching is not a claim
that all synonyms, languages or arbitrary compound requests are fixed.

## Rejected experiments

- Quantized Q8 KV cache / flash configuration did not improve fresh prefill
  and failed a Filipino source case. Restore the original cache settings.
- The user approved downloading and benchmarking local Qwen3 1.7B. It
  failed exclusive-owner conflicts, role limits and multilingual cases.
  It was not promoted; serving continues to use the pinned 4B model.
- Compact context tables passed small probes but selected the wrong FAQ in
  a live question. The independent support model also accepted that wrong
  topic. Rejected and reverted; never counted as success.
- Prose sentence packing and unconditional context selection did not fix
  the root failure and were reverted. Original paragraph/list boundaries
  remain unchanged.
- A calibrated selection prompt still overselected a compound synthetic
  question. Rejected before promotion.
- Per-candidate answer/related/unrelated classification passed four small
  synthetic probes, but its live paraphrase selected five unrelated or
  overly broad units and returned a budget refusal at 10,847.5 ms.
  Rejected and reverted. The original context selector remains in service.

No sources, publications, database schemas, staff permissions or booking
rules were modified. Existing upgrade work was preserved.

## Verification

- `pnpm typecheck`: passed for all packages and applications.
- `pnpm lint`: passed; 22 Python and 22 TypeScript boundary files, no failures.
- `pnpm build`: passed for all four applications.
- `pnpm test`: 2,103 passed, three skipped, one existing unrelated
  SPEC2-TC05 reward-validation failure at
  `tests/spec2-campaigns-and-rewards.test.ts:327`.
- Python service/boundary selection: 108 passed in `.venv-service`.
- MS48 parser/context suite: 15 passed in the existing `.venv` environment.
  Running its nine parser cases under `.venv-service` first failed because
  that service environment intentionally lacks the `olefile` parser
  distribution; rerunning in the correct parser environment passed.
- `git diff --check`: passed. Temporary tagged diagnostics were removed.
- `node scripts/rag-status.cjs`: ready, implementation_current=true.

The broader paraphrase selection failure remains open. No deployment or
full MS44 performance-acceptance claim is made.
