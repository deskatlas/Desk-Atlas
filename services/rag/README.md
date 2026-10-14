# DeskAtlas private assistant service

SPEC-4 / PRD-F26 / SDD-C20-C22 / QAD-TC44. Python performs bounded planning, query embedding and extractive document answer selection. TypeScript owns authorization, tools, arithmetic, citations and final evidence checks. No chat history is persisted. Do not enable HTTP payload/access logging, Ollama debug logging, tracing bodies, or external inference fallback.

Local answer candidate: Ollama `qwen3:4b`, CPU (`num_gpu: 0`), with a full pinned digest from `/api/tags`. Query and ingestion embeddings share the offline HF Qwen3-Embedding-0.6B encoder, immutable revision and complete fingerprint in `models.json`. Quantized Ollama embeddings are not interchangeable with this generation. Candidates have not passed the five-user or multilingual acceptance gates. Preserve model license notices. See [SPEC-6 operations](OPERATIONS.md) and [measured evidence](EVIDENCE.md) for setup, evaluation and release gates.

1. Create the isolated service environment with Python 3.12 and `bootstrap_service.py`. It installs the combined pinned HTTP and CPU encoder dependencies needed for KB-enabled serving. CPU encoder evaluation uses the separate `bootstrap.py` environment. See OPERATIONS.md for the combined runtime dependency lock.
2. Provision the HF artifacts with `provision_models.py` in the CPU evaluation environment. Provision an approved Ollama answer candidate separately and pin its full digest before use. Keep Ollama bound to loopback or approved private TLS; CPU options are request-specific.
3. Set the variables in `.env.example` through a secure environment loader. Use separate random secrets of at least 32 characters for service authentication and capability signing. Share them with the application servers. No secrets belong in source control. Record the full artifact digests locally.
4. Start one API process: `python -m uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log --log-level critical` from this directory. No model payloads should appear in proxy/client/runner diagnostics.
5. Configure app servers with `RAG_SERVICE_URL=http://127.0.0.1:8000`, the matching scope and secrets. Keep `RAG_ENABLED=false` and `KB_ENABLED=false` until the relevant security/evidence/release gates pass.
6. Apply only additive migrations 014 and 015 through the normal database migration process. Never run a reset. Migrations have matching reverse files. The shared pgvector extension requires `vector_norm` support in the `extensions` schema. PostgreSQL/RLS verification must precede activation.
7. SPEC-5 owns ingestion, private storage, review and publication. This implementation creates only published retrieval foundations. Do not seed the knowledge corpus with repository specs or SOPs. `KB_ENABLED=true` requires a valid catalog, a calibrated `RAG_MIN_SIMILARITY` and matching `RAG_EMBEDDING_FINGERPRINT`. The fingerprint must encode model digest, query instruction, dimensions, normalization and encoding options; never mix fingerprints.
8. Run `pnpm test:spec6`, Python assistant tests in `.venv-service`, and ingestion tests in `.venv`, plus `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Run database and held-out multilingual/five-user tests before rollout.

The API is authenticated by a private service token and a 60-second HMAC capability. Caller headers cannot select role or scope. The gateway uses `/v1/plan`, `/v1/embed`, `/v1/answer`; Python does not need reverse callbacks. Direct internal tool/search calls are denied unless tied to a live originating gateway request. Multiple application replicas need request affinity for optional reverse callbacks; direct gateway orchestration does not depend on it.

Two inference slots and five admitted HTTP calls bound local memory/work. Requests time out rather than running a durable chat queue. The ASGI boundary propagates disconnect/deadline cancellation to queued handlers and HTTP inference. Native encoder threads cannot be interrupted: their admission and model slots remain held until work exits. Actual Ollama cancellation-to-capacity-release still requires runtime measurement. The panel never stores messages in browser storage. No benchmark or production deployment is implied by a successful build.

MS-44 adds content-free Server-Timing spans, numeric token counts, an opt-in SOP planning experiment, and an authenticated gateway benchmark. See [implementation and reproduction record](MS44-EVIDENCE.md) for controls, commands, limits, and outstanding acceptance evidence.

For the measured local AMD GPU profile, run from the repository root:

```powershell
services/rag/.venv-service/Scripts/python.exe services/rag/serve_local.py --gateway-env apps/admin-portal/.env.local --gpu
```

Stop the previous RAG service on 8000 first. The launcher uses the existing installed Ollama/model, starts or reuses a private Vulkan instance on 11435, verifies/preloads the pinned GPU model and retains it. It leaves the normal Ollama server on 11434 unchanged. CPU remains the default without `--gpu`. Compact passage selection expands indexes into exact source text and performs an independent support check before the gateway revalidates citations. Use `selection_smoke.py --gpu` in the service environment for the synthetic real-model component checks. The measured exact FAQ achieved 2.271-second warm p95 over 30 complete cited answers; broader acceptance gates remain separate.
