# MS-76 customer assistant foundations
> October 21 maintainer amendment: public and verified knowledge classifications are combined into CUSTOMER. Both customer modes use this general knowledge; private booking data still requires combined-purpose verification. See [Customer knowledge](CUSTOMER-KNOWLEDGE.md) and migration 036. Earlier audience details below are historical.


Authority: maintainer request to implement MS-76 on October 21, 2026.
Traceability: MS76-R01-R04, PRD-F20/F26/F27, SDD-C15/C20-C24,
DSD-UI13/UI16/UI17, ERD-E22-E29, QAD-TC38/44/45/46.

The scoped amendments in `docs/index.md`, the seven master specifications,
and SPEC-3 through SPEC-6 register the read-only customer extension. Those
historical documents are ignored by repository Git rules. This tracked record
preserves the implementation authority and the exact extension boundaries.

## Delivered behavior

Four explicit knowledge audiences pass through the existing upload validation,
admin controls, durable worker wrappers, automatic verification and publication.
New uploads still default to ADMIN_ONLY. The UI explains unverified public
access and offers explicit classification and reclassification. No existing
document is copied, broadened or re-embedded.

| Principal | Conversational audiences |
|---|---|
| ADMIN | ADMIN_ONLY, ADMIN_AND_STAFF |
| STAFF | ADMIN_AND_STAFF |
| PUBLIC_VISITOR | PUBLIC_CUSTOMER |
| VERIFIED_CUSTOMER | PUBLIC_CUSTOMER, VERIFIED_CUSTOMER |

Admin management and preview retain authority over all four audiences.
Migration 032 restricts every installed internal assistant reader and expansion
helper, including the legacy `kb_search` API. Service-only customer search,
hybrid search, source, availability and whole-document APIs reuse the canonical
implementations with separate principal checks. Customer search/source reads
also verify complete generation/content manifests and publication bindings.
The final gateway adapter repeats authorization and catalog epoch checks.

`@deskatlas/server/assistant` provides isolated signed customer capabilities,
plan admission, purpose-aware verification, keyed subject digests, restricted
knowledge readers and distributed request controls. It is guarded against
browser imports. `@deskatlas/server/cloudRun` extracts the existing request-scoped
transport authentication; the admin module keeps a compatible re-export.
No app imports another application's source root.

Customer capabilities bind surface, principal, UUID subject, business scope,
request/session IDs, generation, exact operations, audiences and at most 60
seconds of validity. Python's separate `customer_access.py` verifier accepts
these contracts. Existing internal endpoints retain their ADMIN/STAFF verifier
and reject customer capabilities. Customer orchestration remains gateway-driven;
no Python business-data callback or customer bearer forwarding is introduced.

CustomerService can explicitly issue REWARDS_AND_ASSISTANT_ACCESS challenges
through the original random-token, hash and 15-minute lifecycle. Rewards accepts
either purpose; private assistance accepts only the combined purpose. The
verification UI and private routes belong to MS-78.

The server-only control RPC atomically claims IDs and permits, retains short
replay/quota tombstones, fences ownership/session/generation, and supports shared
stage/progress/cancel checks. Cancellation is polled during provider waits and
checked before release; abandoned leases expire. Expired records are reclaimed
in bounded batches. Records contain no prompts, evidence, answers or tokens.
The foundation caps one active request per subject and four per business, with
ten admissions per minute. MS-77 may impose stricter public quotas and a shared
two-slot policy through migration 033 before admitting public inference.

## Local verification

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed across packages and four applications |
| `pnpm lint` | Passed, including the shared server package |
| `pnpm build` | Passed for all four applications |
| Foundation and existing KB/automatic publication/evidence-contract regressions | 35 TypeScript tests passed (including the final cancellation test) |
| Customer capability and existing ingestion tests | 38 Python tests passed |
| Existing MS-65 Python evidence contract | 17 passed |
| `pnpm test:ms76:postgres` | Passed disposable PostgreSQL lifecycle, matrix, RLS, cross-connection control and guarded rollback |
| Full `pnpm test` | 2,413 passed, 43 skipped, four failures outside changed MS-76 behavior |

The full-suite failures are existing expectations for DrawSQL's extra
`overdue_notified_at` column, the em-dash in two survey email subject tests, and
MF-79's source-string payment sorting assertion. These files were not modified
by MS-76. Focused foundation tests cover all sixteen audience combinations,
default classifications, purpose compatibility, forged bindings, forbidden
plans, withdrawal at release and cancellation. PostgreSQL exercises automatic
publication for both customer audiences, semantic/lexical/source/full-document
matrix checks, tamper rejection, replacement continuity, removal epochs, denied
browser access, duplicate concurrent claims, wrong generation/owner cancellation,
lease recovery and both incompatible and safe downgrade paths.

The database harness uses the established array-backed vector adapter. It does
not establish live pgvector quality, hosted storage, actual deployed RLS roles,
worker deployment compatibility or cross-replica HTTP acceptance.

## Rollout and remaining gates

Apply `032_ms76_customer_rag_foundations.sql` only after inventorying the actual
applied migration history, through the existing migration workflow. Numeric
prefixes already overlap in historical migrations; 032 is unique in this
checkout. The script amends installed canonical functions transactionally,
preserving generation/lease/provider verification. Deploy compatible workers
and gateways together or drain old workers before accepting new audiences.

Customer flags remain disabled until MS-77/MS-78 integration and MS-79
independent acceptance. No production database or deployment was changed.
The paired down migration refuses retained customer classifications,
customer-bound version metadata, combined challenges or live customer work.
Disable entry points, drain work and revoke combined challenges first. Never
relabel or delete production content to force a downgrade; retain expanded
schema when preservation requires it.
