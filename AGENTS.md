# DeskAtlas — Codex Agent Instructions

Before implementation, read:

`docs/INDEX.md`

`docs/IMPLEMENTATION_STATUS.md`

Never assume a milestone is complete solely because code exists.
Use this ledger plus tests to determine project progress.

After successfully completing a milestone, update only its status and
verification notes. Do not modify locked specification documents unless
explicitly instructed.

Always use `docs/INDEX.md` as part of the operating instructions for:

- required preflight reading
- shared ledger updates after every milestone attempt
- frontend limitation documentation expectations
- post-FM milestone-fix (`MF-*`) documentation and execution expectations

Current post-FM customer/kiosk flow change requests are tracked in
`docs/milestone-fixes/MF-40_KIOSK_FULLSCREEN_WELCOME.md`,
`docs/milestone-fixes/MF-41_CUSTOMER_TEMPLATE_FIRST_RESERVE_FLOW.md`, and
`docs/milestone-fixes/MF-42_KIOSK_TEMPLATE_FIRST_NOW_RESERVE_FLOW.md`.
Read the matching MF file before implementing any of those requested changes.

Current dev-notes bug fixes, feature gaps, and improvements (MF-43 through
MF-64) are analyzed in `docs/DEV_NOTES_ANALYSIS.md` with phased execution
order in `docs/DEV_NOTES_MILESTONE_RUNBOOK.md`. Individual MF files are in
`docs/milestone-fixes/`. Read the matching MF file, the analysis, and the
runbook before implementing any dev-notes requested change.


## 1. Project Documentation Is Mandatory

All authoritative DeskAtlas project documentation lives in:

`/docs`

Before implementing, modifying, debugging, or planning any DeskAtlas feature,
you MUST inspect the relevant files in `/docs`.

Do not rely only on the current prompt or assumptions from the codebase.

---

## 2. Source-of-Truth Priority

Read and obey the project documents in this order:

1. `docs/DeskAtlas_Final_Source_of_Truth_Project_Plan.md`
   - Highest authority for product behavior and locked project decisions.

2. `docs/prd-deskatlas.md`
   - Defines features, PRD IDs, user stories, acceptance criteria, screens,
     navigation, and release requirements.

3. `docs/DeskAtlas_Final_ERD_Specification.md`
   - Authority for database entities, relationships, keys, constraints,
     cardinalities, and persistence model.

4. `docs/DeskAtlas_Backend_Integration_Scope_of_Work.md`
   - Defines what implementation agents are allowed and forbidden to modify.

5. `docs/DeskAtlas_Feature_Milestone_Runbook.md`
   - Defines implementation order, feature milestones, test gates, and
     mandatory stopping points.

If code conflicts with these documents, do not silently follow the code.
Report the conflict and follow the higher-priority project specification unless
the user explicitly changes the requirement.

If two documents conflict, the document higher in this list wins.

---

## 3. Required Preflight Before Any Implementation

Before editing code:

1. Confirm repository root.
2. Read this `AGENTS.md`.
3. Read `docs/INDEX.md`.
4. Inspect `/docs`.
5. Read the five authoritative DeskAtlas documents above.
6. If the request is a post-FM fix or references `MF-*`, read
   `docs/milestone-fixes/INDEX.md` and the matching MF file.
7. Identify the exact milestone being requested.
8. Identify its corresponding PRD feature IDs.
9. Read the milestone's dependencies and acceptance criteria.
10. Inspect `git status`.
11. Inspect the existing implementation related to the feature.
12. Identify whether the required frontend UI already exists.

Do not write code before completing this preflight.

---

## 4. One Milestone Per Run

DeskAtlas uses strict milestone execution.

The required lifecycle is:

`READ → INSPECT → PLAN → IMPLEMENT → TEST → REGRESSION TEST → DIFF AUDIT → REPORT → STOP`

Implement exactly ONE milestone per user request.

This applies to backend milestones (`Mxx`), frontend milestones (`FM-xx`), and
post-FM fix milestones (`MF-xx`).

Never automatically continue to the next milestone.

Even if the next feature is closely related, STOP after the current milestone
passes its validation requirements.

The next milestone requires a new explicit user instruction.

---

## 5. Implementation Order

Follow:

`docs/DeskAtlas_Feature_Milestone_Runbook.md`

Do not reorder milestones unless explicitly instructed by the user.

Authentication and final authorization integration are LAST.

Do not implement authentication early because another feature would be easier
with it.

Production release remains blocked until the final authentication/security
milestone passes.

---

## 6. Frontend Is Frozen (This is no longer true. See docs/frontend/INDEX.md)

The implementation agent owns:

- backend
- Supabase/PostgreSQL
- migrations
- functions/RPC
- Edge Functions
- Storage
- business logic
- services
- repositories
- API/data adapters
- frontend-to-backend connection
- tests

The implementation agent DOES NOT own frontend design.

Do not:

- create UI components
- redesign screens
- modify layouts
- modify styling
- change colors
- change spacing
- change typography
- add buttons
- add form fields
- create modals
- create pages
- change navigation
- rewrite visible copy
- modify map appearance
- modify responsive design

Integration-only edits inside existing frontend files are allowed only when
necessary to connect existing UI to backend behavior.

Prefer service/hook/adapter changes instead.

If required UI does not exist:

1. Do not create it.
2. Report the missing frontend prerequisite.
3. Stop if it prevents completion of the milestone.

See:
`docs/DeskAtlas_Backend_Integration_Scope_of_Work.md`

---

## 7. Database Rules

The approved ERD is authoritative for the database.

Before creating a migration:

1. Find the relevant entities in
   `docs/DeskAtlas_Final_ERD_Specification.md`.
2. Verify PK/FK relationships.
3. Verify cardinality.
4. Verify required constraints.
5. Verify status/enums.
6. Verify indexes.
7. Verify history/deactivation rules.

Do not invent new production tables merely because they make implementation
convenient.

If the ERD cannot support a required feature, STOP and report an ERD change
request rather than silently changing the data model.

---

## 8. Core DeskAtlas Invariants

Never change these unless explicitly instructed.

### Reservation

- Guest-first; customer account is not required.
- Required customer data: first name, last name, email.
- Exactly 1 Main candidate.
- Maximum 2 alternatives.
- Priority: Main → Alt 1 → Alt 2.
- Alternatives use the same workspace template/tier.
- Alternatives use the same date.
- Alternatives use the same duration.
- Alternative start time may differ.
- Candidates may use different physical workspace instances OR the same physical instance with a different start time (duplicate instance + identical start time is rejected).

### No-Hold Rule

The following DO NOT reserve inventory:

- selecting a spot
- submitting reservation
- receiving payment link
- uploading proof
- Payment Under Review

Only successful authorized payment approval/confirmation + atomic candidate
allocation reserves the spot.

### Allocation

First successful approval/allocation wins.

Allocation order:

`Main → Alt 1 → Alt 2 → Manual Resolution`

Never automatically assign a fourth unapproved option.

### Online Payment

- Payment session expires after 1 hour.
- Payment page contains GCash/bank QR/details.
- Payment page contains proof upload.
- Timer stops only after successful server-accepted proof submission.
- Online payment approval is Admin-only.

### Kiosk

- No emailed one-hour payment page.
- Counter payment may be cash or counter QR.
- Staff OR Admin may confirm kiosk payment.
- Same allocation engine is reused.

### Booking QR

- Payment QR and booking QR are separate.
- Booking QR is generated only after confirmation.
- QR contains an opaque token, not customer PII.
- Active only during confirmed booking time.
- Admin and Staff may scan it.
- Re-entry is allowed during booking time.

### Workspace Model

`Workspace Template → Physical Workspace Instance → Map Placement → Reservation`

Instance-level override is limited to approved fields such as:

- name
- operational status

### Policy Documents

Policy-document functionality is Won't-Have.

Do not implement:

- policy document tables
- policy upload
- policy versioning
- policy document backend
- policy management UI

---

## 9. Testing Is Mandatory

A feature is not complete when it merely compiles.

Run the milestone-specific tests from the milestone runbook.

At minimum verify:

### A. Static checks

- TypeScript/typecheck
- lint
- build

Use the repository's actual scripts.

### B. Feature tests

- happy path
- invalid input
- boundary conditions
- error paths
- transaction rollback where relevant
- concurrency where relevant

### C. Regression

Run tests for previously completed milestones affected by the change.

### D. Integration

Verify the existing frontend correctly consumes the backend through its
existing UI.

### E. Diff audit

Inspect all changed files before declaring completion.

---

## 10. Frontend Visual-Diff Gate

Before completing any milestone, confirm:

- New UI components: NONE
- Deleted UI components: NONE
- Layout changes: NONE
- Style changes: NONE
- Typography changes: NONE
- Visible copy changes: NONE
- Navigation changes: NONE
- New visual states: NONE
- Unrequested frontend redesign: NONE

If any appear unintentionally, revert them.

---

## 11. Do Not Perform Unrelated Refactors

Do not:

- mass-format unrelated files
- restructure unrelated directories
- migrate state libraries
- replace routing
- replace UI libraries
- upgrade unrelated dependencies
- rename unrelated components
- refactor unrelated frontend code

Keep each milestone diff focused.

---

## 12. Change-Control Rule

If implementation requires changing:

- product behavior
- PRD acceptance criteria
- ERD
- role permissions
- reservation states
- payment behavior
- allocation behavior
- frontend design

STOP.

Report:

- current rule
- discovered conflict
- affected PRD IDs
- affected tables/components
- why current implementation cannot satisfy it
- proposed options

Wait for user approval.

---

## 13. Milestone Completion Report

Before returning the final milestone report, re-check `docs/INDEX.md` and
update the shared ledger files it requires for every milestone attempt:

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/frontend-limitation/frontend-limitations.md`

This applies to both PASS and BLOCKED outcomes. Do not skip these updates just
because a milestone is blocked or partially implemented.

At completion return:

### Milestone
- ID:
- Feature:
- PRD IDs:
- Status: PASS / BLOCKED

### Implemented
- Backend:
- Database:
- Frontend connection:

### Changed Files
- ...

### Tests
- test:
- result:

### Acceptance Criteria
- ...

### Regression
- ...

### Scope Audit
- Frontend visual changes: NONE
- Future milestone implementation: NONE
- Unrelated refactors: NONE

### Known Limitations
- ...

### Blockers
- ...

### Stop
Milestone complete. No next milestone was started.

Then STOP.
