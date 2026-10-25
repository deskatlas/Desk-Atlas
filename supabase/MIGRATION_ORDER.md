# SQL application order

MS-35 / MS-81; SDD-C12; QAD-TC35. October 25, 2026.

For an explicitly authorized empty local rebuild, apply the six consolidated
files in order: `000_reset_database.sql`, `001_schema.sql`, `002_functions.sql`,
`003_storage.sql`, `004_security_and_rls.sql`, `005_realtime.sql`. The reset is
destructive. The consolidated baseline represents pre-consolidation history,
plus the reviewed MS-81 function replacement. Later additive application
migrations still require an inventory-based review.

For existing databases, compare applied migration versions with preserved
history in `archive/pre-consolidation/` and additive files in `migrations/`.
Apply only missing forward files, in numeric order, using explicit file names.
Never apply consolidated reset/schema as an upgrade. Archived 022 and 023 have
nontransactional requirements documented in BUILD.

The repository has paired forward and `_down.sql` files and no general forward
runner. A wildcard SQL invocation is unsafe. Execute only the reviewed forward
file, for example `psql -X -v ON_ERROR_STOP=1 -f
supabase/migrations/041_staff_rpc_ambiguity.sql` against the explicitly selected
target. Never pass a down file in the forward list. Supply connection credentials
through the existing secret environment, not committed scripts or command text.

Migration 041 requires the exact supported staff functions from the preserved
baseline and aborts on drift. Apply after the installed forward inventory through
040 has been reconciled. Its paired down file is for explicit regression recovery
only and restores the known 42702 defect. See
[MS-81 evidence and pending release gates](../MS81-IMPLEMENTATION.md).

Clean-install source generation is `python scripts/consolidate-supabase.py`.
It uses preserved history plus the explicit 041 replacement definitions and
never opens a database connection. Review generated differences before use.
