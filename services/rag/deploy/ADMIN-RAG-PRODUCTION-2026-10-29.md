# Admin RAG production deployment and response timing

Date: October 29, 2026, Asia/Irkutsk.
Authority: maintainer confirmed application deployment and requested RAG deployment
followed by production response-time testing. Traceability: PRD-F26/F27,
SDD-C20-C24, DSD-UI16 and QAD-TC44/46.

## Deployment completed

| Item | Verified value |
|---|---|
| Service | deskatlas-rag-chat-production |
| Project / region | deskatlas-rag / us-central1 |
| Active revision | deskatlas-rag-chat-production-admin1029b |
| Traffic | 100% to active revision |
| Build | 8cc0e833-3bad-400a-9348-8b50ecab98a7 |
| Immutable image | us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@sha256:5118661b34c39463b5b72301dad744784d78a1888a5aec6e8428652cfcfad798 |
| Loaded implementation fingerprint | 35f5579f6d6aceb007673b94c23ea9534afe1f89897985332da4ef01e87e0dab |
| Inspected source HEAD | 6a407689e511981e06225e1353315e9e4b87d7f1 |
| Planning and document model | Qwen/Qwen3.6-35B-A3B, existing standard DeepInfra tier |
| Latency controls | RAG_TASK_FRAMED_DRAFT=false; RAG_QWEN_INDEXED_SOURCES=true |
| Previous active revision retained for rollback | deskatlas-rag-chat-production-conv1029-q35 |

The upload allowlist was inspected. Only the 55 allowed serving/build files were
uploaded. Environment files, credentials, uploads, caches, private diagnostics,
audit artifacts and test fixtures were excluded. Seventy-six focused Python
regressions passed immediately before the build.

The candidate started without production traffic. An initial candidate's two
environment arguments were joined incorrectly by PowerShell. The configuration
receipt detected this before promotion. That revision received no production
traffic. Quoted arguments produced the corrected `admin1029b` revision, which
passed the explicit flag assertions and preservation check before promotion.

The preservation fingerprint covers the runtime specification, non-client
annotations and IAM bindings, excluding only the image and two intended latency
controls. Before and final fingerprints are identical:
`8715454651847c7fe5d33afb0b406cb9abfd6d322f09287c2bba5da20715f0f7`.
No runtime secret values are stored in these receipts. Resources, concurrency,
timeout, other feature settings, secret references and service identity were
preserved. IAM remains private. No application, database, migration, worker,
published document or provider credential was changed.

Both tagged candidate checks and final stable-URL checks passed: unauthenticated
access rejected, service token enforced, invalid capability rejected, authenticated
health ready with the exact loaded fingerprint, customer/internal principal
boundary enforced, and legacy/new customer plans compatible. The temporary tag
was removed after promotion. The stable URL and original rollback revision remain.

## Production timing result: target not met

Eight synthetic, natural-language questions were sent sequentially through
`https://admin.thedeskatlas.com/api/assistant/query` using normal active-admin
gateway authentication, availability reads, session history and quotas. No
identity/IP rotation or quota bypass was used. Questions were not retried until
successful. All eight returned HTTP 200, but HTTP success did not mean a useful
answer.

Times measure complete query HTTP response and JSON parsing from this workstation.
The separate availability refresh is excluded. They are not first-token times or
exact click-to-complete-render browser measurements. This small warm service
campaign does not establish cold-start/load behavior or a production p95.

| Case | Exact question | Complete response | Outcome |
|---|---|---:|---|
| 1 | Can you give me the big picture of how bookings, payments, and check-ins fit together? | 29.790 s | Useful cited answer, including original QR rules |
| 2 | If they already sent proof, does that mean the desk is secured? | 41.850 s | SOURCE_REVIEW; no substantive answer |
| 3 | Someone says they paid, but their booking isn't confirmed. What should I do? | 0.698 s | Focused payment-channel clarification |
| 4 | They paid online. How do I review it? | 20.396 s | SOURCE_REVIEW; no substantive answer |
| 5 | How are things looking today? Anything I need to deal with? | 0.878 s | Useful live snapshot with explicit scope limits |
| 6 | May nagrereklamo sa wifi at ang ingay daw. Paano ko sila tutulungan? | 17.184 s | Useful cited English answer; some repeated guidance |
| 7 | How do booking QR codes work when a guest arrives? | 33.976 s | SOURCE_REVIEW; no substantive answer |
| 8 | I'm about to hand over my shift. What should I tell the next person? | 17.958 s | Useful cited answer; repeated exact context |

Totals: four substantive answers (three document answers and one live snapshot),
one clarification and three source-verification failures. Successful document
answers range from 17.184 to 29.790 seconds, with a median of 17.958 seconds.
Only two of eight requests completed within 15 seconds; those were the
clarification and live snapshot, not substantive document answers.

The earlier local 5.2-8.7 second samples did not establish production performance.
No consistent under-15-second or under-10-second document-answer claim is made.
The benchmark exits nonzero because three verification failures remain.

## Measured bottlenecks and remaining work

Server-Timing shows redundant catalog interpretation and fallback planning on
some ordinary knowledge questions. Case 1 used 3.340 seconds in context discovery
and 9.377 seconds in planning before document support took 12.337 seconds.
Case 2 used 6.899 seconds in context discovery, 14.793 seconds in planning and
16.490 seconds in document support, then returned no answer. Case 7 spent
22.285 seconds in document support before source review was returned.

Even without fallback planning, document support was substantial: case 6 used
10.851 seconds and case 8 used 11.295 seconds there. The remaining failures
returned `INCOMPLETE_CONTEXT: Required procedure context could not be verified`.
Retained public diagnostics do not identify which individual verifier verdict
failed, so this is not evidence that an upload is missing or requires reprocessing.

The next repair must address unnecessary fallback planning and excessive or
incorrect completeness rejection on conversational follow-ups, while retaining
full-source, claim, permission and source-epoch checks. This deployment does not
declare the original reliability goal or latency goal achieved. No further
runtime change was made to hide these measurements.

## Actual browser check

The existing signed-in production tab was refreshed after the maintainer's app
deployment. Normal UI submission of today's reservations/check-ins displayed the
complete snapshot within 1.803 seconds. A separate natural shift-handover question
returned a cited answer in the browser. Its complete answer was observed within
30.515 seconds; this is a polling upper bound, not an exact render time. The
browser timing API was unavailable to the read-only page evaluator, so no precise
browser render latency is claimed for that answer. The production tab remains
open with the result.

## Evidence and rollback

- [Final deployment/configuration receipt](../../../outputs/admin-rag-production-2026-10-29/final.json).
- [Pre-deployment receipt](../../../outputs/admin-rag-production-2026-10-29/before.json).
- [Rejected candidate settings](../../../outputs/admin-rag-production-2026-10-29/rejected-candidate.json).
- [Candidate private/compatibility checks](../../../outputs/admin-rag-production-2026-10-29/candidate-checks.json).
- [Stable URL private/compatibility checks](../../../outputs/admin-rag-production-2026-10-29/stable-checks.json).
- [Every production benchmark response and timing](../../../outputs/admin-rag-production-2026-10-29/production-latency.json).
- [Browser observation](../../../outputs/admin-rag-production-2026-10-29/browser-verification.json).
- [Production browser screenshot](../../../outputs/admin-rag-production-2026-10-29/production-browser.jpg).

The rollout can return traffic to the preserved prior revision without rebuilding
or changing secrets:

`gcloud.cmd run services update-traffic deskatlas-rag-chat-production --project=deskatlas-rag --region=us-central1 --to-revisions=deskatlas-rag-chat-production-conv1029-q35=100`

This rollback command is recorded, not executed. The new revision remains live
with its tested safety controls and the unresolved performance/coverage findings
above clearly retained.
