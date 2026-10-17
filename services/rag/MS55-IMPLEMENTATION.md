# MS-55 local implementation

Authority: PRD-F26/F27, SDD-C20/C21/C22, ERD-E24 through E29, QAD-TC44/45/46 and MS55-TC01 through TC10. Date: October 15, 2026.

## Delivered behavior

The existing planner round accepts a versioned `search` object containing the exact original message, one optional standalone interpretation and at most two alternative phrases. Invalid aids fall back to the original message without another model round. Equivalent variants are deduplicated. Every expanded retrieval input includes the complete original wording, preserving conditions, identifiers, dates and negation even if a model alternative omits them. Alternatives never become evidence or tool instructions. Focused planner clarifications are displayed directly. Only recent user questions may provide intent context for answering.

The gateway's opt-in hybrid path sends one `/v1/embed-queries` request containing one to four inputs. The service uses the pinned encoder, existing model admission semaphore and native-work cancellation drain. It returns normalized 1,024-dimensional vectors, with count and finiteness checked on both boundaries. One `assistant_search_hybrid` RPC computes at most twelve semantic and twelve lexical candidates per input, in one database snapshot. No extra rewrite model round, hosted inference, dependency, cross-encoder, answer cache or transcript persistence is introduced.

Migration `023_assistant_hybrid_retrieval.sql` adds stored `simple` and `english` full-text projections over canonical heading/content and GIN indexes. Current source-backed document titles join the lexical projection at read time so title changes require no canonical-content rewrite. Lexical OR token queries admit partial natural-language matches. English stemming and neutral tokens are both searched; neither lexical nor semantic membership requires passing the other branch's cutoff. The small-corpus implementation materializes eligible candidates and performs exact scans; the GIN projections are available but this initial query does not claim index-assisted latency. Measure full-path cost before changing the query plan.

Both branches share one server-resolved actor/scope/publication/audience/fingerprint/current-generation filter. Whole-generation ordinal, count, manifest and canonical-content hashes are verified before candidate emission. Drafts, removed or inactive publications, incompatible generations and corrupt content cannot enter either branch. The existing reviewed context expansion, exact-excerpt verification and final actor/source/hash/epoch checks remain authoritative after fusion, including for lexical-only evidence.

Fusion uses reciprocal rank scores with `k=60`, equal lexical/semantic family weights, and a maximum of twelve final candidates. With expansions, the original query gets half of each family's weight and other variants share the remainder. Ties use canonical document/version/chunk identity. Duplicate hits contribute once per branch. Similar text from different sources remains separate, including contrary rules; incompatible hashes/epochs for the same identity fail closed. Chunk UUIDs are generation-specific. Configuration version is `ms55-v1`; any change requires a new frozen evaluation identity.

## Rollout and independent evaluation

`RAG_HYBRID_RETRIEVAL=false` is the default. Neither application environment nor a live database was activated or migrated. Apply migration 023 after the existing forward migrations through 022 through the reviewed deployment workflow. Coordinate gateway, shared schemas and Python service. Disable hybrid retrieval before applying `023_assistant_hybrid_retrieval_down.sql`; rollback removes only derived lexical columns/indexes and new RPC/helpers, preserving canonical content, hashes, publications and the vector-only RPC. Booking and payment workflows are unchanged.

The evaluation controls are server-only: `RAG_HYBRID_MODE=semantic|lexical|fused` and `RAG_HYBRID_QUERY_MODE=original|expanded`. Defaults are `fused` and `expanded`. Invalid controls fail explicitly. Both branches are computed by the same bounded RPC in comparison modes; these modes compare candidate quality, not isolated branch execution cost. Use measured gateway/Python stage timing to report the actual shared call cost. All three controls are part of the nonsecret frozen identity allowlist.

Use the MS-54 frozen corpus, labels, bindings and actor with the existing verified-excerpt path. Freeze separate identities/settings and collect authenticated reports for semantic/original, lexical/original, fused/original and fused/expanded. Do not inspect or tune held-out examples into shortcut grammars. Wrap each generated report as `{"settings": <matching frozen settings>, "report": <MS54 report>}`. Compare with:

```powershell
pnpm rag:ms55:compare --semantic-original <bundle.json> --lexical-original <bundle.json> --fused-original <bundle.json> --fused-expanded <bundle.json>
```

The comparator rejects mismatched corpus/model/code/dataset/split identities and wrong mode/configuration hashes. It compares stratified recall@6, complete direct support, baseline missed-question recovery, regressions, excerpt acceptance, refusals, failure categories and actual attempt counts/latency. Missing successful-answer latency stays null. Only defined content-free metrics are emitted. It never activates synthesis or claims release readiness. MS-54's pending baseline and owner refusal target must be settled before tuning or acceptance. The specification's 95% recall gate remains unchanged.

## Verification and limits

- `pnpm test:ms55`: bounded query inputs, strict vector/source contracts, deterministic fusion/provenance, lexical-only authenticated gateway answers, outages, final revocation and focused clarification.
- `pnpm test:ms55:python`: planner fallback, scope instructions, staff report denial, one admitted embedding batch, native cancellation drain and independent comparison identity/privacy controls.
- `pnpm test:ms55:postgres`: disposable real PostgreSQL full-text search, English stemming and neutral Tagalog tokens, semantic-only/lexical-only candidates, audience/scope/fingerprint filters, tombstones, supersession, generation/hash failures, grants and rollback.
- Focused results: eleven TypeScript and eleven Python tests passed. The broader Python run with `test_assistant.py` and `test_ms44.py` passed all 53 tests. Disposable SQL checks passed, including rollback.
- `pnpm typecheck`, `pnpm lint` and `pnpm build`: passed locally. The full `pnpm test` run passed 2,133 tests with three skipped; two failures were in untouched campaign/voucher suites (`SPEC2-TC05` reward vocabulary validation and `QAD-TC38-04` gross amount 500.01 versus 500).

The PostgreSQL test uses the repository's disposable array-vector domain with mathematical cosine distance because this machine lacks the pgvector extension. It proves actual full-text SQL and lifecycle behavior, not pgvector performance or embedding recall. No synthetic score is presented as live acceptance. Authenticated frozen-corpus multilingual recall, independent label/reviewer approval, real pgvector, complete-answer p95, five-user/contention measurements and live publication/replacement acceptance remain pending. The current MS-54 dataset/lock and MS-56 evidence contracts were being implemented concurrently; shared changes were preserved. Documentation under `docs/` is ignored by this checkout's existing Git rules; reconciliation is saved locally without changing ignore policy.
