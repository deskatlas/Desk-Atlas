# MS-51: Current Knowledge Base files

Traceability: PRD-F27, DSD-UI17, SDD-C23/C24, ERD-E24 through ERD-E29, QAD-TC45, MS51-TC01 through MS51-TC11.

The working list projects each logical document into its current publication and actionable pending versions. Removed documents, removed files, and superseded predecessors are excluded. Pending and failed replacement work preserves the current publication. Existing extraction, structural scope, warning, audience, and explicit publication review remain intact.

The authenticated documents route filters nonremoved parents and nonretired embedded versions before its 21-row lookahead. An inner version relationship excludes documents with only retired history. UUID keyset cursors continue across deleted rows. No count or search endpoint existed to update. The Settings component was the only production consumer of this documents route. Explicit authorized historical version endpoints remain unchanged.

Cleanup has an independent authenticated, scope-filtered, cursor-paged summary. Its status and failed-job retry controls live outside the working file list. Tombstones, storage retention, worker scheduling, revocation, database publication transactions, RLS, and audit records are unchanged by MS-51. Concurrent MS-52 work adds progress detail to the same compact summary.

Successful remove and publish commands update local files immediately, then reload authoritative data. A read generation fence rejects pre-mutation and out-of-order snapshots and page merges. Reads pause during commands. Errors reconcile without replaying writes or reporting success. Changed preview targets close; remaining removal and upload targets refresh their revisions. Removal restores focus to Upload document after controls become available. Existing MS-47 identity checks fence every result.

## Verification

- Focused Vitest: 72 passing tests across MS-51, SPEC-5, MS-46, MS-47, and MS-48.
- Browser verification passed 22 viewport/state combinations using the real Settings and AuthProvider components with isolated synthetic API responses. Publication review gates, predecessor promotion, removal, reload persistence, delayed reads, ambiguous writes, cleanup retry, focus restoration, and horizontal overflow were checked. The temporary application route was removed before building.
- Before and after screenshots: `node_modules/.cache/ms51`, at 1440x900 and 390x844. They cover mixed working/history data, empty lists, cleanup failure, and replacement failure. Additional states cover upload, queue, processing, review/publication, conflicts, delayed responses, and lost mutation responses.
- Full `pnpm test`: 2052 passed, 3 skipped, 1 failed. The unchanged SPEC2-TC05 campaign test rejects a 100 percent reward that the unchanged campaign schema currently accepts. This is outside MS-51.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. All four applications compiled and built successfully. `git diff --check` passed.

The route tests exercise real Next.js handlers and real Supabase query serialization against a synthetic PostgREST responder. The browser fixtures exercise component lifecycle and persisted fixture state across reloads. Live hosted database pagination and real-account acceptance remain deployment checks; no production knowledge content was mutated for this milestone.

To repeat browser checks, temporarily mount `tests/fixtures/ms51-knowledge-browser.tsx` as `apps/admin-portal/src/app/ms51-fixture/page.tsx`, run the local admin development server, and run `scripts/ms51-browser.cjs` with `MS51_PLAYWRIGHT_MODULE` pointing to an already available Playwright installation. Remove the temporary route before building. No dependency was added.
