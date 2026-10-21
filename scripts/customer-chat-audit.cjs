const { randomUUID, createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');

async function main() {
  const message = process.argv[2] || 'Hi, paano mag-book dito?';
  const started = Date.now();
  if (process.argv.includes('--plan') || process.argv.includes('--trace')) {
    const env = { ...parseEnv(readFileSync('apps/customer-website/.env.local', 'utf8')), ...process.env };
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'deskatlas', aud: 'rag', surface: 'customer', principal: 'PUBLIC_VISITOR', sub: randomUUID(),
      scope: env.RAG_SCOPE_ID, request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(),
      ops: ['customer_knowledge', 'public_workspace', 'public_availability', 'public_price'], audiences: ['CUSTOMER'], iat: now, exp: now + 60 };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
    const headers = {
      Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}`, 'Content-Type': 'application/json',
    };
    const model = async (path, body) => {
      const began = Date.now();
      const result = await fetch(new URL('/v1/customer/' + path, env.RAG_SERVICE_URL), { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await result.json();
      console.log(JSON.stringify({ stage: path, status: result.status, elapsed_ms: Date.now() - began, detail: data.detail || data.error }));
      if (!result.ok) throw new Error('STAGE_FAILED');
      return data;
    };
    if (process.argv.includes('--trace')) {
      const { createClient } = require('@supabase/supabase-js');
      const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const args = { p_actor: claims.sub, p_principal: claims.principal, p_scope: claims.scope, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT };
      const rpc = async (name, input = {}) => {
        const result = await db.rpc(name, { ...args, ...input });
        if (result.error) throw new Error('READ_FAILED');
        return result.data;
      };
      const plan = await model('plan', { message, user_turns: [], has_spot_context: false });
      const question = plan.search_query ? `${message}\nSearch interpretation (not evidence): ${plan.search_query}` : message;
      const embedding = await model('embed', { query: plan.search_query || message });
      const seeds = await rpc('customer_search_knowledge', { p_vector: embedding.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
      console.log(JSON.stringify({ stage: 'search', candidates: seeds.length, titles: [...new Set(seeds.map(s => s.title))] }));
      if (!seeds.length) return;
      const selected = await model('knowledge-selection', { message: question, sources: seeds });
      console.log(JSON.stringify({ stage: 'selection', count: selected.chunk_ids.length }));
      if (!selected.chunk_ids.length) return;
      const evidence = await rpc('customer_document_evidence', { p_chunks: selected.chunk_ids });
      console.log(JSON.stringify({ stage: 'document', chunks: evidence.sources.length, bytes: Buffer.byteLength(JSON.stringify(evidence.sources)) }));
      const proof = await model('document-support', { contract: 'ms65-v1', query: question, sources: evidence.sources, synthesis: true });
      console.log(JSON.stringify({ stage: 'proof', outcome: proof.outcome, counts: proof.counts, summary: proof.synthesis?.blocks.map(b => b.text).join('\n') }));
      return;
    }
    const response = await fetch(new URL('/v1/customer/plan', env.RAG_SERVICE_URL), { method: 'POST', headers, body: JSON.stringify({ message, user_turns: [], has_spot_context: process.argv.includes('--context') }) });
    console.log(JSON.stringify({ message, status: response.status, body: await response.json(), elapsed_ms: Date.now() - started }));
    return;
  }
  const base = 'http://localhost:3001/api/customer-assistant/';
  const session = await fetch(base + 'session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!session.ok) throw new Error('SESSION_UNAVAILABLE');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + 'query', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message, request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(), user_turns: [] }) });
  const answer = await response.json();
  const passed = response.ok && answer.kind === 'ANSWER' && answer.citations?.length > 0;
  console.log(JSON.stringify({ message, status: response.status, kind: answer.kind, summary: answer.summary, error: answer.error,
    citations: answer.citations?.length, elapsed_ms: Date.now() - started, passed: Boolean(passed) }));
  process.exitCode = passed ? 0 : 1;
}
main().catch(error => { console.error(error.name); process.exitCode = 2; });
