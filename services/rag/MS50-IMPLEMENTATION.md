# MS-50 Implementation and Local Evidence

Date: October 15, 2026 (Asia/Irkutsk).
Traceability: BRD-M5/M6, PRD-F26/F27, SDD-C20/C21, QAD-TC46, MS50-TC01 through TC09.

## Confirmed incident

The unchanged `pnpm rag:api` printed its starting message and exited with code 1
without a cause. A pre-existing Python listener owned loopback port 8000.
A bind-only probe returned `EADDRINUSE`. Repeating the original GPU wrapper with
only Uvicorn error visibility changed confirmed a port-binding rejection and
no application-initialization rejection. The wrapper's critical log level
suppressed the binding error. The existing API and Ollama listeners were preserved.

## Delivered changes

- Reserve the exclusive loopback API socket before model loading and hand the
  same socket to Uvicorn, avoiding a check/bind race or listener replacement.
- Route both API profiles through the same safe startup boundary. Preserve
  saved-setting precedence, separate worker credentials and the GPU profile's
  preload/residency checks. No models, dependencies or saved settings changed.
- Emit fixed stage/error codes and corrective guidance instead of exception
  text, tracebacks, source content, credentials or arbitrary child diagnostics.
- Report Ready only after Uvicorn completes the original application lifespan.
  Preserve encoder artifact hashes, fingerprints, model digests and capabilities.
- Bound asynchronous startup and add an independent 180-second watchdog for
  synchronous native imports/encoder loading. On timeout, report failure, stop
  only the GPU runtime owned by this invocation and exit nonzero.
- Handle Ctrl+C/SIGTERM through a private API control pipe, with a 10-second
  parent shutdown deadline. EOF requests shutdown if the parent disappears.
  Reap an owned GPU runtime, preserve a reused one and retain worker forwarding.
- Provide launcher/runtime regressions and an explicit real-runtime canary on
  an ephemeral loopback port without changing the normal command's port.

## Verification

| Check | Observed result |
|---|---|
| `pnpm test:ms50` | 12 tests passed |
| `pnpm test:ms50:python` | 13 tests passed |
| Python MS-50, MS-44 and assistant suites | 44 passed before the final six additional MS-50 cases; final MS-50 suite rerun separately |
| `pnpm typecheck` | Passed across all workspace projects |
| `pnpm lint` | Final run passed; an earlier unrelated knowledge-jobs-route finding was resolved elsewhere in the shared working tree |
| `pnpm build` | All four Next.js applications passed |
| `pnpm run test --maxWorkers=4` | 2,053 passed, 3 skipped, one unrelated campaign-schema assertion failed at `tests/spec2-campaigns-and-rewards.test.ts:327` |
| Original full-concurrency `pnpm test` | Same campaign assertion plus a worker-start error; reduced-concurrency rerun had no worker error |
| Normal `pnpm rag:api` after correction | Explicit `API_PORT_IN_USE`, code 1; existing listener remained reachable |
| Real saved-profile ephemeral-port canary | Startup acceptance pending: the real encoder initialization exceeded the canary's 180-second deadline |

The canary repeats the real application's original lifespan and pins; it never
substitutes fake models or disables knowledge. It reports fixed stage names.
The measured blocking stage was the offline embedding encoder constructor.
No 60-second live availability, authorized canary success, normal-port successful
restart or physical Ctrl+C acceptance is claimed. The executable canary remains
available as `pnpm rag:startup-canary` for the configured runtime once that
initialization can complete within its deadline.

## Remaining acceptance

Normal-command startup acceptance requires port 8000 to be intentionally made
available by its owner, or continued use of the already-running service.
Do not automatically terminate that listener. Investigate the separate native
encoder initialization delay on this host without changing the approved model,
disabling integrity checks, lowering the profile or treating fixture tests as
live recovery evidence. Validate real Ctrl+C and supported termination on the
normal command after the runtime reaches readiness. Non-Windows launch paths
are retained, but this verification host was Windows.
