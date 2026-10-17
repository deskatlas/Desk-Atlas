// MS50-TC01/02/07/09 / QAD-TC46: real saved-profile canary on an ephemeral
// loopback port. Never replaces the existing listener or prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { runtimeEnvironment } = require('./rag-start.cjs');
const root = path.resolve(__dirname, '..');
const service = path.join(root, 'services', 'rag');
let saved = {};
for (const file of [path.join(root, 'apps/admin-portal/.env.local'), path.join(service, '.env.local')]) {
  if (fs.existsSync(file)) Object.assign(saved, parseEnv(fs.readFileSync(file, 'utf8')));
}
const env = runtimeEnvironment('api', saved, process.env, JSON.parse(fs.readFileSync(path.join(service, 'answer-model.json'), 'utf8')));
const python = path.join(service, '.venv-service', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const code = `
import asyncio, os
from serve_local import reserve_api_socket, serve, start_gpu, stop_owned, diagnostic, StartupFailure, preload_encoder_runtime
sock = reserve_api_socket(0)
gpu = None
try:
    print('CANARY_STAGE runtime', flush=True)
    if os.environ.get('RAG_MODEL_GPU_LAYERS') == '-1' and os.environ.get('OLLAMA_URL') == 'http://127.0.0.1:11435':
        gpu = start_gpu()
    from app import app
    import app as api
    import rag.encoder as encoder
    original_encoder = encoder.Encoder
    def measured_encoder(*args, **kwargs):
        print('CANARY_STAGE embedding', flush=True)
        result = original_encoder(*args, **kwargs)
        print('CANARY_STAGE embedding_complete', flush=True)
        return result
    encoder.Encoder = measured_encoder
    def measured_call(original, stage):
        async def measured(*args, **kwargs):
            print('CANARY_STAGE ' + stage, flush=True)
            result = await original(*args, **kwargs)
            print('CANARY_STAGE ' + stage + '_complete', flush=True)
            return result
        return measured
    api.verify_model = measured_call(api.verify_model, 'model_verification')
    api.model_request = measured_call(api.model_request, 'model_preload')
    print('CANARY_STAGE initialization', flush=True)
    preload_encoder_runtime()
    asyncio.run(serve(app, sock, controlled=True))
except StartupFailure as error:
    diagnostic(error.args[0])
    raise SystemExit(1) from None
except Exception:
    diagnostic('API_RUNTIME_FAILED')
    raise SystemExit(1) from None
finally:
    sock.close()
    stop_owned(gpu)
`;
const child = spawn(python, ['-u', '-c', code], { cwd: service, env, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});
let ready;
let rejectReady;
let output = '';
const readiness = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
child.stdout.on('data', chunk => {
  output = (output + chunk.toString()).slice(-4096);
  const match = output.match(/RAG API Ready: application initialization completed on 127\.0\.0\.1:(\d+)\./);
  if (match) ready(Number(match[1]));
  for (const stage of chunk.toString().matchAll(/CANARY_STAGE ([a-z_]+)/g)) console.log(`Canary stage: ${stage[1]}`);
});
child.stderr.on('data', chunk => {
  const match = chunk.toString().match(/RAG ([A-Z_]+):/);
  if (match) console.error(`Canary stage: ${match[1]}`);
});
const ended = new Promise(resolve => child.once('exit', (code, signal) => {
  rejectReady(new Error('Child exited before readiness'));
  resolve({ code, signal });
}));
child.once('error', () => rejectReady(new Error('Child spawn failed')));
function headers() {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'deskatlas', aud: 'rag', sub: randomUUID(), role: 'ADMIN', request_id: randomUUID(),
    scope: env.RAG_SCOPE_ID, ops: ['search', 'answer'], iat: now, exp: now + 60, generation: randomUUID() };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
  return { Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}` };
}
(async () => {
  const deadline = setTimeout(() => rejectReady(new Error('Startup deadline exceeded')), 180000);
  try {
    const port = await readiness;
    clearTimeout(deadline);
    const url = `http://127.0.0.1:${port}/health`;
    const unauthorized = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (unauthorized.status !== 401) throw new Error('Unauthorized request was not denied');
    const started = Date.now();
    for (let index = 0; index <= 4; index++) {
      const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(5000) });
      if (!response.ok || (await response.json()).ready !== true) throw new Error('Authenticated health check failed');
      if (index < 4) await new Promise(resolve => setTimeout(resolve, 15000));
    }
    console.log(JSON.stringify({ ready: true, authenticated_requests: 5, unauthorized_status: 401,
      available_seconds: Math.floor((Date.now() - started) / 1000), binding: 'ephemeral-loopback',
      profile: env.RAG_MODEL_GPU_LAYERS === '-1' ? 'gpu' : 'direct' }));
    child.stdin.end('shutdown\n');
    const result = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(null), 10000))]);
    if (!result || result.code !== 0) throw new Error('Clean shutdown failed');
    console.log('Canary clean shutdown: PASS');
  } catch (error) {
    const safeReasons = ['Child exited before readiness', 'Child spawn failed', 'Startup deadline exceeded',
      'Unauthorized request was not denied', 'Authenticated health check failed', 'Clean shutdown failed'];
    const reason = safeReasons.includes(error.message) ? error.message : 'Request transport failed';
    console.error(`MS50 real runtime canary: FAILED (${reason}).`);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) {
      child.stdin.end('shutdown\n');
      const timer = setTimeout(() => child.kill(), 10000);
      timer.unref();
    }
  }
})();
