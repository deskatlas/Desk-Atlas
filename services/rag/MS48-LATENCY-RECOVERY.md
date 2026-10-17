# Local document-answer latency recovery

Date: October 15, 2026. Authority: MS44 Sections 4 and 7, MS48 Sections 4.2
through 4.4, PRD-F26, SDD-C20/C21, QAD-TC44/46.

## Confirmed failure

The authenticated gateway reproduced a document-answer failure in 35.062 seconds.
Retrieval took 0.558 seconds, planning 4.051 seconds and model work 29.375 seconds.
The response incorrectly described the local model as unavailable and returned
no citations.

A separate real four-candidate synthetic reproduction returned
`INVALID_MODEL_OUTPUT` in 24.667 seconds, with exactly 128 generated tokens.
The section selector was generating long chunk UUID strings under a compact
128-token budget. Increasing that budget would also increase CPU generation time.

The normal `pnpm rag:api` startup path also lost the existing measured MS44 GPU
profile. The active model had zero VRAM residency and requests forced
`num_gpu=0`. The earlier GPU profile and its historical measurements remain in
[MS44 evidence](MS44-EVIDENCE.md); they are not measurements of this candidate.

## Changes

- Model context selection uses explicit zero-based numeric candidate IDs.
  Complete text and headings remain in the prompt. The server restores original
  chunk identities and rejects out-of-range or contradictory selections. The
  four-candidate synthetic check now returns all four original IDs successfully.
- Common standalone customer check-in/out wording uses the existing retrieval-only
  planning shortcut. Mixed intent, history and unsupported actions still defer
  to planning. No checkout or other business mutation is performed through chat.
- Context selection updates progress to preparing rather than leaving the panel
  labeled as retrieving during inference.
- Incomplete model output, model transport timeout and request deadline outcomes
  retain distinct codes and reviewed English/Tagalog/Taglish messages. A stopped
  or unreachable model remains `MODEL_UNAVAILABLE`.
- Saved GPU settings now invoke the existing `serve_local.py --gpu` path from
  `pnpm rag:api`, including starting/reusing private Vulkan Ollama on 11435 and
  checking pinned-model residency. Explicit CPU settings retain their previous
  single-process Uvicorn path. Gateway credentials are not forwarded to a newly
  spawned model server.

Local scoped configuration selects the installed Vulkan backend and the same
pinned `qwen3:4b` model. The normal Ollama server on 11434 is unchanged. The final
clean instance reports size and VRAM residency of 5,102,307,901 bytes with a
16,384 context window. Diagnostic orphan runners were removed; unsuccessful
batch-size/single-slot experiments were not promoted. A prompt-layout experiment
failed the live answer-quality check and was reverted; question-first prompts
remain. No application cache of questions, answers or source text was introduced.
No dependencies, drivers, model artifacts or database changes were installed
or applied.

Required dependency closure, full-generation integrity, exact source quotations,
the independent support check, role checks, publication visibility and final
actor/source/epoch validation remain enforced.

## Verification and practical limits

- `pnpm typecheck`, `pnpm lint` and all four production builds passed.
- Focused TypeScript regression run: 92 passed across five suites.
- MS44 Python service/transport/cancellation checks: 37 passed.
- MS48 Python parser/context/evidence checks: 15 passed.
- Full Vitest run: 2,025 passed, three skipped, one existing unrelated SPEC2-TC05
  campaign reward-validation failure at `tests/spec2-campaigns-and-rewards.test.ts:327`.
  Two subsequent launcher cases passed in the focused run.

`node scripts/rag-context-smoke.cjs` performs a real synthetic four-candidate
selection without document text or credentials in its output. Diagnostic gateway
replays and numeric stage results are recorded in
`evaluation/ms48-latency-recovery.json`. They use current published evidence but
retain no transcript or source text. These are single-actor diagnostics, not
five-user, multilingual or private-policy release acceptance.

The earlier fixed GPU replay returned three citations in 4.806 seconds on a warm
repeat. Initial and differently worded prompts were still substantially slower;
do not describe that single warm observation as a cold-start or representative
latency guarantee. The final replay record separates its first request from
subsequent warm samples.

Final clean question-first replay: six out of six authenticated admin/staff
requests returned checkout answers with three citations and no model failures.
The first admin replay took 22.105 seconds. Two subsequent admin samples and
three staff samples took 4.538 through 4.969 seconds. These five warm observations
do not establish a p95 or guarantee first-time/paraphrased-question latency.
The record retains the rejected prompt-layout experiment and separately labels
three diagnostic staff authentication setup errors; neither is counted as a
successful answer or a valid latency sample.
