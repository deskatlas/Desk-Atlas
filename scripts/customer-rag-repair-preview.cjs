// PRD-F26 / QAD-TC44/46: isolated loopback matching-build review, no source writes.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const http = require('node:http');
const mode = process.argv[2];
if (mode === 'proxy') {
  const upstream = new URL('http://127.0.0.1:3011');
  const origin = 'http://127.0.0.1:3013';
  http.createServer((request, response) => {
    if (request.headers.origin && request.headers.origin !== origin) { response.writeHead(403); response.end(); return; }
    const forwarded = http.request(new URL(request.url, upstream), { method: request.method,
      headers: { ...request.headers, host: upstream.host, ...(request.headers.origin ? { origin: upstream.origin } : {}),
        'x-real-ip': request.socket.remoteAddress } }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
    forwarded.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  }).listen(3013, '127.0.0.1', () => console.log('Customer review: http://127.0.0.1:3013'));
} else if (mode === 'api') {
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')),
    ...parseEnv(readFileSync('services/rag/.env.local', 'utf8')), ...process.env,
    RAG_MODEL_PROVIDER: 'deepinfra', RAG_EMBEDDING_PROVIDER: 'deepinfra',
    RAG_ANSWER_MODEL: 'Qwen/Qwen3-32B', RAG_DOCUMENT_ANSWER_MODEL: 'Qwen/Qwen3.6-35B-A3B',
    RAG_INTERNAL_DISCOVERY_MODEL: 'Qwen/Qwen3.6-35B-A3B', RAG_DEEPINFRA_SERVICE_TIER: 'standard',
    RAG_CUSTOMER_BATCHED_SUPPORT: 'true', RAG_INTERNAL_BATCHED_SUPPORT: 'true',
    RAG_QWEN_COMPACT_CATALOG: 'true', RAG_QWEN_CATALOG_RETRY: 'true', RAG_QWEN_COMPACT_DRAFT: 'true',
    RAG_TASK_FRAMED_DRAFT: 'true', RAG_BENCHMARK_ENABLED: 'false', RAG_FAST_MODEL_RELEASE: 'false' };
  const code = 'print("Review API: importing application", flush=True); from app import app; app.state.startup_progress=lambda stage: print("Review API: " + stage, flush=True); import uvicorn; uvicorn.run(app, host="127.0.0.1", port=8024, log_level="warning", access_log=False)';
  const child = spawn(resolve('services/rag/.venv-service/Scripts/python.exe'), ['-u', '-c', code], { cwd: resolve('services/rag'), env, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
} else throw Error('Use api or proxy');
