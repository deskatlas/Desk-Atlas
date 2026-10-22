// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44-TC46: read-only evidence compatibility audit.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')), ...process.env };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const hash = createHash('sha256').update(readFileSync(process.argv[2])).digest('hex');
  const docs = await db.from('kb_documents').select('title,active_version_id').is('deleted_at', null);
  if (docs.error) throw Error('DOCUMENT_METADATA_FAILED');
  const versions = await db.from('kb_document_versions')
    .select('id,generation,status,source_sha256,support_contract,expected_chunk_count,system_verification')
    .in('id', docs.data.map(d => d.active_version_id).filter(Boolean));
  if (versions.error) { console.log(JSON.stringify({ metadata_error_code: versions.error.code })); throw Error('EXACT_SOURCE_VERSION_NOT_FOUND'); }
  const exact = versions.data.filter(v => v.source_sha256 === hash);
  const matchingIds = docs.data.filter(d => /admin.*payment|payment.*tab/i.test(d.title)).map(d => d.active_version_id);
  const matching = exact.length ? exact : versions.data.filter(v => matchingIds.includes(v.id));
  if (matching.length !== 1) { console.log(JSON.stringify({ matching_titles: docs.data.filter(d => /payment/i.test(d.title)).map(d => d.title), exact_matches: exact.length })); throw Error('EXACT_SOURCE_VERSION_NOT_FOUND'); }
  const version = matching[0];
  const canonical = await db.from('kb_chunks').select('content').eq('version_id', version.id).eq('generation', version.generation).order('ordinal');
  if (canonical.error) throw Error('DOCUMENT_METADATA_FAILED');
  const text = canonical.data.map(c => c.content).join('\n');
  const actor = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  const catalog = await db.from('kb_catalog').select('scope_id,active_embedding_fingerprint').eq('scope_id', env.RAG_SCOPE_ID).single();
  const chunk = await db.from('kb_chunks').select('id').eq('version_id', version.id).eq('generation', version.generation).order('ordinal').limit(1).single();
  if (actor.error || catalog.error || chunk.error) throw Error('AUDIT_PREREQUISITE_FAILED');
  const params = { p_actor: actor.data.user_id, p_scope: catalog.data.scope_id,
    p_fingerprint: catalog.data.active_embedding_fingerprint, p_chunks: [chunk.data.id] };
  const results = [];
  for (const name of ['assistant_expand_evidence', 'assistant_expand_evidence_v3', 'assistant_document_evidence']) {
    const response = await db.rpc(name, params);
    const result = response.data;
    results.push({ rpc: name, error: Boolean(response.error), complete: result?.complete ?? null,
      reason: result?.reason ?? null, sources: result?.sources?.length ?? 0 });
  }
  const legacyRejected = results.slice(0, 2).every(r => r.complete === false && r.reason === 'REPROCESS_REQUIRED');
  const currentAccepted = !results[2].error && results[2].sources > 0;
  console.log(JSON.stringify({ read_only: true, exact_source_bytes_match: version.source_sha256 === hash, match_basis: exact.length ? 'SOURCE_SHA256' : 'TITLE', status: version.status,
    support_contract: version.support_contract, chunks: version.expected_chunk_count,
    verification_policy: version.system_verification?.policy,
    published_corpus: { total: versions.data.length, ms65_versions: versions.data.filter(v => v.support_contract === 'ms65-v1').length },
    expected_payment_guidance_present: { inspect_proof: /Inspect Proof/.test(text),
      reconsider_approve: /Reconsider & Approve/.test(text), rejected_incorrectly: /rejected incorrectly/i.test(text) },
    local_gateway_contract: env.RAG_EVIDENCE_CONTRACT ?? 'legacy',
    legacy_rejected: legacyRejected, document_reader_accepted: currentAccepted, results }, null, 2));
  if (process.argv.includes('--assert-legacy-answerable') && legacyRejected) process.exitCode = 1;
}
main().catch(error => {
  const safe = ['DOCUMENT_METADATA_FAILED', 'EXACT_SOURCE_VERSION_NOT_FOUND', 'AUDIT_PREREQUISITE_FAILED'];
  console.error(safe.includes(error.message) ? error.message : 'PAYMENT_EVIDENCE_AUDIT_FAILED');
  process.exitCode = 2;
});
