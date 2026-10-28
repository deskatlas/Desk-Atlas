// PRD-F26/F27 / QAD-TC44/46: local support-only probe, never browser acceptance.
// Canonical reads use the requested principal. Credentials remain in memory.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHmac, randomUUID, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')),
    ...parseEnv(readFileSync('services/rag/.env.local', 'utf8')), ...process.env };
  const base = new URL(process.argv[2]);
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('LOCAL_PROBE_ONLY');
  const principal = process.argv[3];
  if (!['ADMIN', 'STAFF', 'PUBLIC_VISITOR'].includes(principal)) throw Error('INVALID_PRINCIPAL');
  const index = Number(process.argv[4]), question = process.argv[5];
  if (!Number.isSafeInteger(index) || index < 0 || !question) throw Error('CASE_REQUIRED');
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const customer = principal === 'PUBLIC_VISITOR';
  let actor = randomUUID();
  if (!customer) {
    const profile = await db.from('staff_profiles').select('user_id').eq('role', principal).eq('is_active', true).limit(1).single();
    if (profile.error || !profile.data) throw Error('ACTIVE_ACTOR_REQUIRED');
    actor = profile.data.user_id;
  }
  const catalog = await db.from('kb_documents').select('id,title,active_version_id').eq('scope_id', env.RAG_SCOPE_ID)
    .is('deleted_at', null).not('active_version_id', 'is', null).order('id');
  if (catalog.error || !catalog.data[index]) throw Error('DOCUMENT_REQUIRED');
  const document = catalog.data[index];
  const seed = await db.from('kb_chunks').select('id').eq('version_id', document.active_version_id).order('ordinal').limit(1).single();
  if (seed.error) throw Error('SOURCE_REQUIRED');
  const evidence = await db.rpc(customer ? 'customer_document_evidence' : 'assistant_document_evidence', {
    p_actor: actor, p_scope: env.RAG_SCOPE_ID, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_chunks: [seed.data.id],
    ...(customer ? { p_principal: principal } : {}),
  });
  if (evidence.error || !evidence.data?.sources?.length) throw Error('AUTHORIZED_SOURCE_REQUIRED');
  const now = Math.floor(Date.now() / 1000);
  const common = { iss: 'deskatlas', aud: 'rag', sub: actor, request_id: randomUUID(), scope: env.RAG_SCOPE_ID,
    generation: randomUUID(), iat: now, exp: now + 60 };
  const claims = customer ? { ...common, surface: 'customer', principal, session_id: randomUUID(),
    ops: ['customer_knowledge'], audiences: ['CUSTOMER'] } : { ...common, role: principal, ops: ['answer'] };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const capability = `${payload}.${createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url')}`;
  const body = JSON.stringify({ contract: 'ms65-v1', query: question, synthesis: true, sources: evidence.data.sources });
  const started = performance.now();
  const response = await fetch(new URL(customer ? '/v1/customer/document-support' : '/v1/document-support', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`,
      'X-Request-Capability': capability }, body, signal: AbortSignal.timeout(60000),
  });
  const answer = await response.json();
  const elapsed = Math.round(performance.now() - started);
  const binding = createHash('sha256').update(body).digest('hex');
  const spansValid = Array.isArray(answer.spans) && answer.spans.every(span => {
    const source = evidence.data.sources.find(item => item.chunk_id === span.chunk_id);
    return source && source.content.slice(span.start, span.end) === span.quote;
  });
  const supported = response.ok && answer.outcome === 'COMPLETE' && answer.binding === binding && spansValid && answer.spans.length > 0;
  console.log(JSON.stringify({ component: 'support_only', principal, title: document.title, question, status: response.status,
    outcome: answer.outcome, error: answer.detail, elapsed_ms: elapsed, original_spans_valid: supported,
    counts: answer.counts, summary: answer.synthesis?.blocks?.map(block => block.text).join('\n\n'),
    server_timing: response.headers.get('Server-Timing'), tokens: {
      input: response.headers.get('X-RAG-Input-Tokens'), output: response.headers.get('X-RAG-Output-Tokens') } }));
  if (!supported || elapsed >= Number(env.RAG_AUDIT_MAX_MS || 10000)) process.exitCode = 1;
}
main().catch(() => { console.error('SUPPORT_COMPONENT_PROBE_FAILED'); process.exitCode = 2; });
