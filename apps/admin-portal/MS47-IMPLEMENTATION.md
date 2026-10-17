# MS-47 implementation evidence

Date: October 15, 2026 (Asia/Irkutsk).

Authority: `docs/milestone/ms47.md`, Section 7; PRD-F13/F27,
SDD-C12/C20/C24, ERD-E1, DSD-UI17, QAD-TC23/44/45.

## Confirmed reproduction

Before implementation, `pnpm exec vitest run tests/ms47-admin-session-consistency.test.ts`
failed with `expected 200 to be 401`. At the pinned signed-token expiration,
the real Knowledge Base authorization helper produced HTTP 403 with
`Active administrator access required.`, while the real heartbeat route returned
HTTP 200 for a mocked active account. This proves the account-lookup/session
mismatch. The administrator's original browser incident remains unconfirmed.
No live accounts or credentials were used in this reproduction.

## Delivered behavior

The session route and Knowledge Base ingress share `verifyAdministrator`.
Both require the bearer credential and a fresh active ADMIN profile. Signed
tokens retain their existing strict one-hour lifetime. Supabase credentials use
trusted `getUser` verification; invalid application tokens never fall back to it.
Verification calls have bounded network timeouts and errors do not disclose
provider diagnostics. Session responses are private and not cached.

| Outcome | Status | Client behavior |
|---|---|---|
| AUTH_REQUIRED | 401 | End the session and offer sign-in |
| ACCOUNT_INACTIVE | 403 | End the session and show the existing deactivation modal |
| ACCESS_REVOKED | 403 | End the session with access-denied guidance |
| AUTH_UNAVAILABLE | 503 | Suspend protected access, retain the candidate, offer retry |
| ORIGIN_DENIED | 403 | Reject the write without changing session identity |
| FORBIDDEN from a database RPC | 403 | Preserve operation denial without blanket logout |

Restored storage is a candidate until verified. The provider uses the existing
visibility-aware heartbeat, checks on visibility return, handles protected API
authentication failures immediately, and schedules the signed expiry returned
by the server. Native storage events synchronize session changes across tabs.
Concurrent checks share a request, and generation fences prevent late responses
from earlier identities, outages, or logout from restoring access.

Knowledge Base reads, notices, preview state, dialogs, files, pagination, and
feedback are invalidated across session transitions. Writes are never replayed
after recovery. Existing request IDs, revisions, origin checks, worker credentials,
publication rules, and durable jobs are preserved. Password, OAuth callback,
and setup already propagate credentials; no entry-point policy was changed.
Assistant and campaign analytics verification helpers were left intact and
their focused compatibility tests passed. No dependency, migration, production
feature activation, or deployment was introduced.

## Verification

| Check | Result |
|---|---|
| Focused MS-47, auth, Knowledge Base, assistant availability, campaign analytics, and deactivation suites | 6 files, 68 tests passed |
| pnpm typecheck | Passed across all workspace projects |
| pnpm lint | Passed; the configured command checks RAG boundaries, not a repository-wide UI style linter |
| pnpm test | 1,992 passed, 3 skipped, 1 failed; see existing failure below |
| pnpm build | Passed for all four applications |
| Browser integration fixture | Passed restored expiry, fresh verification, concurrent failure, interrupted write, and outage recovery scenarios |

The existing full-suite failure is SPEC2-TC05 at
`tests/spec2-campaigns-and-rewards.test.ts:327`: CampaignRuleInputSchema accepts
the fixture's invalid reward vocabulary. Both that test and
`packages/validation/src/campaignSchema.ts` are unchanged from HEAD. This
unrelated failure remains outside MS-47. Four additional focused cases were
added after the full run and passed in the final 68-test focused run.

## Browser evidence and reproduction

`tests/fixtures/ms47-session-browser.tsx` renders the real AuthProvider and
KnowledgeBaseSettings with synthetic HTTP replies. It was temporarily copied
to `apps/admin-portal/src/app/ms47-fixture/page.tsx` and opened on
`http://ms47.localhost:3000/ms47-fixture`, a separate storage origin. The route
was removed before production building. No protected database operation ran.

1. Expired initial restoration displayed `Signed out` and sign-in guidance,
   with zero protected reads and zero writes.
2. Synthetic sign-in displayed the verified administrator and Knowledge Base,
   and cleared the previous session error.
3. Concurrent expired reads cleared the protected UI coherently.
4. Expiry during a synthetic publication request followed by sign-in left the
   write count at exactly one, proving no automatic replay in that flow.
5. A verification outage hid protected UI and displayed retry guidance without
   a deactivation modal. Restoring the provider and retrying restored access
   and cleared the obsolete error.

Local screenshot: `node_modules/.cache/ms47-browser.png` (ignored evidence).
Repeat the disposable fixture on an isolated localhost subdomain and remove
the route before building. Never mount this synthetic fixture in production.

The route/lifecycle suite uses the real server verification and session
controller with controlled persistence/provider dependencies. Browser HTTP
responses are synthetic. Live password/OAuth/setup flows, real Supabase
availability, and the specific reported production incident have not been
accepted through a live account. Signed/Supabase validity, missing/malformed
credentials, profile revocation, infrastructure errors, origin/RPC denial,
concurrency, and stale-result fences are covered deterministically.
