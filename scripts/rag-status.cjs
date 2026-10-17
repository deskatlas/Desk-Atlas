// MS53 / SDD-C21: authenticated content-free detection of stale local API code.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { createHash, createHmac, randomUUID } = require('node:crypto');
const { runtimeEnvironment } = require('./rag-start.cjs');
const root = path.resolve(__dirname, '..');
const service = path.join(root, 'services/rag');
function fingerprint(directory = service) {
  const hash = createHash('sha256');
  for (const name of ['rag/document_support.py', 'rag/ms65-budget.json', 'app.py', 'rag/encoder.py', 'rag/evidence.py', 'rag/evidence_budget.py', 'rag/evidence-budget.json', 'rag/governance.py', 'rag/procedure.py', 'rag/obligations.py', 'rag/request_boundary.py', 'rag/request_timing.py', 'rag/runtime_identity.py', 'serve_local.py']) {
    hash.update(name + '\0'); hash.update(fs.readFileSync(path.join(directory, name)));
  }
  return hash.digest('hex');
}
async function main() {
  let saved = {};
  for (const file of ['apps/admin-portal/.env.local', 'services/rag/.env.local']) {
    if (fs.existsSync(path.join(root, file))) Object.assign(saved, parseEnv(fs.readFileSync(path.join(root, file), 'utf8')));
  }
  const env = runtimeEnvironment('api', saved, process.env, JSON.parse(fs.readFileSync(path.join(service, 'answer-model.json'), 'utf8')));
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: randomUUID(), role: 'ADMIN', request_id: randomUUID(),
    scope: env.RAG_SCOPE_ID, ops: ['answer'], iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
  const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(body).digest('base64url');
  const response = await fetch('http://127.0.0.1:8000/health', { headers: {
    Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${body}.${signature}`,
  }, signal: AbortSignal.timeout(5000) });
  const health = response.ok ? await response.json() : {};
  const current = health.ready === true && health.implementation_fingerprint === fingerprint();
  console.log(JSON.stringify({ ready: health.ready === true, implementation_current: current,
    active_requests: Number(response.headers.get('x-rag-active')) || null,
    guidance: current ? 'CURRENT' : 'Restart the local RAG API to load current serving code.' }));
  return current ? 0 : 1;
}
module.exports = { fingerprint };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.log(JSON.stringify({ ready: false, implementation_current: false, guidance: 'Local authenticated API check failed.' }));
  process.exitCode = 1;
});
