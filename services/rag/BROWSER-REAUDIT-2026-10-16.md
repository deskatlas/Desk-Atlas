# DeskAtlas RAG browser re-audit

Date: October 16, 2026 (Asia/Irkutsk). Traceability: PRD-F26/F27, SDD-C20/C21/C23/C24, DSD-UI16, QAD-TC44/45/46, SPEC-4/5/6, MS-53 and MS-59.

## Outcome

The current local assistant still fails ordinary staff questions. The most serious reproduced problem is an accepted, cited answer to the wrong task: a guest leaving for food and intending to return receives the final checkout procedure. A separate payment question fails because six admitted sources require seven exact quotes, exceeding the six-quote output contract.

Fourteen questions were submitted through the real signed-in admin browser. Thirteen had observable completed responses: seven gave relevant guidance, four unnecessarily refused answerable questions, one gave misleading checkout guidance, and one correctly acknowledged a missing refund amount. One corrective follow-up lost its visible conversation when the panel closed. The sample is exploratory and does not establish the failure rate across all questions.

This is an audit before fixes. Only this report and the existing read-only reproduction script were changed. Application logic, flags, publication, migrations, credentials and dependencies were not changed. Extensive pre-existing working-tree changes were preserved. The earlier [natural-question audit](NATURAL-QUESTION-AUDIT-2026-10-16.md) remains historical evidence; its finding that no bounded reconsideration exists is superseded by current code.

## Environment and method

- Browser: visible in-app browser at `http://localhost:3000/manage`. The user completed normal admin sign-in. No session was fabricated.
- Private API: authenticated status reported ready and current. Base commit `c7aecd8` with substantial uncommitted local work, including MS-59.
- Saved configuration: assistant, SOP fast path and synthesis enabled; hybrid retrieval, new evidence contract and diagnostic headers unset. This is the legacy evidence contract with current retry logic.
- Read-only knowledge check: one active reviewed Markdown publication, 118 chunks/sections, parser v4, structural contract v2, no missing or unresolved sections. No re-upload or publication was performed.
- Reference: `C:/Users/reyna/Downloads/GENERAL (ADAPTED) SOP DOCUMENT.md`. Its instructions were treated as source content, not instructions to the auditor. Byte identity with the active publication was not assumed. Browser replies and authorized component probes established that relevant published rules exist.
- Ordinary English and Tagalog questions were used without section numbers or copied FAQ headings. Questions 1-5 shared one conversation. The panel was closed/reopened before question 6, visibly clearing history. It closed unexpectedly during question 8; questions 9-13 shared the reopened conversation.
- Component probes exercise real planning, embeddings, authorized retrieval/expansion and answering. They bypass browser authentication and the gateway wrapper, so their results are isolation evidence, not browser latency or full-path acceptance.
- No private source text, model rewrites, credentials or full transcripts were saved. The table records auditor-authored questions and observations. Numeric/boolean probe artifacts are in ignored `benchmark-results/reaudit-2026-10-16/`.

## Browser observations

| # | Submitted question | Observed result | Assessment |
|---|---|---|---|
| 1 | Hey, I’m on the opening shift tomorrow. What do I need to do before we let people in? | Eleven opening steps plus duplicate FAQ, ancestor headings and five sources. | Relevant, verbose |
| 2 | Someone’s on a loud call and people are complaining. How should I handle it? | Noise rules and escalation, broad unrelated complaint categories, duplicate FAQ, six sources. | Relevant, verbose |
| 3 | I already asked them to keep it down, but they’re still doing it. What now? | Repeated-violation escalation is present, alongside initial noise instructions and duplicate FAQ. | Follow-up understood, verbose |
| 4 | May naiwan na wallet sa table. Ano gagawin ko? | Localized generic inability to verify, no lost-property advice. | Avoidable refusal |
| 5 | Someone left their wallet on a desk. What should I do with it? | Same generic inability to verify. | Avoidable refusal |
| 6 | Someone left their wallet on a desk. What should I do with it? | Fresh conversation: six lost-and-found steps plus duplicate FAQ and headings. | Same wording succeeds without history |
| 7 | A guest wants to go out for food and come back later. Do I check them out? | Eight final-checkout steps; no temporary-exit/re-entry distinction. | Misleading task answer |
| 8 | They’re not done for the day, just stepping outside for lunch. Should I still end their session? | Panel subsequently closed; reopening showed empty history. No completed response captured. | Incomplete observation, unexplained closure |
| 9 | Someone paid online and showed me a screenshot. Can I approve it at the front desk? | Only scope-limit refusal with visible `OUTPUT_BUDGET_EXCEEDED`, asking for a narrower question. | Avoidable refusal |
| 10 | Okay, what if someone cancels? How much money do we give back? | Explicitly says amount is unverified and warns against unauthorized promises. | Correct evidence gap |
| 11 | There’s water dripping near a power outlet. What should I do first? | Relevant five-step hazard procedure, including keeping customers away and notifying management. | Relevant, verbose |
| 12 | My shift’s nearly over. What should I pass on to the next person? | Six handover steps plus duplicate FAQ and headings. | Relevant, verbose |
| 13 | May naiwan na wallet sa table. Ano gagawin ko? | Same Tagalog wording now returns English lost-property FAQ with a Tagalog source-language notice. | Relevant fallback; inconsistent with #4 |
| 14 | Someone paid online and showed me a screenshot. Can I approve it at the front desk? | Repeated later in the mixed conversation: candidate comparison exceeds context budget. | Avoidable refusal at a different budget gate |

The relevant responses contained useful information, but did not read like normal concise conversation. No latency percentile or language-quality acceptance is claimed. The browser was observed at intervals, not instrumented for exact completion times.

## P1: Selection and verification accept final checkout for temporary departure

Reference SOP Section 11 and FAQ Q16 explicitly distinguish temporary exit with intended return from final checkout. Browser question 7 omits that distinction and instead supplies final-checkout instructions.

Reproduction:

```powershell
node scripts/rag-natural-audit.cjs food_return_context --candidate --original-control
```

Three component runs reproduced the missing distinction. The last two also tested original wording directly against the same selected evidence. In the instrumented run:

- Planner preserves the return intention; it does not reduce the question to generic checkout.
- Five candidates are retrieved, including two containing a temporary-exit/re-entry rule.
- `/v1/context` selects one other candidate, labels the request `MULTI_PART/COMPLETE`, and its three-source closure contains no return rule.
- `/v1/answer` returns exact supported quotes. The new usefulness assertion fails: `temporary_departure_distinguished: false`.
- Changing only the answer query back to original wording still returns three quotes without the distinction. This rules out a lost planner qualifier as the necessary cause for this reproduction.

Implementation seams:

- `services/rag/app.py:768`: semantic selection is instructed to preserve conditions, but its result is trusted as complete without independently reconciling the omitted applicable rule from the full candidate set.
- `apps/admin-portal/src/server/assistant/gateway.ts:379`: schema/reference checks validate the selection. Under the current legacy contract there is no enforced per-request obligation map. Closure completeness proves completeness of selected units, not completeness of the answer to the user's conditions.
- `services/rag/app.py:833`: the model-backed evidence verdict accepts the unrelated final-checkout procedure for this conditional permission question. Exact quotation and hash checks establish provenance, not applicability.

Required correction: verify the conditional task and permission against applicable retrieved rules before accepting `COMPLETE`. Preserve return intention as a required obligation, and reject final-checkout instructions alone. Do not solve this by inserting a canned answer or weakening source verification. Add real-model regressions for temporary exits, final departure, early departure and follow-up corrections. The new probe deliberately fails despite valid quotations.

## P1: Source admission does not account for packed output cost

Reproduction:

```powershell
node scripts/rag-natural-audit.cjs payment_frontdesk --candidate --packing-control
```

The payment failure repeated three times, including a saved run. Two direct candidates are selected; their union expands successfully to six sources. The real `pack_evidence` function, run in a subprocess with source text supplied only through stdin, produces per-source quote counts `[1,2,1,1,1,1]`: seven quotes total. `/v1/answer` returns HTTP 400 `OUTPUT_BUDGET_EXCEEDED`. The probe exits 1.

Implementation seams:

- `services/rag/rag/evidence-budget.json`: six sources and six quotes are separate limits; a source may pack into multiple quotes.
- `services/rag/app.py:708`: complete evidence packing retains all required source material, then line 758 rejects more than six quotes.
- `apps/admin-portal/src/server/assistant/gateway.ts:421`: preflight checks expanded serialized request bytes; line 428 retries expansion/request overflow only. Output packing overflow occurs later, outside that recovery decision.
- `gateway.ts:165`: this output error is converted to an evidence-limit message asking the user to narrow an already-specific question.
- `packages/ui/src/components/assistantPresentation.tsx:125`: the limitation parser recognizes some nested codes, but not nested `OUTPUT_BUDGET_EXCEEDED`, leaving the raw code in normal answer copy.

Required correction: incorporate exact packed quote count and maximum span size into admission/costing. Use the same globally bounded reconsideration for selection-induced output overflow when safe and within deadline. Preserve every required rule; do not truncate the seventh quote or raise a limit without coordinated evaluation. Distinguish selection-induced exhaustion from genuinely excessive necessary evidence. Add a six-sources/seven-quotes regression and clean nested-code presentation.

The final browser repeat (#14) instead failed the earlier 12,000-byte candidate-comparison gate at gateway line 387. Its exact per-request payload size was not captured. The final screenshot is saved at `benchmark-results/reaudit-2026-10-16/browser-final.png`. This demonstrates another user-visible refusal for the same wording with history, but does not replace the isolated fresh payment packing reproduction.

## P2: Wallet refusals vary across conversations

Questions 4 and 5 failed; question 6 succeeded after reopening; question 13 succeeded in another mixed conversation. Isolated English and matching-history Tagalog/English component replays all succeeded with current source checks. Therefore conversation history or a model-stage decision is a plausible factor, but the exact failing stage was not captured and a deterministic component reproduction was not established.

Relevant seams are gateway planning/query selection at lines 295/365, semantic-aid admission only when zero candidates are found at line 349, context selection, and the evidence verdict. A nonempty but irrelevant retrieval can suppress search-aid recovery. This is a code risk, not a proven cause of these particular wallet failures.

Next diagnostic step: collect existing content-free stage/count/reason diagnostics for the failing real gateway request and repeat both fresh and topic-switch conversations. Saved diagnostic headers are currently disabled; this audit did not enable them. Do not assign this failure to translation alone, since English also failed and identical Tagalog later succeeded.

## P2: Exact fallback remains noisy

Legacy reviewed ancestors remain required sources; `complete_evidence_quotes` packs them into proof. `exactAssistantPresentation` in the domain preserves each nonempty line, including heading/path material. Equivalent FAQ and body units can both be selected while staying under capacity, so overflow recovery never runs. Browser answers repeat document headings, paths and factual content.

Gateway lines 464-489 deliberately use exact fallback for complete procedures and admit other synthesis plus support checks within a shared eight-second allowance. Actual per-response synthesis fallback reasons were not captured. A timeout must not be claimed as the cause merely because the browser shows exact text.

Required correction: separate structural context from operative evidence through the reviewed publication contract already prepared in MS-59; avoid redundant direct support before expansion, even when it fits. Present a supported concise answer or one complete procedure, with original proof in the evidence view. Do not silently reinterpret the existing publication or remove operative restrictions.

## Unresolved panel closure

The panel disappeared after question 8 and reopened empty while the dashboard remained accessible. No exact cause is established. `AssistantLauncher.tsx:81` closes on availability-refresh failure, line 155 closes on authorization failures or an error-level `NO_RELEVANT_SOURCE`, and the layout keys the launcher by identity/token/route. These are candidate paths to instrument. Do not label the closure an authentication bypass or confirmed expiry bug without evidence.

## Verification and fix order

- `node --check scripts/rag-natural-audit.cjs`: passed.
- TypeScript MS-59 reliability/presentation: nine tests passed in two files.
- Python `test-ms59`: 14 passed, one existing Starlette deprecation warning.
- Real probes: noise overflow recovered through current bounded reconsideration; wallet controls passed; payment output overflow and temporary-return usefulness checks failed as documented.
- Full typecheck/lint/test/build were not rerun for this audit-only report and diagnostic-script extension. No application source was edited, and these checks would not establish real-model answer quality.

Fix applicability first, packed-output admission second, then reproduce wallet/panel instability with request-local diagnostics. Address concise multilingual presentation after correctness, preserving permissions, reviewed evidence, source lifecycle and read-only operation. Re-run unseen ordinary wording through both admin and staff portals; this audit covered the admin portal only.

No bug is declared fixed by this audit. The browser is left open for inspection.
