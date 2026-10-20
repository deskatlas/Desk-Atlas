# Hosted embeddings implementation contract

Authority: October 20 maintainer instruction to implement DeepInfra
`Qwen/Qwen3-Embedding-4B` for document and query embeddings and guide deployment.
Traceability: PRD-F26/F27, SDD-C21/C23/C24, ERD-E25/E27, QAD-TC44/45/46.

The provider is explicitly selected, default off, fixed HTTPS, 1024 dimensions,
L2 normalized, with a versioned query instruction and separate fingerprint.
No hosted-to-local fallback, vector mixing or silent truncation is permitted.
No third-party dependency is added. Provider model IDs are not immutable weights.

For this embedding-only migration, shadow vectors preserve exact chunk IDs,
text, structural manifests, audiences and source approvals. This is a scoped
amendment to SPEC5 section 5.3's shadow successor-version strategy: no source
re-extraction or content change occurs. A server-only maintenance RPC captures
the complete active corpus, stages new vectors without modifying live vectors,
checks corpus identity under locks and atomically switches all live vectors,
version fingerprints, matching automated-verification embedding bindings and
catalog epoch. Source/content approval is preserved, not newly asserted.
Old vectors and verification records are retained for guarded
rollback. Any changed corpus or incomplete staging rejects cutover. Existing
pending uploads must finish or be removed before snapshot. Migration 030 allows
independent purge jobs, including upload-authorization waits, to remain queued.
Ingestion jobs and unfinished versions still block snapshot and cutover; table
locks, corpus/epoch validation and rollback guards remain mandatory. Disable app RAG/KB
and stop workers for the final cutover and matching configuration deployment.

Only migration RPCs may mutate database embeddings. Maintenance scripts keep
credentials in process memory, never output source text or vectors, and use the
existing Supabase service-role credential only for an operator-run maintenance
operation. Runtime workers continue to use the narrow TypeScript gateway.

Worker chunking uses a conservative UTF-8-byte tokenizer adapter, independently
of hosted model tokenization. This never undercounts tokens, requires no local
model, and changes chunk boundaries for newly ingested sources. Existing corpus
re-embedding keeps its exact chunks and approvals. Parser sandbox stays offline
and credential-free. Cloud worker hosting still requires Docker and restart
supervision. Provider failures leave jobs retryable and cannot publish partial
vectors. Representative retrieval and cold-start acceptance follow deployment.
