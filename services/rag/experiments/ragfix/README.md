# Rejected ragfix experiments

PRD-F26/F27, SDD-C21/C23 and QAD-TC44-TC46. These modules are isolated research artifacts. Neither the API nor the packaged worker imports them. They are excluded from Cloud Run's source allowlist. Do not activate them based on a model verdict.

| Experiment | Observed result | Decision |
|---|---|---|
| Compact normal-guidance original evidence | A bulk model audit approved a bundle that omitted opening/arrival/checkout passages. A later FAQ fix exposed further missing decision-changing controls. Per-workflow audit rejected the corrected proposal. | Not eligible for storage or serving |
| Exact condition closures | SOP audit rejected the first variant; object output failed; the approved 235B model returned invalid output. Some payment groups passed but no complete corpus passed. | No migration or serving change |
| JSON-object internal output | The three exposed broad cases took 17,419, 9,993 and 14,580 ms, with no useful supported answer. | Removed from API |
| Source-first draft fields | Daily guidance failed at 17,469 ms; payments failed at 8,440 ms; arrival failed with invalid output at 11,564 ms. | Removed from API |
| Scope-first verifier | Arrival returned SUPPORTED in 8,031 ms while still instructing unconditional payment collection. Other cases failed. | Rejected and reverted |

Raw numeric/component reports are in `outputs/admin-rag-audit-2026-10-28/`. These are repeated exposed regression questions, not held-out acceptance. The saved compact-guidance files in the ignored cache are rejected experimental outputs, not trusted policy artifacts. No release threshold passed.

The later [original-rule guard canary](RULE-GRAPH-CANARY.md) also remains
non-serving. Its final full-original payment audit checked all 84 rule bindings
and rejected all 84. `node scripts/prepare-ragfix-guidance.cjs 10 --rules` is an
explicit paid, read-only reproduction, not an artifact publication command.

Read-only reproduction for preparation: `node scripts/prepare-ragfix-guidance.cjs 6` or append `--exact-conditions`. This invokes paid inference on the approved model. It cannot publish artifacts. The current compact-guide canary freezes 192 maximum body units, 25 calls, 2,000,000 aggregate request bytes, 1,536 selection output tokens and 512 per-workflow audit output tokens, with a 180-second offline per-call timeout. The condition canary freezes 24 calls, 2,000,000 bytes and 512 output tokens per call. These offline limits do not change chat deadlines.
