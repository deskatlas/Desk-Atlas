# MS48 retrieval recovery audit

Date: October 15, 2026. Authority: MS48 Sections 4.1 through 4.5,
PRD-F26/F27, SDD-C23/C24, QAD-TC44/45/46.

## Verified incident

Read-only inspection found one published Markdown generation with 119 chunks,
parser v3, structural contract version 1 and an acknowledged structural review.
One section is unresolved. Every other section directly requires that section;
the largest dependency set contains 75 sections. An actual authorized
`assistant_expand_evidence` call returned `complete=false`,
`reason=UNRESOLVED_CONTEXT`. The unresolved text contains a generic
"according to policy" reference without a verified target. No private source
text, titles, filenames, document identifiers, credentials or vectors are
recorded here.

The v3 classifier promoted permission-bearing sections into document-wide
dependencies. This creates two failures: one unresolved rule blocks all
retrieval, and many otherwise valid closures exceed the six-source budget.
Removing the unresolved flag would therefore neither establish policy correctness
nor fix the dependency explosion.

## Pipeline decision

Retain the existing v4 / migration 020 design, rather than introducing a second
retrieval stack. Its responsibilities are:

1. Extraction establishes section identity and ancestry from actual structural
   events. Generic references remain unresolved. PDF page numbers alone do not
   establish procedure identity.
2. Ingestion stores a versioned proposed graph, complete source provenance and
   content/structure manifests. Lexical permission detection cannot grant global
   rule scope.
3. An administrator verifies local/document-wide applicability and resolves
   required references against the original. Publication binds that graph
   atomically. Unresolved scope remains unavailable, visibly and deliberately.
4. Retrieval authorizes seeds, validates the entire stored generation, and
   expands complete reviewed dependencies. Budgets apply to this closure.
5. Answer selection retains required conditions and exact source quotations.
   Final actor, publication, source and epoch checks still apply.

The recovery work adds a pure domain audit used by the existing review screen.
It previews blocked sections, complete closure chunk counts, missing targets,
unreviewed scopes and unresolved reference acknowledgements. Older structural
formats require replacement through that screen; acknowledging a preview cannot
rewrite their stored graph. Cycles terminate and do not double-count chunks.
This preview is advisory: database checks, model relevance, byte/token budgets
and final source authorization remain authoritative.

## Reproduction and regression

`node scripts/rag-knowledge-audit.cjs` reads metadata only and reports the current
published dependency impact. It makes no lifecycle, storage or publication
changes and does not retrieve document contents.

`services/rag/.venv/Scripts/python.exe services/rag/run.py test-ms48-postgres`
uses only a disposable local PostgreSQL database. Its 119-section synthetic SOP
contains a generic policy reference. It verifies rejection of unverified review,
explicit unresolved publication remaining unavailable, the v3 dependency pattern
blocking all 119 seeds, and reviewed v4 scope restoring a two-source answer with
the required approval condition. Whole-generation corruption, scope/audience
authorization, budgets and rollback remain covered. The test vector domain does
not certify production pgvector ranking or model semantic quality.

## Activation still required

The published SOP is unchanged by this recovery work. Migration 020, compatible
v4 parser/worker/API deployment and a reviewed successor publication are needed
to replace the v3 graph. Follow the coordinated activation and rollback in
[MS48 implementation](MS48-IMPLEMENTATION.md). Do not update existing chunk
metadata in place, remove unknown dependencies, auto-approve scope, or publish
the private source as part of a test. A safe draft is still not an approved SOP.

Docker's Linux engine was initially unavailable. After the owner applied
migration 020 and started Docker, the live structural hash function matched the
version-2 contract. The staged v4 image reports `kb-parser-v4` and its extractor,
chunker and structure files match the current source byte-for-byte.

The ingestion queue was idle before switching the worker. Its saved local
`KB_PARSER_IMAGE` now selects `deskatlas-knowledge-parser:ms48-reviewed-scope`,
and the idle worker was restarted. A replacement draft was queued through the
normal authenticated upload, permit, transfer and finalize routes using the
retained original. Its size and SHA-256 were checked before transfer. No source
content was rewritten, no extraction review was auto-approved and the published
predecessor remains active. Private-source acceptance and publication are still
pending; synthetic regression checks do not imply the live answer is repaired.

The successor is version 3 and reached READY with all 119 expected chunks,
parser v4 and structural contract version 2. It has one unresolved reference;
the largest proposed dependency set contains four sections, compared with 75
in the published predecessor. `SECTION_SCOPE_REVIEW` and
`SECTION_CONTEXT_UNRESOLVED` remain visible. The administrator must verify scope
and reference targets in the existing preview before publishing this successor.

## Verification results

- `pnpm typecheck`: passed across all packages and applications.
- `pnpm lint`: passed the configured RAG boundary checks.
- `pnpm build`: all four Next.js applications passed production builds.
- Focused gateway/knowledge suites: 25 passed; readiness audit: seven passed.
- MS48 real extraction and evidence checks: 13 passed.
- MS46 ingestion/operations regression suite: 75 passed.
- Disposable PostgreSQL recovery, authorization, integrity and rollback: passed.
- `pnpm test`: 2,015 passed, three skipped, one existing SPEC2-TC05 failure at
  `tests/spec2-campaigns-and-rewards.test.ts:327`. This run included the first six
  readiness tests; the subsequent seventh test passed in its focused run.

The owner applied migration 020 and started Docker during recovery. Neither
consent nor a successful build substitutes for reviewing the actual SOP's
dependency scope before publication.
