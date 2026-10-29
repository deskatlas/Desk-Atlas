# DeskAtlas customer RAG: broad browser conversation audit

Date: October 29, 2026, Asia/Irkutsk. Browser submissions approximately 17:56-18:01.
Target: https://www.thedeskatlas.com/. Source checkout: `6a407689e511981e06225e1353315e9e4b87d7f1`.
Traceability: PRD-F1-F4/F26/F27, SDD-C20-C24, DSD-UI16, ERD-E24-E29, QAD-TC44/46, MS77/MS79.

## Outcome

Ten sequential customer chat submissions produced nine substantive responses and one temporary service failure. Reading the replies for relevance and internal consistency gives six satisfactory responses, one capacity contradiction, one partial response, one wrong-context response, and one service failure. This small sample does not reproduce a majority of submissions receiving no answer. It does reproduce an intermittent outage and material correctness problems despite citations and passing component tests.

This is an audit before remediation. No application code, configuration, database content, model setting, publication or deployment was changed. Existing unrelated untracked admin production files were preserved. The saved transcript contains only the synthetic questions asked during this audit and public replies.

## Method and evidence

Opened the public website in a visible browser, opened Ask DeskAtlas, and typed normal questions individually. Used one anonymous visitor and one conversation. No privileged customer records, credentials, direct model submissions, identity rotation, quota bypass, reservation creation or payment actions were used. One failed question was repeated later in the same conversation and succeeded. A natural follow-up deliberately referenced the preceding answer.

Read-only Cloud Run request metadata was retrieved afterward for the matching time window. It contains endpoint, status, latency, revision and timestamp only. The active revision in these records is `deskatlas-rag-chat-production-admin1029b`. Local code inspection is consistent with the observed routes, but this audit did not independently attest the deployed customer frontend bundle.

Artifacts in this directory:

- `browser-transcript.md`: complete visible conversation snapshot, including the initial failure and successful repeat.
- `results.json`: questions, initial observations and timing upper bounds.
- `browser-final.png`: final visible browser state.
- `production-request-metadata.json`: filtered production request metadata, without source content, tokens or customer records.

## Broad questions and observed behavior

| # | Exact question | Assessment |
|---|---|---|
| 1 | Hi! I have never been here before. What is DeskAtlas and how does it work? | Failure: “Assistance is temporarily unavailable. Please retry.” Support reference `7c84d568-3bd2-4025-b0e7-842d0d09c3b7`. |
| 2 | What kinds of spaces do you have, and how much would a few hours cost? | Useful list of 11 workspace types, capacities and hourly rates. Correctly labels them base rates rather than a current quote. Leaves the actual few-hour total for clarification. Sky Booth is listed with capacity 1. |
| 3 | I just need somewhere quiet to study and take an occasional video call. What would you recommend? | Distinguishes quiet desks from speaking rooms, with six citations. However, describes Sky Booth as accommodating two people, contradicting #2. |
| 4 | How do I book and pay? Do I need an account, and when is my desk actually confirmed? | Relevant guest booking, payment deadline, proof upload, administrator review, no-hold rule and final assigned-unit confirmation. Six citations. |
| 5 | What if my plans change or I arrive late? Can I cancel, move the booking, or get a refund? | Addresses cancellation, rescheduling, refund conditions, late arrival and authorized relocation. Seven citations. Policy correctness was not independently checked against every original source. |
| 6 | Where are you located, what time are you open, and do you have Wi-Fi, outlets, parking or food? | Supplies address, regular hours, Wi-Fi, charging qualifications and pantry information. Explicitly says parking is unconfirmed. Five citations. |
| 7 | Paano kung first time ko lang at gusto ko lang mag walk in? Kailangan ba mag reserve muna? | Understands Taglish and responds in English, consistent with current language policy. Explains the kiosk and optional account/rewards details, but does not directly answer whether advance reservation is necessary. Gives only the first two numbered steps. Partial usefulness rather than a total refusal. |
| 8 | Okay, what happens after that? | Wrong continuation: switches from the on-site walk-in answer to “On the website” and a private email payment link, then adds cancellation and relocation rules. Eight citations all identify the website reservations/payment guide. |
| 9 | What should I do if the internet stops working or another guest is being noisy while I am working? | Relevant instructions to notify staff, identify the issue, seek authorized remedies, and preserve safety/privacy. Two citations. |
| 10 | Hi! I have never been here before. What is DeskAtlas and how does it work? | Successful repeat: explains the website and walk-in paths without requiring an account. Three citations. This does not prove the original failure was fixed or diagnose its exact cause. |

“Satisfactory” means relevant and reasonably useful on inspection, not independent policy certification. In particular, #5 and #8 have different wording about late arrivals that deserves source review. Citations do not establish that an answer addressed the intended task.

## Findings mapped to implementation

### P1: Workspace capacity changes according to which answer path runs

**Observed:** #2 says “Sky Booth: capacity 1”; #3 says “Sky Booth (two people).” These are contradictory customer-facing claims in the same conversation. This audit does not decide whether the live configuration or document is the intended business policy.

**Implementation:** `apps/customer-website/src/server/customer-assistant/spots.ts:63` builds the published overview from workspace template data. `gateway.ts:193` converts broad GUIDANCE requests without selected physical spots to KNOWLEDGE. The knowledge branch at `gateway.ts:301` composes an answer from documents. It verifies document provenance and current source epoch, but does not reconcile factual capacity claims against the workspace catalog before release. The independent document verifier cannot detect a contradiction in a database value it never receives.

**Required repair:** establish field authority for current capacity and rates. Join relevant server-read catalog facts with the document guidance, or constrain general knowledge prose from asserting those current fields. A detected disagreement should produce a narrow qualification and a source-maintenance task, rather than quietly choosing an answer path. Do not change document content or workspace configuration without confirming the intended value.

**Acceptance:** ask for types/prices and then a two-person call recommendation. Every capacity assertion must agree with current published catalog data; stale documents must not authorize an over-capacity suggestion. Keep availability and final price checks separate.

### P1: A follow-up loses the current booking channel and revives older topics

**Observed:** #7 discusses an on-site walk-in. #8 asks what happens next but receives the website payment-link journey plus older cancellation policy. A browser assertion over the actual rendered follow-up returned `pass: false` for preservation of the kiosk/walk-in context.

**Implementation evidence:** `CustomerAssistantProvider.tsx:167` sends `turns.slice(-4).map(t => t.question)`, including questions from failed turns. It sends no prior assistant reply or explicit current procedural step/channel. At #8 the history therefore includes booking/payment, changed plans, amenities, and walk-in questions, while omitting the actual kiosk explanation being continued. `services/rag/customer_public.py:184` delegates referent resolution to catalog discovery using earlier USER turns only. `gateway.ts:186` passes the current vague message and the generated search interpretation to document support, without a separate resolved-intent agreement check. The verifier can approve a website answer against website evidence while missing the channel intended in conversation.

**Confidence:** the wrong answer and omitted answer-context fields are confirmed. Their causal contribution is strongly supported, but the exact intermediate planner output was not captured. This was observed once in a mixed-topic conversation; a clean two-turn live repetition remains necessary to measure reproducibility. Absence of assistant history alone does not prove every follow-up fails.

**Required repair:** carry bounded conversational task context, including active channel/topic and what the previous reply addressed. Treat it only as untrusted intent, never as policy evidence or authority. Re-resolve the latest relevant user request before source selection. If “after that” remains ambiguous, ask a focused clarification instead of selecting a different payment journey. Failed turns should not silently become the active resolved task. Any wire-contract expansion must update the strict TypeScript/Python schemas together.

**Acceptance:** test clean walk-in -> “what happens next,” website booking -> the same follow-up, and the exact mixed-topic sequence above. Require channel continuity, no unrelated policy expansion, and fresh source verification. Include English and Taglish input.

### P2: Intermittent document-support failure is flattened into an unactionable outage

**Observed:** #1 failed; #10 with identical wording succeeded. Production metadata shows a successful catalog-plan request at `09:56:27.265063Z`, followed by document-support HTTP 503 at `09:56:32.449704Z`, lasting 2.334 seconds. This is a strong temporal match to the first browser submission, rather than proof by shared request ID. It is the only 4xx/5xx customer backend request in the inspected window.

**Implementation:** `gateway.ts:128-138` handles capacity 429 and four document-support 400 reasons specially, then turns other upstream failures into `ASSISTANT_UNAVAILABLE`. `safeError` at line 49 similarly flattens unexpected failures. `CustomerAssistantProvider.tsx:181-187` displays the generic retry message. The browser support reference exists, but the inspected access metadata does not correlate it with a classified upstream reason. Backend `generate` and provider normalization have multiple possible 503 causes, including invalid output and provider failures.

**Conclusion:** the failure occurred in or around document support after discovery succeeded. The exact provider/schema/transport cause is unresolved. A 2.334-second 503 is not evidence that the 50-second document deadline expired. Do not label this a timeout or blame missing knowledge without additional evidence.

**Required repair:** preserve an allowlisted stage and failure category in content-free server diagnostics tied to the existing support reference. Keep credentials, prompts, source prose, transcripts and private booking data out of logs. Separate retryable transport/provider failure, malformed output, evidence rejection, capacity, and deadline. Add a bounded retry only for the categories proven safe and transient, within the existing request deadline and resource budget; do not retry safety refusals until they become an answer.

**Acceptance:** deliberately exercise each category at the real gateway seam and assert truthful UI behavior, correlation, cancellation and budget preservation. Re-run the original first-time question repeatedly under normal admission.

### P2: Broad answers have a costly serial critical path; exact browser latency remains unmeasured

The access log has 10 catalog-plan requests and 9 document-support requests. Catalog-plan takes 1.497-4.855 seconds. Document-support takes 2.334-4.497 seconds, including the failed request. These stages are serial in the gateway, with database reads, authorization checks and final source validation between or after them. They already exceed a subsecond whole-answer objective on this profile.

The browser completion observations in `results.json` range from approximately 11.6 to 31.5 seconds, but include time spent inspecting code and making tool calls. They are upper bounds, not accurate response latency samples. Do not publish their mean or p95 as a browser performance result. Measure submit-to-complete-render separately, including failures, warm/idle conditions and the admission path. Use stage metadata to isolate database overhead before selecting a performance repair.

### Review area: strict completeness is a possible refusal multiplier, not established as this outage's cause

`services/rag/rag/batched_support.py:246` uses less detailed verifier output for customer requests. Line 272 excludes customer requests from the bounded missing-rule repair loop. Line 320 rejects a draft if any verifier marks relevance, support, completeness or safety false. The gateway provides explanatory clarification for the four recognized evidence/budget reasons, and otherwise accepts only COMPLETE document proof at line 316.

This explains how a substantially grounded broad draft can still become a clarification, but none of this audit's ten replies showed that specific evidence-gap refusal. Do not weaken evidence checks on that basis. Capture classified outcomes and independently review rejected tasks before changing completeness policy. QR canonicalization at `rag/draft_transport.py:43` also replaces generated QR-bearing blocks with exact evidence; inspect intermediate artifacts if investigating the partial kiosk answer. It is not proven to have caused #7.

## Verification and next implementation order

Executed `pnpm exec vitest run tests/ms77-gateway.test.ts tests/ms77-public-customer-assistant.test.ts`: 2 files passed, 50 tests passed. These are component checks with controlled model/catalog seams, not acceptance of production conversation quality. No application change was made, so monorepo typecheck, lint and production build were not rerun for this report.

1. Freeze this browser sequence as a regression fixture, including the contradictory capacity and failed submission in the denominator.
2. Add content-free failure classification/correlation so the intermittent 503 can be diagnosed, then reproduce and repair its specific cause.
3. Repair field-authority reconciliation and follow-up intent/channel continuity with focused gateway and browser regressions.
4. Review partial kiosk answers and reject any repair that makes invented or incomplete payment instructions easier to release.
5. Repeat broad fresh-topic and mixed-topic conversations, normal visitor/verified boundaries, and complete-render timing. A passing unit suite or a successful repeat of one prompt does not close these findings.

Preserve guest-first access, customer audience isolation, fresh authorization/source checks, separate payment and booking QR meanings, no inventory hold, and Main -> Alt 1 -> Alt 2 -> Manual allocation. This audit does not authorize broad source rewriting, model replacement or weakening verification to improve answer counts.
