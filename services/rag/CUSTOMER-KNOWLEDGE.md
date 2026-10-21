# Unified Customer knowledge audience

The maintainer's October 21, 2026 request supersedes the MS-76 through MS-78
distinction between public and verified customer knowledge under PRD-F26/F27,
SDD-C20-C24, DSD-UI17 and ERD-E24-E29. Admin knowledge settings now offer
Admin only, Admin and staff, and Customer. Both public visitors and verified
customers retrieve CUSTOMER general policies. Internal assistants retain their
existing internal audience restrictions.

The October 21 guest-access repair implements PRD-F26/F27, SDD-C20-C24,
DSD-UI16 and MS77-TC01/12/14/15. Session bootstrap renews authentic expired
guest cookies, while protected query/source routes still reject expired or
forged identities. Same-origin checks validate the allowlisted Host when
Next.js exposes its all-interface bind address. Production IP admission still
requires the configured trusted ingress header. General questions explaining
Customer IDs or reference codes do not request private booking authority.
The local API launcher preserves explicitly configured customer feature flags.

The customer panel uses compact controls, bounded viewport height, a scrollable
content area and a persistent composer. Schedule fields and optional private
verification remain collapsible. Private verification reuses the existing
identity form in a compact presentation.

Repair verification: guest bootstrap succeeds in the local browser, including
the compact panel and expanded settings. The 64 focused customer/UI tests,
18 launcher/startup tests and 19 Python customer tests pass. Monorepo
typecheck, lint and all four production builds pass. Live answer acceptance
is blocked: the stopped local API fails startup because its saved embedding
fingerprint differs from its configured local embedding model. The customer
access flag is enabled in local saved service configuration; the launcher
does not enable it by default. No production deployment is claimed.
The final full suite has 2482 passing tests, 43 skipped tests and the four
previously documented unrelated failures in MS-35, MF-71, MF-78 and MF-79.

Follow-up local configuration repair: the embedding startup blocker above is
resolved. The ignored local service environment explicitly selects DeepInfra
for answering and embeddings, uses the existing hosted corpus fingerprint and
loads the existing provider credential server-side. The API completes startup;
`pnpm rag:status` reports `ready: true` and `implementation_current: true`.
Saved-configuration validation also passes for future restarts. A real public
gateway request completes with HTTP 200 and a knowledge-gap clarification.
The broad booking-process question separately returns `UNRESOLVED_CONTEXT`
during evidence inspection. No source completeness check was disabled and no
corpus, embedding vector or production configuration was modified.

Verification still protects owned reservation context, booking lists, and private
actions. Customer knowledge must contain only general policies, never private
customer records, credentials, proofs or tokens.

Migration 036 consolidates existing document classifications and their version
publication/upload bindings without changing embeddings or publishing new
versions. Knowledge epochs change to invalidate old evidence. Apply it with
customer entry points disabled and workers drained, then deploy matching
TypeScript and Python contracts. Activation remains gated on MS-79.

Downgrade refuses while CUSTOMER document/version bindings remain: restoring
separate audiences requires explicit classification, not an arbitrary decision
to expose or restrict existing documents. Historical migrations remain intact.

Local verification: 30 focused TypeScript tests, 38 Python tests, the disposable
PostgreSQL lifecycle/migration/access/rollback harness, monorepo typecheck, lint,
and all four production builds passed. The full suite recorded 2476 passed,
43 skipped, four pre-existing failures (MS-35, MF-71, MF-78, MF-79), and one
MS-05 timeout during concurrent build load. The isolated MS-05 rerun passed all
four tests. Migration 036 is prepared; no live database was changed.

## Customer reference answer repair (October 21, 2026)

Authority: the maintainer's request to answer from the six customer handbooks,
including unverified visitors. Traceability: PRD-F26/F27, SDD-C20-C24,
MS65 document support and MS77-TC01/02/07/10/12/15.

All six supplied documents are now published. The local embedding configuration
matches the corpus. Public knowledge requests select a primary document from
actual retrieved prose before whole-document expansion. Extra dependencies need
an exact reference in the primary passage. The planner distinguishes general
booking instructions from existing private customer records; its private intent
uses OWNED_RECORDS internally and maps to the existing BOOKING gateway contract.

Customer document inspection packs every original unit without repeating source
identifiers and heading paths on each paragraph. Canonical identities, hashes,
UTF-16 citation offsets, document limits and independent checks remain binding.
Oversize selected evidence is refined through exact sentence indexes, preserving
contiguous original spans and all intervening qualifiers. Composition can leave
redundant evidence uncited. Independent support checks and omission checks still
inspect every original document partition before release. Genuine missing rules,
contradictions and evidence-size limits return a customer clarification.

Live unauthenticated gateway checks returned cited ANSWER results for the booking
process and Think Spot call policy in approximately 44 and 28 seconds. The account
requirement question also returned a cited answer before the final concision
adjustment. One call-policy attempt returned 503 before a successful rerun, so
these checks establish working local answers, not a reliability or latency SLA.
The service reports ready and current. Browser automation was unavailable in
the current Work settings; the final checks used the real HTTP customer gateway.

Focused verification: 55 Python document/customer tests and 36 TypeScript gateway,
public-customer and MS65 tests pass. Typecheck, lint and all four production builds
pass. The build was rerun after a concurrent workspace build released its locks.
The full suite records
2487 passed, 43 skipped and four previously recorded failures in MS-35, MF-71,
MF-78 and MF-79. No production deployment or knowledge-content mutation is claimed.
