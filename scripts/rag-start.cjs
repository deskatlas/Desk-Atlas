// SPEC-6 / SDD-C20-C24 / QAD-TC46: local launch with scoped saved configuration.
const { readFileSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');

const root = resolve(__dirname, '..');
const service = join(root, 'services', 'rag');
const apiKeys = [
  'CUSTOMER_ASSISTANT_ENABLED', 'CUSTOMER_ASSISTANT_VERIFIED_ENABLED',
  'RAG_MODEL_PROVIDER', 'RAG_EMBEDDING_PROVIDER', 'DEEPINFRA_API_KEY',
  'RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'RAG_SCOPE_ID',
  'RAG_ANSWER_MODEL', 'RAG_ANSWER_DIGEST', 'RAG_EMBEDDING_FINGERPRINT',
  'RAG_PRELOAD_MODEL', 'RAG_MODEL_GPU_LAYERS', 'RAG_MODEL_KEEP_ALIVE', 'RAG_MODEL_BATCH_SIZE',
  'RAG_COMPACT_SELECTION', 'RAG_PLAN_MAX_TOKENS', 'RAG_ANSWER_MAX_TOKENS', 'RAG_SELECTION_MAX_TOKENS',
  'OLLAMA_URL', 'KB_ENABLED',
];
const purgeKeys = ['KB_ENABLED', 'KB_GATEWAY_URL', 'KB_WORKER_TOKEN', 'KB_WORKER_MODE'];
const workerKeys = [
  'RAG_EMBEDDING_PROVIDER', 'DEEPINFRA_API_KEY',
  'KB_ENABLED', 'KB_GATEWAY_URL', 'KB_WORKER_TOKEN', 'KB_EMBEDDING_THREADS', 'KB_WORKER_MODE',
  'KB_PARSER_IMAGE', 'KB_PARSER_MEMORY', 'KB_PARSER_TIMEOUT_SECONDS',
];

// MS44 / SPEC6-TC01: preserve the measured GPU profile across normal restarts.
function runtimeCommand(mode, env, serviceDirectory) {
  if (mode === 'worker' || mode === 'purge') return ['-m', 'knowledge.worker'];
  if (mode !== 'api') throw new Error('Use api, worker or purge.');
  if (env.RAG_MODEL_PROVIDER !== 'deepinfra' && env.RAG_MODEL_GPU_LAYERS === '-1' && env.OLLAMA_URL === 'http://127.0.0.1:11435')
    return [join(serviceDirectory, 'serve_local.py'), '--gpu'];
  return [join(serviceDirectory, 'serve_local.py')];
}

function runtimeEnvironment(mode, saved, inherited, answer) {
  if (!['api', 'worker', 'purge'].includes(mode)) throw new Error('Use api, worker or purge.');
  const keys = mode === 'api' ? apiKeys : mode === 'purge' ? purgeKeys : workerKeys;
  const provider = inherited.RAG_MODEL_PROVIDER ?? saved.RAG_MODEL_PROVIDER ?? 'ollama';
  if (!['ollama', 'deepinfra'].includes(provider)) throw new Error('Invalid RAG_MODEL_PROVIDER.');
  const defaults = { KB_ENABLED: 'false', KB_GATEWAY_URL: 'http://127.0.0.1:3000', RAG_MODEL_PROVIDER: provider,
    OLLAMA_URL: 'http://127.0.0.1:11434', RAG_ANSWER_MODEL: provider === 'deepinfra' ? 'Qwen/Qwen3-32B' : answer.model,
    RAG_ANSWER_DIGEST: answer.manifest_digest };
  const config = { ...defaults, ...saved, ...inherited };
  // Do not forward app credentials or unrelated assistant/worker secrets.
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/^(SUPABASE_|NEXT_PUBLIC_|RAG_|KB_|OLLAMA_|DEEPINFRA_)/i.test(key)));
  for (const key of keys) if (config[key] !== undefined) env[key] = config[key];
  const embeddingProvider = config.RAG_EMBEDDING_PROVIDER ?? 'local';
  if (!['local', 'deepinfra'].includes(embeddingProvider)) throw new Error('Invalid RAG_EMBEDDING_PROVIDER.');
  if (mode === 'worker' && embeddingProvider !== 'deepinfra') delete env.DEEPINFRA_API_KEY;
  const required = mode === 'api'
    ? ['RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'RAG_SCOPE_ID', provider === 'deepinfra' ? 'DEEPINFRA_API_KEY' : 'RAG_ANSWER_DIGEST']
    : ['KB_WORKER_TOKEN'];
  if (mode !== 'api' && env.KB_ENABLED !== 'true') {
    throw new Error('Set KB_ENABLED=true in apps/admin-portal/.env.local before starting the worker.');
  }
  if (mode === 'api' && env.KB_ENABLED === 'true') required.push('RAG_EMBEDDING_FINGERPRINT');
  if (mode !== 'purge' && embeddingProvider === 'deepinfra') required.push('DEEPINFRA_API_KEY');
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key} in saved configuration.`);
  for (const key of ['RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'KB_WORKER_TOKEN']) {
    if (keys.includes(key) && env[key]?.length < 32) throw new Error(`${key} must contain at least 32 characters.`);
  }
  if (mode === 'purge') env.KB_WORKER_MODE = 'purge';
  return env;
}

// MS50-TC04/07: lifecycle handling is injectable for executable child tests.
function superviseChild(child, mode, host = process, report = console, shutdownMs = 10000) {
  let stopping = false;
  let spawnFailed = false;
  let timer;
  const handlers = new Map();
  const cleanup = () => {
    clearTimeout(timer);
    for (const [signal, handler] of handlers) host.removeListener(signal, handler);
  };
  child.stdin?.on('error', () => {});
  child.on('error', () => {
    spawnFailed = true;
    cleanup();
    report.error('RAG SPAWN_FAILED: verify the isolated Python executable and permissions.');
    host.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    cleanup();
    if (spawnFailed) return;
    if (!stopping) report.error(`RAG CHILD_EXIT: code=${code ?? 'none'} signal=${signal ?? 'none'}. Review the preceding stage diagnostic.`);
    host.exitCode = stopping && (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM')
      ? 0 : mode === 'worker' ? code ?? 1 : code || 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      // Windows kill(SIGINT) terminates Python immediately. The owned pipe lets
      // Uvicorn drain requests and the GPU wrapper reap its own runtime.
      if (mode === 'api') child.stdin.end('shutdown\n');
      else if (!child.killed) child.kill(signal);
      timer = setTimeout(() => {
        report.error('RAG SHUTDOWN_TIMEOUT: owned child did not stop within the shutdown deadline.');
        child.kill();
      }, shutdownMs);
      timer.unref();
    };
    handlers.set(signal, handler);
    host.on(signal, handler);
  }
}

function main() {
  const mode = process.argv[2];
  const files = [join(root, 'apps', 'admin-portal', '.env.local'), join(service, '.env.local')];
  let saved = {};
  for (const file of files) if (existsSync(file)) saved = { ...saved, ...parseEnv(readFileSync(file, 'utf8')) };
  const answer = mode === 'api' ? JSON.parse(readFileSync(join(service, 'answer-model.json'), 'utf8')) : {};
  const env = runtimeEnvironment(mode, saved, process.env, answer);
  const python = join(service, mode === 'api' ? '.venv-service' : '.venv',
    ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  if (!existsSync(python)) throw new Error('Provision the isolated Python environment first; see services/rag/README.md.');
  if (process.argv.includes('--check')) {
    console.log(`${mode}: saved configuration and Python executable available.`);
    return;
  }
  const args = runtimeCommand(mode, env, service);
  if (mode === 'api') args.push('--controlled');
  console.log(`Starting RAG ${mode} with saved configuration. Press Ctrl+C to stop.`);
  console.log(`RAG launch profile: ${mode !== 'api' ? mode : args.includes('--gpu') ? 'gpu' : 'direct'}.`);
  const child = spawn(python, args, { cwd: service, env,
    stdio: mode === 'api' ? ['pipe', 'inherit', 'inherit'] : 'inherit' });
  superviseChild(child, mode);
}

module.exports = { runtimeEnvironment, runtimeCommand, superviseChild };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
