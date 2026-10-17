# MS-59 local implementation and verification

Date: October 16, 2026 (Asia/Irkutsk). Trace: PRD-F26/F27; SDD-C20/C21/C23/C24; DSD-UI16/17; ERD-E25/E26; QAD-TC44/45/46.

Authority: the maintainer's subsequent request to implement [MS-59](../../docs/milestone/ms59.md) supersedes that plan's historical Markdown-only authoring restriction. This record distinguishes delivered code from publication, independent quality and release acceptance. No live migration, automatic source publication, dependency installation or deployment was performed.

## Changes

### Selection, retrieval and request bounds

The gateway now permits at most two selection calls and two selected-set expansions over the entire request, including an epoch restart. A failed dependency/manifest/authorization gate never triggers a cost retry. Selection-induced source or serialized-request overflow may trigger one joint reconsideration if more than ten seconds remain. That reconsideration uses a compact minimal-support decision with the original coverage obligations. It does not select the first hit, delete a dependency, truncate evidence or reset the deadline. Exact answering independently checks the resulting complete support.

This fixes the audited pattern where complete individual support units fit, but redundant FAQ/body/general selections exceeded the closure capacity. Exhausted selection is identified separately in diagnostics/copy from a claim that the user's necessary evidence is inherently too large. Existing `CONTEXT_BUDGET` diagnostic compatibility is retained. All original source/quote/byte/token limits remain unchanged.

The planner's inference schema now describes optional search aids concretely. Previously the unconstrained `object` schema produced missing/malformed aids; rejecting an aid could also erase a resolved follow-up. Invalid aids no longer destroy a resolved query from user context. For an empty semantic result, the gateway may make one bounded embedding batch over at most three validated aids and fuse the semantic branches with the existing RRF helper. Each aid retains original wording, and final answering uses the original request and resolved user intent. Hybrid SQL and threshold changes are not prerequisites. The similarity threshold remains the saved value.

### Versioned reviewed evidence projection

Additive migration `024_assistant_evidence_projection.sql` introduces a v3 reviewed projection using `kb_document_versions.evidence_roles` and `evidence_binding`. The overlay is bound to source hash, generation, final reviewed structural manifest and role map. It deliberately retains the original v2 chunk graph, canonical text, source hashes, extractor and worker contracts. No published legacy graph is reinterpreted or rewritten.

New publications may explicitly classify every section as `DIRECT`, `QUALIFICATION` or `CONTEXT`. All sections default to required qualifications in the review UI. Choosing context is an explicit administrator review action, requires the existing source/audience/generation-bound approval plus a separate acknowledgment, and is additionally rejected for non-heading body text, unresolved structure/references or operative restriction markers. Ordinary model/regex proposals cannot approve removal of a rule. The existing publication transaction applies reviewed graph edges first, then freezes the projection binding. Idempotent/failed/conflicting publication cannot attach roles to an unpublished version.

`assistant_evidence_costs` validates the complete authorized candidate graph once and calculates bounded per-root dependency membership, operative source counts and byte cost. Full structural bytes remain included in cost; context identity does not consume operative source capacity. `assistant_expand_evidence_v3` returns at most six operative sources and twelve canonical structural context sources. All contributing context sources receive the same final hash/content/epoch/actor checks as answer sources. Private graph/project functions have no client or service-role execute privilege; only the authenticated outer RPCs are exposed to the server. Legacy RPCs retain conservative original behavior.

`RAG_EVIDENCE_CONTRACT=legacy` remains the default. `ms59-v1` admits the new cost/projection/obligation contract only after migration and compatibility acceptance. Unknown admission versions fail safely. New-context responses include a bounded typed requested-obligation map with support references and supported/unverified states; reconsideration retains missing obligations. No client header can enable a reviewed source contract or alter role/audience.

The reverse migration refuses while an active publication depends on reviewed projection metadata. Transition/withdraw affected versions through the normal reviewed lifecycle before removing compatibility support. No active source is silently downgraded or resurrected.

### Useful answers and exact presentation

The answer service retains the original question separately from a search rewrite. Requested-amount checks reject related policy text without an actual amount/rate/full-or-zero rule; list numbers and section numbers are not monetary evidence. A separately verified safe partial general answer may retain a labeled amount gap. The semantic support check still assesses applicability and conditions when a numeric/qualitative rule exists. Missing amounts produce a specific localized gap and appropriate administrator guidance rather than an apparently complete related-policy answer.

Exact packed proof spans remain unchanged. A separate `ms59-v1` presentation maps exact UTF-16 line ranges into headings, text, real steps and bullets. It verifies ordered non-overlapping complete coverage and preserves warnings, repeated text, CRLF, fenced examples and source offsets. The existing twelve-action bound is retained; the 128-atom limit uses the existing passage bound for non-action proof structure. Larger unsupported presentations retain the conservative exact path.

The main view groups real list items across blank lines. A packed six-step procedure becomes six actual actions, not one outer action; titles never become numbered work. Complete procedures use the structured exact fallback rather than the previous deterministic span-as-step “synthesis.” Synthesis validation also rejects heading-only actions and packed nested procedures. The exact supporting-evidence view remains available through the existing component and permission-checked citation routes.

The shared admin/staff launcher negotiates `X-DeskAtlas-Answer-Contract: ms59-v1`. The gateway sends the additional presentation field only to that client version. Old clients retain their strict legacy response shape; unknown presentation versions fail safely. Shared UI/styles, session clearing, cancellation and staff report restrictions remain in place. Generated multilingual prose and original-language exact fallback remain distinct.

Diagnostics add selection/expansion counts, first/final operative union counts where authoritative cost metadata exists, context counts, requested/supported counts, and fixed synthesis fallback reasons. The renderer places enum reason codes in diagnostic details, not normal copy. No transcripts, excerpts, rewrites, credentials or document URLs are logged.

## Reproduction and verification

Existing raw reproduction remains available:

```powershell
node scripts/rag-natural-audit.cjs standalone
node scripts/rag-natural-audit.cjs noise
node scripts/rag-natural-audit.cjs fresh_opening
```

Use `--candidate` for the updated component path, for example:

```powershell
node scripts/rag-natural-audit.cjs standalone --candidate
node scripts/rag-natural-audit.cjs wifi --candidate
node scripts/rag-natural-audit.cjs refund --candidate
pnpm test:ms59
pnpm test:ms59:python
pnpm test:ms59:postgres
```

The candidate probe distinguishes closure admission from exact-answer verification, checks current actor/catalog/source hashes, and expects an explicit no-amount answer for the refund gap. It is a component probe, not an authenticated browser/gateway performance benchmark or independent semantic reviewer. Its bounded candidate union is not the gateway's RRF integration; the actual gateway tests/browser checks cover that path separately. Saved content-free local artifacts are in ignored `services/rag/benchmark-results/ms59/final-*.json`.

The new gateway test first failed on the exact audited symptom (generic document inability instead of escalation guidance), then passed after the bounded retry. Real-model replay exposed further failures in the first retry design and optional-aid schema; both were corrected and replayed rather than relying on the mocked pass.

| Check | Result |
|---|---|
| New TypeScript MS-59 tests | Nine passed; gateway retry/admission/semantic aids and complete exact presentation, including legacy-client negotiation |
| New Python MS-59 tests | 14 passed: amount coverage, schema fidelity, resolved follow-ups, legacy and v3 obligation behavior |
| Python MS-55/56/57/58/runtime plus MS-59 | 87 passed; existing Starlette deprecation warning |
| Disposable PostgreSQL/real Markdown extraction | Passed: explicit review, context projection, legacy behavior, costs, permission denials, binding corruption and guarded forward/down migration |
| `pnpm typecheck`, `pnpm lint` | Passed during implementation; configured lint covers RAG boundaries, including the new domain presentation helper |
| `pnpm test` | Final run: 2,197 passed, six skipped, one pre-existing failure at `tests/spec2-campaigns-and-rewards.test.ts:327` (invalid reward vocabulary) |
| `pnpm build` | Passed across all four apps during implementation |
| Live private API identity | Ready/current after final Python restart; no threshold, hybrid or synthesis activation change |

The final changes to localized copy, negotiated presentation, request-size preflight and the global epoch retry ceiling passed focused checks, typecheck, lint and a fresh four-app production build. The ten-file relevant TypeScript run passed 118 tests. A subsequent focused five-file run passed 54 tests after the epoch ceiling change. The final full test run retained only the campaign failure described above. The final additive-migration test also passed after the negative-heading guard was tightened.

## Live observations and remaining gates

The local signed-in admin browser demonstrated useful noise escalation, the complete eleven-step opening checklist, six real lost-property actions, explicit refund-amount insufficiency, and relevant original-language evidence for a Tagalog Wi-Fi question. The content-free component replay also demonstrated semantic aid recovery for temporary departure and unpaid selection, with the original published legacy SOP unchanged. All twelve final component cases passed their exact-answer/current-source or expected-gap checks: first noise, noise follow-up, opening, lost laptop, online approval, temporary lunch exit, Tagalog Wi-Fi, refund gap, standalone repeated noise, formal wording control, unpaid selection and handover. These are development regressions and do not establish the frozen unseen acceptance score. The browser login later expired normally; no session was fabricated or expiry bypassed to extend testing.

The following remain explicit:

1. Migration 024 has been tested only in a disposable local PostgreSQL database using the established test vector domain. It has not been applied to the configured live Supabase project; production pgvector/RLS/deployment acceptance is separate.
2. The current publication has no newly approved role projection. Heading-only legacy ancestors remain conservatively required and visible. Full capacity/compact-source improvement requires reviewing and publishing an authorized successor and then admitting the new server contract. No upload/reprocessing/publication was performed automatically.
3. Fine-grained policy scoping remains conservative when a published chunk has no reviewed independently scoped units. The assistant cannot silently carve unrelated rules out of such a chunk. Full no-hold Section 11 excerpts can therefore remain longer than desired on the legacy publication.
4. Independent MS-54/59 held-out support labels, sixty-question extension, human language/answer review, owner global refusal threshold and current-corpus staff acceptance are not fabricated or inferred from passing development tests.
5. No one-user/five-user/cold/contention complete-render p95 acceptance is claimed. Component stage measurements are not browser latency. The retained warm p95 target is strictly below five seconds; observed multi-stage local answering can exceed it. Performance acceptance remains pending.
6. Exact source-language fallback is safe evidence behavior, not proof of successful Tagalog/Taglish conversational synthesis. Those quality denominators remain separate.
7. No production activation, release authorization, customer-facing chat or business mutation occurred. Disabling synthesis/new-contract admission retains conservative exact answering, final source checks and tools.

Thus local code and migration preparation are delivered, while publication-dependent usability and the milestone's independent release gates remain open. The normal local portal and private API remain running for inspection. Final `pnpm rag:status` reported ready/current. Local code identity hashes accompany the ignored replay artifacts in `code-identity.json`; they are a source snapshot, not independent approval or a production acceptance identity.
