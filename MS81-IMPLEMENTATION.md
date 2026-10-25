# MS-81 implementation and verification

Date: October 25, 2026. Traceability: PRD-F13; SDD-C12; ERD-E1/E14;
QAD-TC23/35; MS81-TC01 through TC07.

The maintainer authorized implementation after the specification-only plan.
This delivers local SQL, regression tests and release instructions. No hosted
database, accounts or deployment were modified. The historical October 22
incident attribution and installed function metadata remain unverified.

## Delivered repair

Migration `041_staff_rpc_ambiguity.sql` qualifies the create function's actor
privilege, role/status predicates and duplicate-email lookup. The update
function qualifies the auth-user password predicate and profile update values.
Real PostgreSQL reproduces 42702 for both originals, the create email lookup
after actor-only repair, and update paths with and without a password change.
The staff-list function already qualifies its relation columns.

Public argument names, return columns/order, permission checks, null behavior,
validation order and audit attribution are retained. No variable-conflict
preference, privilege grant, account backfill or dependency was introduced.

The migration checks exact supported prior bodies, argument names and result
contract, language, volatility, security mode and search path before replacement.
Unknown drift aborts the transaction. `CREATE OR REPLACE` retains function OIDs,
owners and ACLs. The down migration versions the exact previous definitions as
SQL literals; no callable backup is installed. It checks the repaired definition
before restoring it. Both files use a five-second lock timeout. Replacement can
wait for concurrent function/schema work; timeout or drift rolls back both repairs.

`scripts/consolidate-supabase.py` reads only the reviewed forward replacement
tags for these two functions. Generated `002_functions.sql` agrees with migration
041. Archived migration history is unchanged. The generator also rewrites the
diagram from historical schema; its unrelated diagram changes were excluded.

## Local verification

`pnpm test:ms81:postgres` starts a temporary loopback PostgreSQL cluster on port
55481, using the real repository schema and synthetic auth table/profiles. It
never reads application database configuration. It verifies original 42702,
allowed ordinary-admin/superadmin creation, forbidden admin creation, inactive/
staff/missing actors, anonymous/authenticated direct execution denial, invalid
inputs, duplicate rejection, password/profile updates, truthful audit actors,
injected audit-write rollback, forward/down/forward, owner/ACL/signature stability,
whole-transaction drift rejection and clean-install function parity.

`pnpm test:ms81` covers existing domain security/scoping/deactivation suites and
the real route's success and explicit service-denial response contracts. Its
forged-actor rejection case is marked `it.fails`: this is an executable known
failure, not a passed security acceptance gate. The real SQL suite supplies the
database evidence; route mocks do not establish database correctness.

Repository verification: `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`git diff --check` pass. The focused suite reports 15 passed and one expected
failure for the documented authorization gate. The full `pnpm test` run reports
2,585 passed, one expected failure, 43 skipped and four pre-existing failures:

| Suite | Failure |
|---|---|
| `mf71-transactional-email-lifecycle` | Booking-ended email subject punctuation expectation |
| `mf78-transactional-email-refinements` | Same email subject punctuation expectation |
| `mf79-admin-payments-proof-order` | Source assertion expects client-side sorting code |
| `ms35-supabase-consolidation` | DrawSQL export lacks `overdue_notified_at` |

The consolidation function/history replacement test passes; the DrawSQL failure
is the same unrelated mismatch already recorded during MS-80. Build, lint,
typecheck and full-test output are retained in `outputs/ms81-*.log`.

## Separate authorization and consistency findings

MS81-R03 explicitly requires recording separate weaknesses before expanding
scope. Under PRD-F13 / SDD-C12 / QAD-TC23, the inspected staff POST route takes
actor identity and superadmin claims from request headers or the request body.
No middleware/proxy verification was found in this application. The regression
demonstrates that a synthetic forged body reaches the privileged service seam.
This leaves MS81-TC04 application acceptance open even though direct execution
by `anon` and `authenticated` is denied by the database grants.

Additionally, `StaffManagementSupabaseRepository.createStaff` catches most RPC
errors and falls back to separate service-role Auth/profile writes. Those writes
do not inherit the RPC transaction or its actor validation. SQL transaction
success does not establish application-wide failure atomicity (MS81-TC05).

Required follow-up plan: authenticate every staff-management server entry point
using the established server session verifier; derive active actor/role/privilege
from that verified identity; reject caller-supplied authority; remove privileged
fallback on denied/failed RPCs; define compensated Auth/profile failure handling
where separate API calls remain necessary. Cover forged body/header, inactive
session, missing session and injected Auth/profile/audit failure cases end to end.
This is a separate authorization/identity change, not part of the name-resolution
patch. Treat these findings as release blockers for staff-management security.

## Deployment and rollback

Inventory installed migration versions and read `pg_get_functiondef`, owner,
ACLs, security mode and search path for both RPCs before staging application.
Compare with the exact prior definitions versioned in 041. Unsupported drift
requires review and a new supported migration, never deleting the guards.

Apply only `supabase/migrations/041_staff_rpc_ambiguity.sql` to a compatible
existing database through the reviewed workflow after existing forward migrations
through 040. There is no repository-wide forward migration runner to certify;
use an explicit single-file invocation. Never glob `*.sql`: paired `_down.sql`
files must be excluded. The clean-install order is documented in
`supabase/MIGRATION_ORDER.md`; never run reset or consolidated schema on a hosted
database as an upgrade.

Rollback uses only `041_staff_rpc_ambiguity_down.sql`. It restores the known
ambiguity defect while preserving accounts and grants, so keep the affected
staff operations unavailable during regression recovery. Reapply forward only
after comparing supported definitions again.

Pending gates: hosted installed-definition/owner/grant inventory, actual failed
call attribution, real Supabase Auth and PostgREST behavior, authenticated staging
staff-management smoke requests without 42702, the separate server authorization
and fallback repair, and MS-82 combined operational acceptance. Local fixtures
are not hosted incident resolution or release approval.
