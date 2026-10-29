# Local RAG repair verification

October 29, 2026. PRD-F26/F27, SDD-C20-C24, DSD-UI16, QAD-TC44/46.

**Latest local HTTP campaign: 10/10 returned answers; no transport errors or refusals.** Each response was also read for the audited context/capacity/booking defects. This is a small synthetic campaign, not independent policy certification or proof that all possible questions are solved.

The candidate was unchanged throughout this sequence. One visitor, real admission, same user history, normal quotas and no hidden retries. Questions were spaced 65 seconds apart. The entire response and JSON parsing were timed; typing, spacing, browser rendering and session bootstrap were excluded.

| # | Question | Local HTTP seconds | Baseline browser seconds | Result |
|---|---|---:|---:|---|
| 1 | Hi! I have never been here before. What is DeskAtlas and how does it work? | 11.18 | 15.43 | ANSWER |
| 2 | What kinds of spaces do you have, and how much would a few hours cost? | 6.75 | 9.03 | ANSWER |
| 3 | I just need somewhere quiet to study and take an occasional video call. What would you recommend? | 11.78 | 12.21 | ANSWER |
| 4 | How do I book and pay? Do I need an account, and when is my desk actually confirmed? | 9.64 | 11.11 | ANSWER |
| 5 | What if my plans change or I arrive late? Can I cancel, move the booking, or get a refund? | 10.95 | 13.82 | ANSWER |
| 6 | Where are you located, what time are you open, and do you have Wi-Fi, outlets, parking or food? | 11.02 | 11.16 | ANSWER |
| 7 | Paano kung first time ko lang at gusto ko lang mag walk in? Kailangan ba mag reserve muna? | 8.14 | 9.45 | ANSWER |
| 8 | Okay, what happens after that? | 10.73 | 11.58 | ANSWER |
| 9 | What should I do if the internet stops working or another guest is being noisy while I am working? | 11.53 | 13.46 | ANSWER |
| 10 | Hi! I have never been here before. What is DeskAtlas and how does it work? | 9.81 | 13.06 | ANSWER |

Mean: **10.15 s**. Median: **10.84 s**. Range: **6.75-11.78 s**. Four of ten completed under ten seconds; all ten completed within fifteen seconds.

The original production browser mean was 12.03 seconds, with one non-answer. The local HTTP mean is lower, but HTTP excludes rendering/bootstrap and the environments differ. This does not certify browser timing parity, production p95, or a universal deadline.

## Audited behavior

- Current capacities remain separate from historical policy prose. Recommendation output on this campaign used the current map value and did not repeat Sky Booth as a two-person room.
- The Taglish walk-in question answered directly without requiring an account or advance registration.
- The immediate follow-up stayed with the kiosk payment and staff-verification path, without adding the website private-payment-link journey or older cancellation topics.
- Booking instructions retained guest access, no inventory hold, the proof deadline, administrator review and final allocation/confirmation.
- Both introductory submissions returned cited substantive answers. The final repeated reply is retained verbatim below.

```text
With DeskAtlas, you can book a physical desk or room via the customer website or a shared on-site kiosk. No account is required to make a standard guest booking.

To start, select a workspace and schedule on the website or kiosk, then provide your contact details. Submitting a request does not hold inventory; it only acknowledges receipt.

For website reservations, you must complete payment and upload proof via the official private link within 60 minutes. An administrator reviews this proof before allocating a specific unit.

Your reservation is only confirmed after you receive an official final confirmation email. Until then, you do not have a guaranteed assigned spot.
```

## Verification

- 2,825 application tests passed, one expected fail and 43 skips.
- 232 Python provider/customer/document regressions passed.
- 85 focused customer and verified-booking regressions passed.
- Typecheck, lint, all-app build and final customer production builds passed.
- Source fingerprint was verified against the loaded local Python service.

## Limits and outstanding acceptance

Earlier failures are not erased: failed-http-candidate.json includes the 37.85-second booking refusal; intermediate browser and HTTP attempts contain output/completeness failures and latency outliers. They informed subsequent repairs. Passing this later campaign does not invalidate those observations.

Final browser-render acceptance is pending. Browser tooling still returned disabled after the maintainer reported enabling it and after session reset/reconnect. No alternate UI-control path was used to bypass that setting. The last browser test before final source-scope repairs included a refused repeated introduction and is not an acceptance pass.

Original provider 503 root cause remains unproven; source-address bounding and safe error classification fix concrete defects but cannot eliminate all external provider failures. Successful first-pass model-call counts are unchanged; one bounded, independently verified failure-recovery pass is available within existing limits.

No production deployment, model/tier change, migration, booking mutation or source publication was made.

## Artifacts

- booking-scope-http-acceptance.json: exact final questions/replies, statuses, times and sanitized stage spans.
- FINAL-SUMMARY.json: machine-readable summary.
- runtime-verification-final.json: loaded-code/model receipt.
- failed-http-candidate.json, intermediate-diagnostic-attempts.json and the browser snapshots: failed/slow intermediate evidence.
- full-tests-current.log, python-tests-final.log, customer-regressions-final.log, typecheck-final.log, lint.log and build logs: actual verification.
