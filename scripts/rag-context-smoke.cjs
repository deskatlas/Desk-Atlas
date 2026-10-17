// MS44-TC09 / MS48: real four-candidate selection, synthetic evidence only.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { randomUUID, createHmac } = require('node:crypto');

async function main() {
  const saved = parseEnv(readFileSync(resolve(__dirname, '../apps/admin-portal/.env.local'), 'utf8'));
  const env = { ...saved, ...process.env };
  if (!env.RAG_SERVICE_TOKEN || !env.RAG_CAPABILITY_SECRET || !env.RAG_SCOPE_ID) throw new Error('CONFIGURATION_REQUIRED');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: randomUUID(), role: 'ADMIN',
    request_id: randomUUID(), scope: env.RAG_SCOPE_ID, ops: ['answer'], iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
  const capability = `${payload}.${createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url')}`;
  const singleFact = process.argv.includes('--single-fact');
  const conflict = process.argv.includes('--conflict');
  const multiClause = process.argv.includes('--multi-clause');
  const texts = conflict ? ['Only administrators may approve online payment proofs.', 'Staff may approve online payment proofs.',
    'Employees must follow the SOP.', 'Management periodically reviews the SOP.'] : (singleFact || multiClause) ? ['Employees must follow the SOP.', 'Management is responsible for reviewing the SOP.',
    'Employees should submit suggestions to management for review.', 'The SOP describes standard working procedures.'] :
    ['Step 1: locate the reservation.', 'Step 2: verify that the customer is checked in.',
    'Step 3: confirm final departure and select Check Out.', 'Step 4: verify the successful checkout result.'];
  const sources = texts.map(content => ({
    document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic SOP',
    heading_path: singleFact || multiClause || conflict ? 'Governance' : 'Checkout', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content,
  }));
  const start = performance.now();
  const response = await fetch(new URL('/v1/context', env.RAG_SERVICE_URL || 'http://127.0.0.1:8000'), {
    method: 'POST', headers: { Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: conflict ? 'Who may approve online payment proofs?' : multiClause ? 'Who reviews the SOP and what should employees do with suggestions?' : singleFact ? 'What should employees do if they have suggestions for improving the SOP?' : 'What are the four steps of the checkout procedure?', sources }), signal: AbortSignal.timeout(55000),
  });
  const result = await response.json();
  const ids = result.chunk_ids;
  const expectedIndexes = conflict ? [0, 1] : multiClause ? [1, 2] : singleFact ? [2] : [0, 1, 2, 3];
  const expected = expectedIndexes.map(index => sources[index].chunk_id);
  const passed = response.ok && result.ambiguous === false && Array.isArray(ids) && ids.length === expected.length &&
    new Set(ids).size === expected.length && ids.every(id => expected.includes(id));
  process.stdout.write(JSON.stringify({ synthetic: true, passed, elapsed_ms: Math.round(performance.now() - start),
    status: response.status, detail: typeof result.detail === 'string' ? result.detail : undefined,
    selected_count: Array.isArray(ids) ? ids.length : 0,
    selected_indexes: Array.isArray(ids) ? ids.map(id => sources.findIndex(source => source.chunk_id === id)) : [],
    input_tokens: response.headers.get('x-rag-input-tokens'),
    output_tokens: response.headers.get('x-rag-output-tokens'), server_timing: response.headers.get('server-timing') }) + '\n');
  if (!passed) process.exitCode = 1;
}
main().catch(() => { process.stderr.write('CONTEXT_SMOKE_FAILED: verify the local runtime and saved configuration.\n'); process.exitCode = 1; });
