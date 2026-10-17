# MS-56 implementation

Authority: the October 15, 2026 request to implement `docs/milestone/ms56.md` supersedes its earlier Markdown-only authoring restriction. Trace: PRD-F26/F27, SDD-C20/C21/C23/C24, ERD-E24 through E29, QAD-TC44/45/46.

## Delivered behavior

The gateway compares authorized candidates before calling `assistant_expand_evidence`. It expands only selected direct support. A proven shortcut skips selection only when it accounts for every candidate; a matching FAQ or procedure heading cannot hide another candidate's contrary rule. Oversized candidate comparisons fail explicitly rather than unioning independently selected batches without reconciliation.

SQL migration 020 remains the trusted integrity and graph authority. It validates every stored chunk and manifest of each implicated selected generation, including nonselected chunks, before returning reviewed closure. Unknown scope, unresolved references, incompatible legacy generations, authorization and revocation checks remain mandatory. No persistence contract, migration, live publication or generation is changed.

Version 2 of `/v1/context` adds typed factual, multi-part, recommendation, complete-procedure and document-wide scope, with complete, partial-general, insufficient, conflict and clarification outcomes. Partial-general scope requires explicit gaps and an independent model verdict that the missing information cannot invalidate the exact quoted guidance. Partial procedures and partial document-wide summaries fail schema validation. Legacy context callers retain their exact response shape; legacy selection responses retain conservative whole-section answer behavior.

The gateway sends `required_chunk_ids` from the entire reviewed closure. Both Python packing and gateway grounding independently require those units. Answer selection cannot drop a separately selected contrary rule. Cycles terminate through visited sets. All required sections, conditions, ordered steps and references are packed as canonical exact substrings. Successful partial answers identify gaps in `limitations`; focused clarification text is retained. Context/output budget failures preserve the actual failing boundary rather than simultaneously claiming missing sources. Final actor, source and catalog checks and one bounded catalog retry remain in place; verified tool tables remain independent.

`rag/evidence-budget.json` centralizes unchanged candidate, source, quote, UTF-16, serialized request, model context/headroom, passage and graph bounds. TypeScript and Python load the same file. Model inference still measures the entire request, including schema, prompts and output allowance. Loaded-runtime identity includes this contract. The existing SQL source and traversal limits match it; modifying those limits requires a separately reviewed migration.

## Verification and remaining acceptance

- `pnpm test:ms56` exercises authenticated orchestration, selection order, partial safety, mandatory contrary coverage, conflict/clarification, budgets and revocation.
- `pnpm test:ms56:python` exercises scope validation, joint selection, legacy compatibility, exact closure, cycles, missing references, long-item overflow and independent partial verification.
- Existing MS-48 disposable PostgreSQL tests verify real integrity, graph, audience, removal and rollback behavior. They use a test vector domain, not real pgvector search quality.
- Existing MS-53 and SPEC-4 regressions verify exact extraction and source lifecycle behavior.

Published sections remain the smallest reviewed applicability unit. No paragraph-level safety, finer manifests or live successor review is invented. A large section may still exceed the exact output budget even for a short factual question; that boundary remains explicit until reviewed finer structure is available. Joint comparisons that exceed the unchanged request budget also remain explicit limitations. These are not silent truncations or acceptance passes.

MS-54's dataset labels and MS-55's independent candidate recall gate must be independently accepted before claiming the milestone's refusal, recall@6, complete applicable coverage or full-path latency targets. Synthetic/mocked results and disposable PostgreSQL checks do not certify those production gates. No model switch, dependency installation, retrieval threshold reduction, request cache or automatic publication is introduced.

## Local verification record (October 15, 2026)

Typecheck, boundary lint and all four production application builds passed. The final focused TypeScript run passed 115 tests across MS-56, MS-48, MS-53, SPEC-4 and MS-54 suites. The MS-56 Python suite passed 14 tests; existing Python evidence and runtime identity suites also passed. The disposable MS-48 PostgreSQL generation, integrity, graph, authorization and rollback suite passed.

The full repository test run exposed the existing unrelated `SPEC2-TC05` campaign reward vocabulary validation failure. Fixtures affected by the new selection call and integrity outcomes were updated and passed in the focused rerun. Full-suite success is not claimed. Production recall, independently reviewed candidate labels and complete-path latency remain pending as described above.
