// PRD-F26/F27 / QAD-TC44/46: read-only, full-original component diagnostic.
// Explicit local use only. No publication, preparation or serving mutation.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const role = process.argv[2];
  const indexes = process.argv[3]?.split(',').map(Number);
  const question = process.argv[4];
  if (!['ADMIN', 'STAFF', 'PUBLIC_VISITOR'].includes(role) || !indexes?.length
    || indexes.some(index => !Number.isSafeInteger(index) || index < 0) || !question) throw Error('INVALID_DIAGNOSTIC');
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')),
    ...parseEnv(readFileSync('services/rag/.env.local', 'utf8')), ...process.env,
    RAG_MODEL_PROVIDER: 'deepinfra' };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  let actor = require('node:crypto').randomUUID();
  if (role !== 'PUBLIC_VISITOR') {
    const profile = await db.from('staff_profiles').select('user_id').eq('role', role).eq('is_active', true).limit(1).single();
    if (profile.error || !profile.data) throw Error('ACTIVE_ACTOR_REQUIRED');
    actor = profile.data.user_id;
  }
  const catalog = await db.from('kb_documents').select('id,title,active_version_id').eq('scope_id', env.RAG_SCOPE_ID)
    .is('deleted_at', null).not('active_version_id', 'is', null).order('id');
  if (catalog.error || !catalog.data) throw Error('CATALOG_UNAVAILABLE');
  const seeds = [];
  for (const index of indexes) {
    const document = catalog.data[index];
    if (!document) throw Error('DOCUMENT_REQUIRED');
    const seed = await db.from('kb_chunks').select('id').eq('version_id', document.active_version_id).order('ordinal').limit(1).single();
    if (seed.error || !seed.data) throw Error('SOURCE_REQUIRED');
    seeds.push(seed.data.id);
  }
  const customer = role === 'PUBLIC_VISITOR';
  const evidence = await db.rpc(customer ? 'customer_document_evidence' : 'assistant_document_evidence', {
    p_actor: actor, p_scope: env.RAG_SCOPE_ID, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_chunks: seeds,
    ...(customer ? { p_principal: role } : {}),
  });
  if (evidence.error || !evidence.data?.sources?.length) throw Error('AUTHORIZED_SOURCE_REQUIRED');
  if (process.argv[5] === '--export-only') {
    const { mkdirSync, writeFileSync } = require('node:fs');
    const directory = resolve('services/rag/.cache/answer-diagnostic');
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `originals-${role}-${indexes.join('-')}.json`);
    writeFileSync(path, JSON.stringify(evidence.data));
    console.log(JSON.stringify({ operation: 'read_only_original_export', role, epoch: evidence.data.epoch,
      documents: [...new Set(evidence.data.sources.map(source => source.title))], path }));
    return;
  }
  const child = spawn(resolve('services/rag/.venv-service/Scripts/python.exe'), ['-m', 'experiments.ragfix.answer_diagnostic'],
    { cwd: resolve('services/rag'), env, stdio: ['pipe', 'inherit', 'pipe'] });
  child.stderr.resume();
  child.stdin.end(JSON.stringify({ role, question, sources: evidence.data.sources }));
  process.exitCode = await new Promise(done => child.on('exit', code => done(code ?? 1)));
}
main().catch(() => { console.error('ANSWER_DIAGNOSTIC_FAILED'); process.exitCode = 2; });
