# Natural document answer reliability, October 15, 2026

Authority: the user's eight answering requirements, PRD-F26/F27, SDD-C20/C21,
QAD-TC44/45/46, and MS-55 through MS-58. This is a general selector correction,
not a question-specific answer table or keyword routing rule.

## Observed failure and correction

Both reported questions reproduced `INVALID_MODEL_OUTPUT` in `/v1/context`.
The pinned local model produced contradictory nested fields, including selected
support indexes paired with `INSUFFICIENT`, and invalid coverage. Its richer
scope response also shared the 128-token compact-verdict default.

Inference now maps each requested fact/task to direct supporting candidate
indexes. The server derives COMPLETE, PARTIAL_GENERAL, INSUFFICIENT, CONFLICT,
or CLARIFY from that mapping. The model no longer generates redundant outcome
and ambiguity fields. Missing procedure/document-wide support cannot become a
partial procedure. Negative decisions never become affirmative answers. Scoped
selection defaults to 384 output tokens; small boolean/index verdicts remain at
128. Explicit operator overrides and total request/context/evidence limits remain.

The selector compares meaning, combines passages, selects minimal direct support,
and distinguishes missing requested facts from terminology differences. Reviewed
dependencies, source integrity, complete quote coverage, independent evidence
verification, synthesis support verification, authorization and final publication
checks remain mandatory. No retrieval threshold or database contract changed.

The synthesis endpoint reconstructs mandatory procedure spans directly instead
of spending model tokens retyping them. Factual synthesis retains a generated
paraphrase and appends any omitted mandatory evidence as exact supporting text.
Fabricated support indexes are not repaired. The gateway's mechanical checks
and the separate semantic support verifier must accept the combined answer.

Short standalone pronoun-only requests ask what the referent means. Existing
conversation turns or selections bypass that planning guard so intent can be
resolved from context. A resolved standalone query continues into retrieval.
This guard does not route business questions to hardcoded answers.

## Local verification

The opt-in pinned-model synthetic matrix covers semantic paraphrases, combining
passages, unknown prices, unresolved references, supported partial general facts,
negative permissions, and procedure paraphrases. The unit regressions exercise
server-derived coverage and conversation-aware planning.

`tests/probe_sop_question.cjs <question> --context --synthesis` exercises live
retrieval, selection, reviewed expansion, exact answering, synthesis and separate
support verification without printing source/answer content. Both reported
questions passed these backend stages. The opt-in authenticated real gateway
test also returned SYNTHESIZED/ACCEPTED for both questions with three current
citations each, approximately 15.1 and 8.4 seconds respectively. Browser rendering
and broad production latency are not certified by these backend checks.

The local API was restarted and its loaded implementation fingerprint verified.
The existing `RAG_SYNTHESIS_ENABLED` flag was enabled in both portals' local
environment files. These ignored local settings are not a production rollout.
Verified exact excerpts remain the fallback when generated prose fails mechanical
checks, independent support verification, or the synthesis deadline.

Typecheck, lint and all four production builds passed. The full JavaScript suite
reported 2,186 passing tests and the existing unrelated SPEC2-TC05 campaign reward
vocabulary failure. No campaign behavior was changed. Broad production recall,
independent factual review and full browser latency acceptance remain separate.

Final focused Python run: 117 passed, seven opt-in model cases skipped. The
separate opt-in pinned-model run passed those seven cases plus the inference
boundary test. The focused TypeScript synthesis, gateway, presentation and
selection suites passed 58 tests. Local API status reports current loaded code.

Reproduction commands:

- `services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests/test_natural_selection.py -q`
- Set `RAG_LIVE_SELECTION=1` with the saved local Ollama GPU profile to run the seven opt-in synthetic model cases.
- Set `RAG_LIVE_GATEWAY=1`, then run `pnpm exec vitest run tests/ms58-natural-assistant-live.test.ts --silent=false` for real authenticated gateway acceptance. This reads current published sources without emitting their contents.

## Planning clarification follow-up, October 16, 2026

The question `can we suggest for sop improvement?` reproduced a separate
pre-retrieval failure: planning returned CLARIFY without clarification text. The
gateway then displayed a fixed request for reporting metrics, dates or workspace
details. The earlier selection correction could not help a question that never
reached retrieval.

The existing single planning inference now emits a short request-local intent
interpretation before choosing its route. This assessment is excluded from the
wire response and diagnostics. Its generation grammar requires clarification
text as a string, and instructions require a focused question for CLARIFY.
Permission, suggestion and procedure inquiries search documentation, while
requests to execute business changes remain unsupported. No new SOP keyword
shortcut or canned policy answer was introduced. The defensive shared fallback
is now neutral in English, Tagalog and Taglish instead of assuming report intent.
Standalone document queries retain the user's original question rather than a
potentially meaning-changing planner rewrite. Contextual follow-ups retain the
existing conversation resolver, and hybrid search aids remain optional expansions.

Nine pinned-model planning checks passed: the reported wording, other suggestion
and feedback phrasing, permission, Taglish, a conversation follow-up, a mutation,
today's operational count and an explicit availability request missing its time
interval. The exact reported question now retrieves published SOP support with
six verified citations and no diagnostic errors. This larger closure can exceed
the eight-second synthesis lane and use the authorized exact-evidence fallback;
do not claim that this case always produces accepted generated prose.

The Python regressions passed 130 tests; 16 opt-in cases were skipped in that
offline run. The focused TypeScript checks passed 87 tests. Typecheck, lint and
all four production builds passed. The full repository suite reported 2,188
passing tests and the same unrelated SPEC2-TC05 campaign vocabulary failure.
The local RAG API was restarted with the updated planner.

The current live workspace-map search differs from the earlier run: it returns
one published FAQ about workspace status controls, rather than the earlier
definition passages. The answer verifier withholds a definition it cannot
verify. The live test permits this retrieval-specific evidence gap, with no
citations or claim that the entire knowledge base lacks the topic. This is not
recorded as a useful answer or a retrieval recovery. The attempted optional
hybrid probe exceeded the existing candidate request budget and was not enabled
in local configuration. Retrieval thresholds and publication state were not
changed to force the live test to produce an answer.
