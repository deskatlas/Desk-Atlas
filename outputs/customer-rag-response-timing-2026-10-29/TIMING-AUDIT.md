# DeskAtlas response-time audit

Date: October 29, 2026, Asia/Irkutsk. Run: 18:49:37 to 18:52:13.
Target: https://www.thedeskatlas.com/. Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16, QAD-TC44/46, MS77/MS79.

## Method

Fresh conversation in the existing browser tab, same anonymous visitor. Repeated the prior audit's 10 questions in the same order. No quota bypass or parallel load. One sample per question, with the introduction explicitly repeated as case 10. No retries were hidden or omitted. No application, source, model, database or deployment changes were made.

A monotonic stopwatch starts immediately before the Send click. It stops after Cancel disappears and Send becomes visible again. Response text is then read to confirm the turn completed. The timer includes guest session bootstrap, application/network/backend work and browser-control overhead. It excludes typing, report writing, tool/model deliberation between questions, and transcript/screenshot capture after completion. DOM completion is a proxy for a completed visible response, not compositor paint instrumentation. Reported hundredths of a second are rounded observations rather than a claim of millisecond-level browser accuracy.

These measurements supersede the previous audit's loosely sampled browser completion upper bounds. They do not retroactively measure the earlier responses.

## Per-response results

| # | Question topic | Browser completion | Catalog planning | Document support | Other elapsed time | Outcome |
|---|---|---:|---:|---:|---:|---|
| 1 | Introduction | **15.43 s** | 1.84 s | 4.96 s | 8.62 s | Content returned; quality not certified |
| 2 | Workspace types and base prices | **9.03 s** | 1.74 s | Not called | 7.29 s | Content returned; quality not certified |
| 3 | Quiet study and video calls | **12.21 s** | 1.81 s | 3.11 s | 7.29 s | Content; capacity contradiction persists |
| 4 | Booking, payment, account and confirmation | **11.11 s** | 2.57 s | 2.64 s | 5.89 s | Content returned; quality not certified |
| 5 | Changes, late arrival and refunds | **13.82 s** | 4.42 s | 3.68 s | 5.72 s | Content returned; quality not certified |
| 6 | Location, hours and amenities | **11.16 s** | 2.16 s | 3.30 s | 5.69 s | Content returned; quality not certified |
| 7 | Taglish walk-in question | **9.45 s** | 1.99 s | 2.04 s | 5.42 s | Scope-limit non-answer |
| 8 | What happens after that? | **11.58 s** | 2.11 s | 4.03 s | 5.44 s | Content; website/cancellation context persists |
| 9 | Internet outage and noise complaint | **13.46 s** | 4.25 s | 3.60 s | 5.61 s | Content returned; quality not certified |
| 10 | Introduction repeated | **13.06 s** | 2.42 s | 4.35 s | 6.29 s | Content returned; quality not certified |

## Findings

- Mean: **12.03 seconds**. Median: **11.90 seconds**. Range: **9.03-15.43 seconds**.
- Eight of ten submissions exceeded 10 seconds; one exceeded 15 seconds. All ten produced a terminal UI response. Nine returned substantive text; one returned an explicit scope-limit refusal. Substantive text is not equivalent to correctness.
- Case 7 took 9.45 seconds to say the complete guidance was too long. Its document-support request returned HTTP 400 after 2.04 seconds. The visible wording matches the gateway's OUTPUT_BUDGET_EXCEEDED mapping; the access metadata alone does not expose the exact response body. This is evidence-budget rejection, not a demonstrated timeout.
- The same first-time question took 15.43 seconds initially and 13.06 seconds on repeat. This is insufficient to establish a repeatability distribution or a cold-start effect.
- Outside the two measured RAG endpoint durations, mean elapsed time is **6.33 seconds**. The catalog-only price response still took 9.03 seconds, of which 1.74 seconds were catalog planning. Optimizing model generation alone will not remove this overhead.
- Other elapsed time includes session bootstrap, gateway admission, database reads, authorization/lease checks, inter-service network transit, final evidence validation, UI and automation overhead. This audit cannot allocate that remainder to a particular database operation or claim it is all database latency.
- Production requests ran on deskatlas-rag-chat-production-admin1029b. There were 10 catalog-plan calls and 9 document-support calls. Metadata is matched by timestamp window and sequential endpoint order, not a shared captured browser request ID. No other customer requests appeared in the retrieved windows.
- One pass is not a production p95 benchmark, load test, idle/cold study, or an acceptance result for independent answer quality. No p95 performance achievement is claimed.

## Implementation implications

The existing gateway executes catalog reads and planning before document expansion/support, then performs final authority/evidence checks. See apps/customer-website/src/server/customer-assistant/gateway.ts:86-104, 125-145, 167-178, 261-265, 303-338. The browser performs an anonymous session POST for every question at CustomerAssistantProvider.tsx:154 and polls progress every three seconds at line 158. These are inspection targets; this audit did not measure their individual cost.

Next measurement should correlate content-free timing spans for guest bootstrap, admission, request claim, catalog database reads, model planning, evidence expansion, document verification, final source revalidation, lease release and UI completion. Preserve current authorization, evidence and no-hold checks. Evaluate batching unnecessary round trips only after the slow spans are measured.

## Evidence

- browser-timings.json: monotonic browser timings and exact questions/replies.
- timings-with-backend.json: per-case production endpoint durations and residual.
- production-request-metadata.json: content-free status, endpoint, revision and timing metadata.
- browser-transcript.md: visible full conversation.
- browser-non-answer.png: the timed walk-in refusal.
- browser-final.png: completed final response.

No monorepo checks were rerun because this work only generated audit artifacts and made no application changes.
