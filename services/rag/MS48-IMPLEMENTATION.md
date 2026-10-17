# MS-48 implementation record

Date: October 15, 2026. Authority: MS-48 Section 7, PRD-F26/F27,
SDD-C20/C21/C23/C24, ERD-E25/E26, QAD-TC44/45/46.

Local implementation is delivered. Production acceptance remains pending.
The October 15 follow-up below supersedes the initial v3 automatic global-scope
proposal with explicit reviewed scope and parser v4.
No application database migration, source replacement, publication, reindex,
feature activation, dependency installation, or deployment was performed.

## Contracts and structural audit

MD heading events and Word heading styles create ordered section instances
(`s1`, `s2`, etc.). IDs are local to a version and generation, never a title
match or a page number. Word paragraphs, tables, and page continuations inherit
the current instance. Headers and footers have document scope. Markdown fenced
examples do not create headings. Repeated headings create distinct instances.
Unstructured PDF/OCR sections remain unresolved; no page-based boundaries are
invented. DOC uses the existing isolated DOC-to-DOCX conversion.

Each chunk stores `section_context` (version 1, instance ID, dependencies,
unresolved flag) and `structure_sha256`. The version stores
`structure_manifest_sha256` and `structure_reviewed`. Original content hashes,
ordinals, pages, content manifests, generation fencing, and embedding identities
are retained. The structural manifest binds every content hash to its graph
metadata. Parser/chunker identity advances to v3; embeddings are recomputed for
successors using the existing unchanged embedding configuration.

An entire section is the conservative support unit. All chunks of that unit
are included. Structured v3 chunks do not repeat partial overlap tails or copy
qualifiers into every chunk; section closure retains the original complete rule. Ancestors and document preamble/furniture are required context.
Permission/condition-bearing sections are conservatively required throughout
the document, regardless of retrieval score. This classifier is a candidate
graph for administrator review, not a semantic proof or new business policy.
Publication requires explicit `acknowledge_structure` and records the review.
The review UI displays instance IDs, dependencies, unresolved metadata, and the
full extraction. Administrators must reject missing or incorrect scope and
upload a corrected source; there is no automatic scope approval or graph editor.

Explicit Markdown internal anchors and quoted unique section headings resolve
within the same document generation. Unknown/ambiguous references produce
`UNRESOLVED_CONTEXT`. Natural references to numbered sections without a verified
target are not guessed. Cross-document references require review and are not
followed automatically. No URLs are fetched. Recursive expansion uses distinct
visited nodes, so cyclic dependencies terminate with their complete closure.
Graphs above 1,000 section instances or 10,000 conservative global edges are
marked unresolved during ingestion rather than causing unbounded graph work.

## Retrieval, answers, and limitations

Migration 019 replaces answer-context assembly only. It first verifies the
entire implicated content and structural generations, then expands selected
section instances and their dependency closure under the existing source-access
filters. Each source remains an original chunk with its original hash.

The six-source limit remains. If the initial candidate union exceeds it,
`/v1/context` selects direct support from the already bounded candidate set in
batches of at most four. It cannot select invented IDs or grant dependencies.
The selected seeds are expanded through the same verified graph before an answer
is attempted. Relevant contrary permission/condition sections remain required
regardless of selection score. Broad document summaries/comparisons produce
`AMBIGUOUS_SCOPE` instead of silently narrowing coverage.

SQL returns typed `CONTEXT_BUDGET`, `REPROCESS_REQUIRED`, or
`UNRESOLVED_CONTEXT` limitations. Successful context includes a strict group
contract mapping section instances to original chunk IDs and required groups.
Python selects relevant groups and copies every substantive paragraph in their
closure, subject to exact-substring and output-budget checks. The gateway checks
dependency coverage independently. Unrelated candidate groups are not copied
merely because they were supplied. Legacy callers retain conservative all-source
quote validation.

The gateway measures the serialized query/sources/groups against 12,000 bytes.
Python measures the fully serialized model request including system prompt,
schema, options and metadata against the existing 15,000-byte ceiling and the
16,384 context window, reserving output tokens plus 512 tokens of template
headroom. UTF-8 byte measurement is a conservative tokenizer upper bound, not
an exact tokenizer measurement. Returned actual prompt/output counts remain
content-free telemetry. Exact pinned-answer-tokenizer boundary acceptance is
still required before release.

Context/output limitations never also emit a no-source claim. Authorized data
failures, knowledge changes, model failures, conflicts and ambiguity retain
separate outcomes. English, Tagalog, and Taglish procedural copy avoids requests
for metrics/dates. Verified operational tables remain independent.

## Migration, cutover, and rollback

1. Disable KB/RAG and drain gateways/workers before coordinated schema/runtime
   rollout. Apply only `019_section_context.sql` after 018, using the existing
   migration process. Do not apply `_down.sql` in a forward glob.
2. Deploy the matching shared schemas, gateway, worker, answer API and review UI
   together. Existing versions have no fabricated graph and return
   `REPROCESS_REQUIRED` when implicated in retrieval.
3. Reprocess an authorized original as a replacement through the existing
   upload/finalize workflow. The predecessor remains published while the
   successor ingests and awaits explicit extraction and structure review.
   Resolve unknown references/structure externally, then upload another
   successor if needed. Publish only after reviewing all applicable conditions.
4. Keep predecessors and private source artifacts through the release review.
   No old/new generation or manifest may be mixed. No withdrawn source is
   republished automatically.
5. To roll back, disable KB/RAG, drain all requests/workers, restore the compatible
   prior runtime, then apply `019_section_context_down.sql`. It restores the
   exact 018 worker/expansion and 016 publication contracts and removes only the
   new metadata. Original chunks, content hashes, versions, source artifacts,
   publication state, and 018 upload/cleanup fences remain. Whole-version
   expansion limitations return. Removing 018 separately still requires its
   existing cleanup-fence preconditions.

## Verification and unresolved acceptance gates

- `pnpm test:ms48`: 12 authenticated gateway/contract checks passed, including
  required approval coverage, oversize/unknown outcomes, bounded candidate
  selection, broad scope, data/model separation, and actor revocation.
- `pnpm test:ms48:python`: 11 real parser/quote checks passed.
- `pnpm test:ms48:postgres`: passed against disposable PostgreSQL 18 using the
  established test vector domain. Real ingestion/checkpoint/completion,
  publication, graph expansion, nonselected-content integrity, authorization,
  limits, legacy handling, and forward/down contracts were exercised.
  The synthetic SOP stored 119 chunks and expanded to two authorized evidence
  chunks, with a 1,416-byte serialized RPC result. That is result size, not a
  full prompt measurement or a model latency measurement.
- Existing SPEC-4/SPEC-5/MS-45/MS-46 TypeScript suites: 74 checks passed.
- Existing MS-46 parser/operations suite: 75 checks passed.
- `python services/rag/run.py test-ms44`: 35 service/API checks passed in the
  intended Python service environment. Running the entire Python directory
  indiscriminately in the older ingestion environment produced 12 existing
  `asyncio.timeout` compatibility failures; use the registered environment-specific
  commands rather than treating the ingestion Python 3.10 runtime as the service.
- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm test`: 2,007 passed, three skipped, one unrelated existing failure in
  `SPEC2-TC05` at `tests/spec2-campaigns-and-rewards.test.ts:327` (100-percent
  reward validation). The untouched test/schema reproduce the same failure
  when run alone.
- `pnpm build`: attempted. All four applications compiled, but the first run
  hit a stale generated development type referencing a removed `ms49-fixture`
  page. A retry encountered concurrent Next build locks. Build acceptance has
  not been established in this shared running workspace.

Real pgvector similarity/search integration, actual selected-model semantic
quality, exact answer-tokenizer measurements, supported DOC converter/OCR
acceptance, multilingual human review, representative five-user latency with
ingestion active, and review of the real private SOP remain release gates.
The new bounded candidate selection may add up to three model calls when the
initial union exceeds the source budget; measure this path under SPEC-6 before
activation. Synthetic tests do not certify private policy meaning or production
performance.

The content-free local verification identity is recorded in
`evaluation/ms48-local-verification.json` with the base revision, working source
hashes, synthetic corpus identity, command outcomes and explicit release status.

## Follow-up: reported context overflow and reviewed scope (October 15, 2026)

Read-only runtime checks found a published 119-chunk generation with parser v1
and no structural manifest. The current 019 RPC correctly returns
`REPROCESS_REQUIRED`; a prior response had labeled it as a context budget.
A nonpersistent, isolated parser audit found that the initial v3 classifier
would include 75 condition-bearing sections globally. Re-uploading alone was
therefore insufficient. No source text, heading names, queries, vectors or
credentials were retained in this record or diagnostic files.

The scope fix uses structural contract version 2 and parser/chunker v4.
Lexical permission/condition detection no longer assigns global scope. Every
section starts UNREVIEWED. Before publication, an administrator explicitly
reviews local versus document-wide applicability and additional required
references in the existing preview. A bulk action confirms remaining known
sections as local only on the administrator's explicit action; document-wide
choices remain intact. Preamble/furniture remains document-wide. Ancestors and
resolved explicit references cannot be removed by a review payload.

New reversible migration `020_reviewed_section_scope.sql` validates the complete
proposal generation before changing scope, requires exactly one review for every
section, checks all referenced IDs within the current version, and atomically
binds the approved graph into the structural manifest in the publication
transaction. The helper is inaccessible to service_role, authenticated and anon;
only the existing role-checked, document-locked admin command invokes it.
Unknown structure is never invented. An administrator can explicitly publish
UNRESOLVED context with document retrieval unavailable, preserving reviewed PDF
publication without pretending its structure is complete. Such uncertainty
remains a dependency of other sections until resolved. Unresolved references
require explicit acknowledgement and a required target before they can be
accepted as resolved.

The duplicate response is fixed: a document preparation failure uses one neutral
summary, with its precise reason only in limitations. Legacy versions receive
specific replacement/review/publish guidance. Workers reject old parser images
with `PARSER_REVISION_MISMATCH` before embedding, rather than accepting another
incompatible generation as ready.

Local runtime work: the original parser image was retained under
`deskatlas-knowledge-parser:ms48-before-20261015`, the local v3 image was rebuilt
and verified, and the idle local worker was restarted during diagnosis. The
final v4 image is prepared separately as
`deskatlas-knowledge-parser:ms48-reviewed-scope` and reports `kb-parser-v4`.
It is staged separately to avoid mixing the new contract with the currently
applied 019 runtime. Migration 020 and private-source replacement/publication
were not executed by this implementation.

Coordinated activation:

1. Drain ingestion and disable KB/RAG during the schema/runtime switch.
2. Apply only `020_reviewed_section_scope.sql` after 019 through the normal
   migration process. Retain the matching gateway/review UI and worker changes.
3. Set the worker's `KB_PARSER_IMAGE` to
   `deskatlas-knowledge-parser:ms48-reviewed-scope` (or build/promote the exact v4
   image to the configured local tag), then restart `pnpm rag:worker`. Restart
   `pnpm rag:api` to load the matching context/answer contract if necessary.
4. Re-upload the authorized original as a replacement. Review each section's
   scope and unresolved references in Knowledge Base, then explicitly publish.
   Keep the current predecessor until the successor passes review. No automatic
   approval, publication, source rewrite or live reindex is performed.
5. Ask a new question after publication; historical messages are not rewritten.

Rollback: disable KB/RAG and drain workers, apply
`020_reviewed_section_scope_down.sql`, and restore the compatible prior runtime.
The down migration flattens version-2 contexts into version-1 dependency graphs,
retaining approved edges, uncertainty, original contents and current publication
state, then recomputes compatible structural hashes/manifests. It restores the
019 admin/hash/expansion functions. It does not republish a withdrawn version or
alter 018 cleanup fences.

Regression evidence: 12 Python checks pass, including rejection of a stale
container before embedding, and 12 gateway checks pass including the exact
reported duplicate-code symptom. The strengthened disposable PostgreSQL fixture
now has 119 independent sections containing permission rules. Explicit reviewed
scope reduces the answer to the suggestion and approval sections while all
required references remain enforced. Missing/inaccessible review targets and
direct service-role helper calls are rejected; forward/down migration behavior
is exercised. The serialized successful RPC result is 1,373 bytes. This remains
synthetic PostgreSQL evidence with a test vector domain, not model semantic or
private-policy acceptance.

Follow-up verification: typecheck, lint and the full four-app production build
passed. Identity-bound local scope evidence is in
`evaluation/ms48-scope-verification.json`; it contains code/image hashes and
synthetic outcomes without source text.

The final full Vitest run completed with 2,009 passing checks, three skipped
and the same existing SPEC2-TC05 100-percent reward-validation failure.
