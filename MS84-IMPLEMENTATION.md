# MS-84 local implementation and verification

Date: October 26, 2026. Authority: maintainer request "implement ms84".
Traceability: PRD-F1/F2/F4/F13/F14, SDD-C1/C2/C3/C12,
DSD-UI1/UI2/UI12, ERD-E7/E10, QAD-TC1/2/23/24 and MS84-TC01 through TC08.

## Delivered behavior

- Reservation and tracking shells render a real `next/link` Back to Home link targeting `/`, using the existing secondary button style. The links sit outside step, loading, result and error branches and have no mutation handlers. Tracking reference and lookup routes share the same shell. Existing MS-83 recovery code and payment handoff remain in place.
- The dashboard closure alert targets `/manage/reservations?filter=closure_impacted`. A temporary Next.js redirect matches only `/admin/reservations` with that exact filter. API namespaces and unrelated paths retain their existing routing.
- Typed URL state makes the explicit closure scope override ordinary tabs and updates from `useSearchParams`, including browser history. Closure pills push the canonical URL. Leaving the closure view resets search and advanced filters. Page changes reset pagination; filtering, schedule sorting and CSV export apply to the displayed scope.
- The closure view uses the existing reservation endpoint with a verified administrator bearer credential. The closure-filter branch verifies the administrator before reading reservations. Login preserves only the exact canonical closure destination, rejecting external and modified return URLs. Existing ordinary list and detail/action authorization contracts are otherwise unchanged.
- Closure queries apply the alert's exact unresolved predicate before paging: flagged impacts, pending/manual impact status, and supported nonterminal persisted reservation statuses. Both alert and filtered list use that scope and deterministic ordering. Existing normalized closure metadata, candidate fallback and guarded reconciliation remain in use.
- Filtered reads traverse 500-row pages instead of the ordinary newest-500 list. The safety threshold is 50,000 records; reaching it or failing a later page fails the read instead of returning a partial total. Embedded children and existing catalog/context reads are reused; this adds no per-reservation lookup.
- Closure membership is evaluated before elapsed-time presentation mapping. An unresolved persisted confirmed booking is not hidden by a displayed expired label. Resolved flags and terminal persisted statuses do not enter the action queue.
- A successful empty read explains that no reservations currently require closure action. Errors retain an unavailable/retry state, disable export and do not claim zero impacts. Request generations and loaded-scope checks prevent late responses from overwriting another view. Ordinary tab counts are shown only with the ordinary dataset.

## Automated evidence

| Check | Result / evidence |
|---|---|
| `pnpm typecheck` | Passed across all workspace projects; `outputs/ms84-typecheck.log` |
| `pnpm lint` | Passed; `outputs/ms84-lint.log` |
| `pnpm test:ms84` | 59 tests passed across four files; `outputs/ms84-focused.log` |
| `pnpm test` | 2,645 passed, four failed, one expected failure, 43 skipped. Full-suite outcome recorded in `outputs/ms84-tests.log`; see below |
| `pnpm build` | Passed production builds for all four apps; `outputs/ms84-build.log` |
| `pnpm test:ms84:http` | Seven production HTTP/SSR checks passed; `outputs/ms84-http.log` |

The focused tests cover typed query precedence, same-origin return validation,
unauthenticated and cross-role denial before data access, resolved/terminal
exclusion, 501 matching impacts across two pages, list/alert membership parity,
missing closure metadata/schedules, failure on a later page, true empty reads,
and elapsed-time presentation without losing unresolved membership. Existing
MS-80/MS-26 regressions cover normalized metadata, multiple closures, stale
cleanup races, genuine failures and lifecycle behavior.

The HTTP smoke checks render the built customer application at `/reserve`,
`/track` and `/track/DA-MS84?email=synthetic%40example.invalid` and verify a real
Home anchor targeting `/`. They also check the stale URL's 307 and retained
filter, the canonical page's successful response, unauthenticated closure API
401 and the unrelated unfiltered old path's 404. Run the built customer and
admin apps on local ports 3105 and 3106 respectively before running this smoke.
These are HTTP/SSR checks, not completed browser journeys.

The full suite reports four failures in existing tests outside MS-84:
`mf71-transactional-email-lifecycle`, `mf78-transactional-email-refinements`,
`mf79-admin-payments-proof-order`, and `ms35-supabase-consolidation`.
They concern survey-email copy/configuration, payment queue source ordering and
DrawSQL/schema column parity. These tests and their asserted behavior were not
changed for MS-84. The workspace also contains prior MS-83 and other edits;
this record does not claim a clean baseline comparison for those failures.

## Remaining acceptance

The interactive browser retry succeeded on October 26, 2026 using the built
customer and admin apps on local ports 3105 and 3106.

| Interactive journey | Observed result |
|---|---|
| Tracking lookup Home link | Click reached the customer root `/` |
| Reservation draft | Home link remained visible through map, schedule, optional backup and guest-details steps |
| Mobile layout | At a 390 by 844 viewport override (375px document width after scrollbar), Home links stayed readable and separate from other controls |
| Keyboard | Shift+Tab reached the tracking Home link with a visible focus ring; Enter activated Home navigation |
| Direct tracking entry | `/track/DA-MS84?email=synthetic%40example.invalid` retained the Home link during loading and after the not-found result |
| Tracking privacy | Home navigation reached `/` without the reference or email query; browser Back returned to tracking |
| Known stale admin URL | Redirected to the canonical closure URL, then to sign-in with the exact closure destination preserved |
| Authenticated closure records | User signed in; canonical view loaded exactly two unresolved records and a matching count |
| Dashboard incident journey | The October 4, 2026 alert for Sam's Birthday showed two impacts; its review CTA opened the canonical filter with the same two records |
| Search and clear | Searching a displayed reference narrowed to one record with "filtered from 2"; clearing restored two |
| Sorting and export | Schedule sorting retained two rows; CSV export downloaded and contained exactly two data rows |
| Detail access | An impacted record opened its detail page with the existing closure notes and permitted phone-outreach control; no resolution action was submitted |
| Refresh and history | Refresh retained the verified session and closure view; Back/Forward moved between the closure and ordinary views correctly |
| Desktop layout | Customer tracking checked at 1440 by 900; admin closure view also inspected at desktop width |
| Browser-found correction | Removed the ordinary closure pill's misleading legacy flag count and withheld ordinary tab counts until their dataset loaded; rebuilt and rechecked |

No reservation was submitted, paid, cancelled or otherwise changed during these
interactive customer checks. Successful booking statuses, payment handoff, recovery/remedy flows, role-specific
mutation journeys, large-page browser fixtures and hosted deployment still need
acceptance. The reported incident navigation was verified through the local build
using the normal authenticated backend response.
The initial failed browser attempt remains historical evidence; the retry
supersedes its blanket "no interactive browser verification" limitation.


No migration, deployment, external message or reservation action was submitted
for this milestone. Interactive list reads retain the existing server-side guarded
closure reconciliation conventions. No new dependency was installed.
Rollback is application-only. Keep the canonical route and compatibility
redirect available while old alert producers or bookmarks remain in use.

## Browser retry validation after the count correction

- `pnpm --filter @deskatlas/admin-portal build`: passed; `outputs/ms84-browser-admin-build.log`.
- `pnpm typecheck`: passed; `outputs/ms84-browser-typecheck.log`.
- `pnpm lint`: passed; `outputs/ms84-browser-lint.log`.
- `pnpm test:ms84`: all 59 tests passed; `outputs/ms84-browser-tests.log`.
- Browser recheck: normal closure pill no longer advertises the broader legacy count;
  the authoritative filtered view and export retain exactly two records.

The previously recorded full-suite failures remain outside this two-line UI
correction. No full-suite rerun is claimed after this correction.
