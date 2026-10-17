# DeskAtlas RAG natural-question audit

Date: October 16, 2026 (Asia/Irkutsk). Scope: audit before fixes, requested by the maintainer.
Traceability: PRD-F26/F27, SDD-C20/C21/C23/C24, DSD-UI16, QAD-TC44/45/46, SPEC-4/5/6, MS-54 through MS-58.

## Result

Twelve questions were actually submitted through the signed-in admin portal browser. Four returned no usable answer despite relevant SOP material. Seven returned relevant guidance, usually with substantial presentation problems. One returned related cancellation policy without clearly acknowledging that the requested refund amount was unavailable. This small exploratory sample does not establish that a majority of all questions fail.

The main reproduced failure is selection followed by dependency expansion exceeding the six-source answer contract. Relevant evidence is retrieved, but redundant or unnecessary selections, plus mandatory ancestor chunks, produce an oversized closure. The application then returns only a scope-limit message. A fresh conversation reproduces it, so conversation history is not required.

Audit only: no application behavior, model settings, publications, migrations, permissions, or dependencies were changed. A read-only component reproduction script and this report were added. Existing extensive uncommitted work was preserved.

## Environment and method

- Local admin portal: `http://localhost:3000/manage`, Next.js development mode, existing active admin login completed by the user. No user session was fabricated.
- Neither local service was listening initially. Started `pnpm dev:admin` and `pnpm rag:api` using existing saved configuration. The initial question overlapped model warmup; startup observations are excluded from latency conclusions.
- `pnpm rag:status` subsequently reported `ready: true`, `implementation_current: true`, guidance `CURRENT`.
- Saved gateway controls: similarity threshold `0.5`, request deadline `55000`, SOP fast path enabled, synthesis enabled. Hybrid retrieval was not enabled in the saved gateway configuration. Flags were not changed for the audit.
- Read-only KB audit: one active Markdown publication, parser v4, 118 chunks/sections, structure reviewed, v2 section metadata, no missing/unresolved/blocked sections, maximum four dependencies. Reviewed-scope contract probe passed.
- Reference: the user-supplied `GENERAL (ADAPTED) SOP DOCUMENT.md`. Its directions were treated as document content. The existing published SOP was queried without reuploading, republishing, or assuming byte identity with the Downloads file.
- Questions 1-8 shared a conversation. The panel was closed and reopened, visibly clearing the transcript. Questions 9-12 shared that fresh conversation. Question 10 deliberately used formal FAQ wording as a diagnostic control; the other questions used ordinary staff language.
- Browser evidence was inspected in the active session. Full transcripts, private source text, credentials and generated planning rewrites were not saved. The table preserves the auditor-authored questions and behavioral observations.
- Component probes use current active-role checks, existing private-service capability signing and role-scoped read-only RPCs, following existing repository probe conventions. They bypass the browser/gateway wrapper and therefore are component evidence, not a second end-to-end browser benchmark.
- Base commit: `c7aecd8`, with a large pre-existing dirty working tree. Results apply to this local candidate and current publication, not a deployed production release.

## Browser observations

| # | Actual question | Observed behavior | Assessment |
|---|---|---|---|
| 1 | Hey, a customer is being really loud and the others are getting annoyed. What should I do? | Relevant noise-control and FAQ excerpts. Repeated ancestor headings and five citations. | Answered, poor readability |
| 2 | And if they keep doing it after I ask them to quiet down? | Only inability-to-answer message and `INCOMPLETE_EVIDENCE: CONTEXT_BUDGET`. No escalation guidance. | Avoidable refusal; SOP 4.8 covers repeated violations |
| 3 | I’m opening today. What should I get ready before customers arrive? | Same budget refusal. | Avoidable refusal; SOP 3.1 covers opening duties |
| 4 | Someone left a laptop behind. What do I do with it? | Accepted evidence-based summary. Ordered steps 1 and 2 were the document and parent headings; step 3 contained the actual lost-and-found procedure as a nested list. | Relevant content, broken procedure presentation |
| 5 | A customer sent a payment screenshot online. Can the front desk approve it? | Same budget refusal. | Avoidable refusal; SOP 4.3.1 and 11 distinguish admin approval from counter confirmation |
| 6 | A customer just wants to grab lunch and come back. Should I check them out? | Exact FAQ guidance explicitly distinguished temporary exit/re-entry from final checkout. Repeated headings. | Answered safely, poor readability |
| 7 | May nagrereklamo na mahina ang wifi. Ano gagawin ko? | Relevant English complaint guidance and FAQ with a localized source-language notice. Included a broad list of unrelated complaint categories. | Useful exact fallback; did not deliver a conversational Tagalog answer |
| 8 | How much should we refund someone if they cancel? | General cancellation/rescheduling excerpts and restriction against unauthorized promises. No invented amount, but no clear missing-amount statement or partial/gap notice. | Specific question unresolved; related policy presented without an explicit gap |
| 9 | A customer keeps being noisy after I ask them to quiet down. What should I do? | Same budget refusal in the first turn of a fresh conversation. | Avoidable refusal independent of prior history |
| 10 | How should employees address noise complaints? | Relevant exact answer with six citations, including broad complaint material. | Formal control succeeds where natural equivalent fails |
| 11 | If someone has picked a desk but hasn’t paid yet, is it already reserved for them? | Correct no-hold rule, followed by the entire booking/access-controls section, including unrelated policies. | Correct answer, excessive unrelated material |
| 12 | I’m finishing my shift. What should I tell the next person? | Relevant six-item handover procedure, with repeated ancestor headings. | Answered, poor readability |

Observed refusal count: 4/12 (33.3%). Relevant guidance count: 7/12. Unresolved specific-policy question without a clear gap: 1/12. These are manual audit categories, not frozen held-out acceptance metrics. Question 10 is a control, so 4/11 ordinary-language attempts refused. No dangerous operational mutation was attempted.

## Reproduction and isolation

Run from the repository root with the existing local service and saved environment:

```powershell
node scripts/rag-natural-audit.cjs standalone
node scripts/rag-natural-audit.cjs noise
node scripts/rag-natural-audit.cjs fresh_opening
node scripts/rag-natural-audit.cjs standalone --minimal-control
```

The commands intentionally exit 1 when a supported ordinary question cannot reach answering because the expanded closure is unavailable. Output contains counts, stage status/timings and hashed chunk identities, not excerpts or secrets. `passed` assesses usable closure admission, not final semantic answer acceptance. `--minimal-control` adds a separate diagnostic comparison and does not install a fallback in the product.

| Case | Candidates | Selected | Complete union of selected dependencies | Result |
|---|---:|---:|---:|---|
| Repeated noise, standalone | 4 | 3 | 7 chunks | `CONTEXT_BUDGET`; no answer invocation |
| Repeated noise, follow-up | 10 | 6 | 11 chunks | `CONTEXT_BUDGET`; no answer invocation |
| Opening duties, standalone | 5 | 4 | 9 chunks | `CONTEXT_BUDGET`; no answer invocation |
| Standalone noise, strongest direct unit only, diagnostic control | Same retrieved candidates | 1 | 3 chunks | `/v1/answer` returns three exact supported quotes |

The standalone noise failure repeated across four component runs, including the minimal-control run. Each selected unit individually expanded successfully to three chunks, two of which were heading-only ancestors. The selection union was consistently seven chunks. The standalone planner preserved the original question, and the selection request was only 3,735 bytes, below the 12,000-byte gateway budget. This rules out mandatory history, standalone query rewriting, missing retrieval, oversized selection input and service unavailability as necessary causes of this reproduction.

The minimal control changes only the selected seed set and retains that seed's entire reviewed closure, source identities, answer query and returned coverage. It proves that the actual answer path can produce exact support with three sources. It does not authorize blindly taking the first hit or dropping other material restrictions in production.

Saved content-free artifacts: `benchmark-results/natural-audit-2026-10-16/standalone.json`, `followup.json`, `fresh-opening.json`, and `minimal-control.json`. These local benchmark artifacts are ignored by Git. Each records stage timings only; browser completion was sampled manually, and some probes overlapped browser requests. No p50/p95, single-user latency certification or load acceptance is claimed.

## Implementation findings

### P1: Selection and closure contracts admit ordinary questions that cannot reach answering

Evidence: browser questions 2/3/5/9; controlled standalone noise and opening probes.

- `services/rag/app.py:737` (`context_selection`) prompts for the smallest support set, but the observed model still selected overlapping noise-control, FAQ and another related unit. It labeled the standalone noise question `MULTI_PART/COMPLETE`. Opening was labeled `FACTUAL/COMPLETE` despite being a task request. Prompt instructions alone do not enforce a minimal or task-correct selection.
- `apps/admin-portal/src/server/assistant/gateway.ts:352` through the expansion and `fits` checks accept the selected set, expand it once, and discard all evidence if the closure exceeds the contract. There is no bounded second selection based on actual closure cost or explicit handling of semantically duplicate support.
- `supabase/migrations/020_reviewed_section_scope.sql:197` returns `complete: false, reason: CONTEXT_BUDGET, sources: []` when expansion exceeds six chunks. Live RPC results reproduce that contract. This is an intentional safety gate; removing it alone would break downstream six-source/quote limits.
- `services/rag/rag/evidence-budget.json` uses six answer sources and six quotes. Candidate selection can consider twelve sources. A selected count below six is insufficient to guarantee that the dependency-expanded answer fits.

The reproduced failure occurs after useful retrieval and before answer generation. It is not explained by the SOP being absent. Synthesis cannot rescue it because synthesis is admitted only after grounded exact evidence succeeds.

### P1: Structural ancestors consume answer capacity and become mandatory answer text

- `services/rag/knowledge/structure.py:46` adds ancestors to dependencies. Publication review in migration 020 also unions ancestors into the effective dependency list. The live corpus confirms two heading-only dependencies for each direct noise support unit.
- `gateway.ts:376` marks every expanded source ID required. `services/rag/app.py:711` preserves heading content for this contract; `complete_evidence_quotes` packs every mandatory source. `gateway.ts:247` rejects missing required coverage.
- Consequently, metadata-like headings consume the same source/quote budget as operative rules and must be reproduced in accepted content. This explains both the seven-chunk refusal and repeated headings in otherwise useful responses.

Do not delete all ancestors or weaken complete-procedure checks. Some headings contain real scope, role restrictions or conditions. The design needs an explicit distinction between structural context, substantive inherited rules and displayable answer units, with an audited migration/review strategy.

### P2: Procedure synthesis deterministically labels evidence spans as action steps

Evidence: browser question 4.

`services/rag/app.py:896` handles complete procedures by constructing one `kind='step'` block per evidence span. Ancestor heading spans become steps 1 and 2; a span holding six source steps becomes one outer step. `packages/domain/src/services/assistantSynthesis.ts` checks exact ordered span retention, while `packages/ui/src/components/assistantPresentation.tsx:66` numbers each step block and then parses any source list inside it. The rendering faithfully exposes an upstream block-model problem.

Acceptance currently confuses exact span coverage with meaningful procedure structure. The result is labeled an evidence-based summary while still functioning as nested excerpts.

### P2: Evidence support does not ensure that the requested detail is answered

Evidence: browser question 8. The answer was safe about not promising unauthorized refunds but did not state that the amount was unverified.

`ScopeDecision.selection`, `/v1/context`, `check_evidence` and the synthesis support model rely on semantic model decisions for requested-fact coverage. `gateway.ts:419` can only expose a partial gap if the selector reports one. Related policy can pass as sufficient and fall back to exact excerpts without making the missing requested amount explicit. Exact substring/citation checks prove provenance, not responsiveness. The precise internal verdict for question 8 was not captured, so its model-stage attribution remains a hypothesis requiring a focused gap probe.

### P2: Natural-language fallback quality remains weak

Questions 1/6/7/10/11/12 gave repeated headings, overlapping FAQ/body text or unnecessary entire sections. The Tagalog question received English exact evidence plus localized notices. This preserves source language safely, but does not meet the desired conversational experience. The gateway's existing eight-second synthesis allowance and strict support checks can fall back to exact text, but per-request fallback reasons were not captured; no claim is made that a timeout caused these specific fallbacks.

### Test coverage does not catch the reproduced integration failure

The existing focused MS-56/57/58 suites passed all 40 tests while these real browser questions failed. Their controlled fixtures validate selected paths, safety contracts and supplied rendering blocks. They do not establish real-model minimal selection, a published hierarchy with heading-only ancestors, or successful answers to unseen natural paraphrases. Passing them should not be reported as live RAG acceptance.

## Fix specification, in implementation order

1. Add a regression at the real retrieval/selection/closure seam for standalone repeated noise and opening duties. Include formal wording and follow-up variants. Assert a useful correctly scoped answer, not merely HTTP 200 or a valid envelope.
2. Make selected support aware of expansion cost and duplicate semantic coverage. Use a bounded reconsideration when the selected union overflows, retaining every substantive restriction, contrary rule and complete procedure requirement. Do not install a first-hit or truncated-evidence fallback.
3. Separate structural context from substantive required evidence. Preserve immutable source text, hashes, reviewed references and authorization checks. Define how old published versions remain compatible; any changed persistence contract needs reversible migrations and publication review.
4. Build display blocks from actual source-backed actions and conditions. Keep ancestor titles as context and original excerpts in the evidence view. Each ordered action should appear once with its qualifications, without numbering document titles as work steps.
5. Add requested-detail coverage checks and explicit gap behavior for missing amounts, contacts and facility-specific rules. A related cancellation paragraph is not an amount. Preserve the safe restriction against unauthorized promises.
6. Report selection overflow separately from genuine necessary-evidence overflow in content-free diagnostics. Include selected count, expanded count/cost and fallback reason. Avoid telling staff to narrow an already-specific question when the implementation selected redundant material.
7. Re-run unseen ordinary English, Tagalog and Taglish questions through both authorized portals, including fresh and follow-up sessions. Measure submit-to-complete-render independently after useful-answer correctness passes. Preserve existing role, revocation, no-hold and ephemeral-session gates.

The audit does not authorize enabling a flag, weakening verification, increasing limits without coordinated evaluation, or publishing a new corpus. Implement and verify the fix against the reproduction before claiming resolution.

## Verification record

- `node --check scripts/rag-natural-audit.cjs`: passed.
- Real read-only probes: expected failing exit status with the reproduced budget reason; minimal control produced exact supported quotes.
- `pnpm exec vitest run tests/ms56-evidence-selection.test.ts tests/ms57-synthesis.test.ts tests/ms58-assistant-presentation.test.ts`: 40 tests passed in three files.
- `pnpm typecheck`: passed across shared packages and all four applications.
- `pnpm lint`: passed, 25 Python boundary files and 27 TypeScript boundary files. This configured lint command is scoped and does not lint every repository file.
- `pnpm test`: 2,188 passed, six skipped, one failed in `tests/spec2-campaigns-and-rewards.test.ts:327` (`SPEC2-TC05`, invalid reward vocabulary accepted). This is the unrelated failure already documented in the earlier MS-54 implementation record; no campaign code was changed during this audit.
- `pnpm build`: passed for all four applications.
- Final `pnpm rag:status`: ready and current. No Python serving code was changed.

These are baseline working-tree checks; application fixes have not been applied. No benchmark was conducted while the workspace-wide checks ran. The normal local portal and API started for this audit remain running, and the final browser conversation is left open for inspection.
