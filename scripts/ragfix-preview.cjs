// PRD-F26 / QAD-TC44/46: local preview only; credentials stay in process memory.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const apiPort = process.env.RAG_PREVIEW_API_PORT || '8010';
if (!/^\d{4,5}$/.test(apiPort) || Number(apiPort) > 65535) throw Error('INVALID_PREVIEW_PORT');
const mode = process.argv[2];
if (!['api', 'admin', 'production', 'support', 'customer', 'customer-production', 'staff'].includes(mode)) throw Error('INVALID_PREVIEW_MODE');
const customerMode = mode === 'customer' || mode === 'customer-production';
const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')),
  ...(customerMode ? parseEnv(readFileSync('apps/customer-website/.env.local', 'utf8')) : {}),
  ...(mode === 'staff' ? parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')) : {}),
  ...parseEnv(readFileSync('services/rag/.env.local', 'utf8')), ...process.env,
  RAG_SERVICE_URL: `http://127.0.0.1:${apiPort}`, RAG_EVIDENCE_CONTRACT: 'ms65-v1',
  RAG_DIAGNOSTICS_ENABLED: 'true', RAG_GUIDANCE_FAST_PATH: 'true',
  RAG_INTERNAL_BATCHED_SUPPORT: 'true', RAG_MODEL_PROVIDER: 'deepinfra', RAG_EMBEDDING_PROVIDER: 'deepinfra' };
if (customerMode) Object.assign(env, {
  CUSTOMER_ASSISTANT_ENABLED: 'true', NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED: 'true',
  CUSTOMER_ASSISTANT_ALLOWED_ORIGINS: 'http://127.0.0.1:3011',
  // Production preview is loopback-only and requires the benchmark's local
  // ingress, which overwrites this header from the actual socket address.
  CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER: mode === 'customer-production' ? 'x-real-ip' : '',
  CUSTOMER_ASSISTANT_CATALOG_DISCOVERY: process.env.CUSTOMER_ASSISTANT_CATALOG_DISCOVERY || 'false',
});
const python = resolve('services/rag/.venv-service/Scripts/python.exe');
const preparationEnv = { ...env, RAG_DOCUMENT_ANSWER_MODEL: 'Qwen/Qwen3-32B', RAG_PREPARATION_FORMAT: 'bounded_schema' };
const fingerprint = spawnSync(python, ['-c', 'from knowledge.support_runtime import compiler_fingerprint; print(compiler_fingerprint())'],
  { cwd: resolve('services/rag'), env: preparationEnv, encoding: 'utf8' });
if (fingerprint.status !== 0 || !/^[a-f0-9]{64}$/.test(fingerprint.stdout.trim())) throw Error('PREPARATION_FINGERPRINT_FAILED');
Object.assign(env, { RAG_PREPARED_SUPPORT: 'true', KB_SUPPORT_PREPARATION_ENABLED: 'true',
  RAG_PREPARATION_FINGERPRINT: fingerprint.stdout.trim() });
const child = customerMode
  ? spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [resolve('apps/customer-website')] }), mode === 'customer-production' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3011'], { cwd: resolve('apps/customer-website'), env, stdio: 'inherit' })
  : mode === 'staff'
  ? spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [resolve('apps/staff-dashboard')] }), 'dev', '--hostname', '127.0.0.1', '--port', '3012'], { cwd: resolve('apps/staff-dashboard'), env, stdio: 'inherit' })
  : mode === 'support'
  ? spawn(python, ['-m', 'knowledge.worker'], { cwd: resolve('services/rag'),
    env: { ...env, ...preparationEnv, KB_WORKER_MODE: 'support', KB_GATEWAY_URL: 'http://127.0.0.1:3010' }, stdio: 'inherit' })
  : mode === 'api'
  ? spawn(resolve('services/rag/.venv-service/Scripts/python.exe'), ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', apiPort, '--log-level', 'warning', '--no-access-log'], { cwd: resolve('services/rag'), env, stdio: 'inherit' })
  : spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [resolve('apps/admin-portal')] }), mode === 'production' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3010'], { cwd: resolve('apps/admin-portal'), env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
