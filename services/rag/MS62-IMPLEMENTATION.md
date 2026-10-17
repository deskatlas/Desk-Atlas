# MS-62 local implementation

Date: October 17, 2026, Asia/Irkutsk. Authority: maintainer request to implement MS-62. Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46 and MS62-TC01 through MS62-TC08.

## Behavior and proof

The domain's `exactAssistantMainAtoms` supplies a deterministic render projection over the existing complete ms59-v1 atoms. It copies canonical offsets and never edits or replaces summary, spans, hashes or citations. Only a leading cluster of headings and exact metadata labels is eligible. A title/path can disappear only when every part remains represented by an exact heading in that same cluster and same evidence span. Consecutive duplicate headings there appear once. Once body content or an action starts, headings and labels remain in full. Indented and fenced examples remain literal. Later repeated stage headings, ordered actions, repeated actions, prose restrictions and unreviewed FAQ/body duplicates survive.

The shared staff/admin renderer uses this projection with its existing typography, source mappings and native keyboard-operable proof disclosure. Canonical proof still renders completely. The older global heading de-duplication could remove later stage scope, and a cross-source heading set could incorrectly justify hiding a breadcrumb; both are replaced by the bounded source-local seam. Negotiated main blocks already passed support review and are now rendered without further navigation filtering. Legacy synthesis rendering and wire negotiation remain compatible.

The private canonical-unit builder no longer discards text because it matches document titles or heading paths and lacks a small set of role/condition words. A heading such as "During an emergency" can carry scope without those words. All nonblank canonical units remain available to selection and independent support review. There is no new model round, token ceiling, evidence budget, retry, dependency, source processing/publication or migration. Synthesis/support still share their existing eight-second subdeadline and overall request budget. Final source, role and epoch checks remain mandatory.

## Diagnosis and frozen reproductions

Historical browser repetition does not prove why optional synthesis failed. The original re-audit and remediation remain historical records. No reason has been retroactively assigned to those runs.

Authenticated mocked gateway reproductions independently exercise synthesis schema rejection, support schema rejection, support rejection, synthesis timeout, support timeout, service failure and disabled synthesis. A returned MODEL_TIMEOUT previously became SERVICE_FAILURE when the local abort signal had not fired; it now reports TIMEOUT. Malformed support output now reports SUPPORT_SCHEMA_REJECTED. The allowlisted `fallback_stage` distinguishes ADMISSION, SYNTHESIS and SUPPORT. TRANSLATION_GATED remains distinguishable defensively; MS-61's corrected English output policy ordinarily avoids it.

On negotiated exact responses, authorized opt-in diagnostics also include `exact_presentation` with structural/original status, omitted/visible atom counts and `acceptance: PENDING`. Structural reduction is not a semantic completeness or concision certification. Diagnostic fields contain no questions, source prose or rejected generated text. Existing synthesis status and answer mode remain truthful: exact projection is still EXACT, never SYNTHESIZED.

## Verification

Final local checks:

| Command | Result |
|---|---|
| `pnpm test:ms62` | 52 passed across four TypeScript suites |
| `pnpm test:ms62:python` | 73 passed; existing Starlette/anyio deprecation warning |
| `pnpm typecheck` | Passed across packages and all four applications |
| `pnpm lint` | Passed, 28 TypeScript and 27 Python boundary files |
| `pnpm build` | All four production application builds passed |
| `pnpm test` final run | 2,251 passed, 14 skipped, three failures: the previously documented SPEC2-TC05 campaign vocabulary assertion at `tests/spec2-campaigns-and-rewards.test.ts:327`, and two unrelated MS-05 cache-header tests timing out at 20 seconds |
| Isolated MS-05 rerun | Both cache-header files passed, nine tests total; no timeout limit changed |

The full-suite run overlapped typechecking/building; isolated cache-header success is recorded separately and does not relabel that full run as passed. Earlier development checks caught an inferred Zod type mismatch under the UI package compiler settings and an indented-title suppression regression; both were corrected and covered by the passing final checks. No unrelated campaign code was modified.

Fixtures cover noise escalation, stage-specific scope, different FAQ qualifications, repeated actions, literal content, CRLF/UTF-16 offsets, no-hold/payment decisions, missing amounts, legacy rendering and full proof. Existing gateway controls cover cancellation, final withdrawal, role revocation and epoch changes. Repository diff whitespace checks passed for touched tracked files. The repository currently ignores `docs/`; milestone and registry edits exist locally, while this implementation record remains available in the normal service source tree.

## Remaining acceptance and rollback

Semantic equivalence of differently worded FAQ/body text has no reviewed representation in the current proof contract. It is deliberately retained. Similarity, matching names or generated confidence are not sufficient to remove it. A future reviewed equivalence contract and held-out semantic completeness/readability assessment remain pending. This implementation does not certify all exact fallbacks as concise.

Native disclosure markup and shared rendering are component-tested. New normally authenticated staff/admin browser runs, keyboard/source-access verification, repeated historical conversation runs and one/five-user complete-render performance are not claimed here. MS-63 owns those integrated gates. English remains the expected MS-61 response language.

Rollback of the render projection can return all original atoms unchanged. Dropping ms59-v1 negotiation retains legacy original-summary rendering. Keep the complete proof path and final authorization checks intact. No database or publication rollback is needed. No runtime restart, activation or deployment was performed.
