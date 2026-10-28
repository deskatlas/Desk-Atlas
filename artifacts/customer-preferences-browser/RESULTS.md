# Local customer assistant browser checks

Date: October 29, 2026 (Asia/Irkutsk).
Traceability: PRD-F26, SDD-C20-C24, MS77-TC04/05/08/09.

The browser used http://localhost:3001 with the current local Next.js source and
the current local Python service on 127.0.0.1:8000. The service used its saved
hosted answer-model configuration and existing published backend data. This was
not an offline-model test or a hosted application deployment.

## Completed observations

| Question / action | Saved context | Browser result |
|---|---|---|
| What is a good spot for us? | Group size 10, no schedule | Explicitly retained group of 10 and asked to narrow the floor, type or comparison because the catalog exceeded the bounded candidate limit. |
| We are planning a productive team day. What would work best for us, and what should we consider before choosing? | Group 10; October 30, 10:00, two hours; PHP 1,000 total; focus and power | Retained group of 10 and asked to narrow. No unsupported availability or price claim. |
| What options do you have for teams, and how do they differ? | Same full context | Returned the same narrowing message. This retained preferences but did not provide a useful category comparison. |
| Before we decide, how does booking and payment work, and does choosing a spot reserve it for us? | Same full context | Returned a policy answer with seven source entries. Explained pending requests, the no-hold rule, payment, final confirmation and ranked same-type alternatives. Gateway duration: 30.8 seconds. |
| And what happens if our first choice is no longer available after we pay? | Same full context and preceding questions | Returned a policy answer with seven source entries, same-type alternatives, administrator review and manual/financial resolution. Gateway duration: 39.7 seconds. |
| Would Sky Link 1 or Focus Pod 1 be a better fit for our plans? Please use what I saved. | Same full context | No spots confirmed for group 10 under these constraints. Did not identify the exact rejected constraint, so this does not independently establish budget or schedule correctness. Gateway duration: 5.5 seconds. |
| Close and reopen chat | Previously saved full context | Transcript and preference fields cleared. |
| We need somewhere for the whole team. Would Sky Link 1 or Focus Pod 1 make more sense for us? | Fresh chat, only group size 10 | Suggested Sky Link 1, capacity 10; excluded Focus Pod 1. Explicitly marked availability unchecked and asked for date, time and duration. Gateway duration: 5.2 seconds. |
| Our plans changed. Compare Sky Link 1 and Focus Pod 1 again using my updated preferences. | Changed saved group size to 1 in the same chat | Suggested both Sky Link 1 (capacity 10) and Focus Pod 1 (capacity 1), explicitly using group of 1. Gateway duration: 5.2 seconds. |

The published map's Sky Link 1 detail showed 10 seats and PHP 500/hour.
The group-ten comparison screenshot is [group-ten.png](group-ten.png).

## Remaining checks and findings

- Group-size forwarding, deterministic capacity exclusion, updated saved values,
  and close/reopen clearing were observed through the real browser UI.
- Broader team/category questions repeat a narrowing response. Preference
  retention works, but useful category guidance remains limited in those cases.
- Broad policy answers took 30.8 and 39.7 seconds, exceeding the existing
  sub-10-second aspiration. Citations were present but their source drawers were
  not independently inspected in this run.
- The completed full-context comparison returned no matches. A controlled
  scheduled comparison with only group size and budget, and a one-variable budget
  change, remain unverified.
- Browser control became disabled in Work settings before the next form fill.
  The remaining schedule/budget check was not submitted. No attempt was made to
  bypass that setting.
- No reservation, payment or inventory mutation was performed.
