// PRD-F26/F27 / SDD-C21/C24 / QAD-TC44/45: read-only evidence admission audit.
// Never prints credentials, source contents, actor IDs or document IDs.
const { readFileSync, readdirSync, mkdirSync, writeFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const assert = require('node:assert/strict');

async function main() {
  const env = { ...parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')), ...process.env };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await db.from('staff_profiles').select('user_id').eq('role', 'STAFF').eq('is_active', true).limit(1).single();
  if (actor.error || !actor.data) throw Error('ACTIVE_STAFF_REQUIRED');
  const files = readdirSync('C:/Users/reyna/Downloads').filter(name => name === 'GENERAL (ADAPTED) SOP DOCUMENT.md'
    || /^STAFF - (WORKSPACE MAP TAB|RESERVATION MANAGEMENT|QR SCANNER TAB|RESERVATIONS TAB|EXTEND RESERVATION|KIOSK PAYMENT CONFIRMATION|KIOSK QUEUE TAB|RELOCATE|DASHBOARD TAB|MY ACTIVITY TAB)\.md$/.test(name));
  const hashes = new Map(files.map(name => [createHash('sha256').update(readFileSync(`C:/Users/reyna/Downloads/${name}`)).digest('hex'), name]));
  const docs = await db.from('kb_documents').select('active_version_id,audience').is('deleted_at', null).eq('audience', 'ADMIN_AND_STAFF');
  if (docs.error) throw Error('METADATA_QUERY_FAILED');
  const reports = [];
  for (const doc of docs.data.filter(row => row.active_version_id)) {
    const version = await db.from('kb_document_versions').select('source_sha256,generation,parser_fingerprint,structure_reviewed,expected_chunk_count,system_verification')
      .eq('id', doc.active_version_id).eq('status', 'PUBLISHED').single();
    if (version.error) throw Error('METADATA_QUERY_FAILED');
    const chunks = await db.from('kb_chunks').select('id,section_context').eq('version_id', doc.active_version_id)
      .eq('generation', version.data.generation).order('ordinal');
    if (chunks.error || !chunks.data.length) throw Error('METADATA_QUERY_FAILED');
    const result = await db.rpc('assistant_expand_evidence', { p_actor: actor.data.user_id, p_scope: env.RAG_SCOPE_ID,
      p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_chunks: [chunks.data[0].id] });
    if (result.error) throw Error('READ_ONLY_EXPANSION_FAILED');
    const sections = new Set(chunks.data.map(chunk => chunk.section_context.section_id));
    const allToAll = chunks.data.every(chunk => chunk.section_context.dependencies.length === sections.size - 1
      && [...sections].every(id => id === chunk.section_context.section_id || chunk.section_context.dependencies.includes(id)));
    reports.push({ reference_file: hashes.get(version.data.source_sha256) || 'SOURCE_HASH_NOT_MATCHED',
      exact_reference_match: hashes.has(version.data.source_sha256), chunks: chunks.data.length,
      parser: version.data.parser_fingerprint?.match(/^kb-parser-v\d+/)?.[0], reviewed: version.data.structure_reviewed,
      automated: version.data.system_verification?.policy === 'kb-auto-v1', all_to_all_dependencies: allToAll,
      single_root_complete: result.data.complete, reason: result.data.reason || null,
      returned_sources: result.data.sources?.length || 0 });
  }
  const record = { read_only: true, reference_files: files.length, evidence_v3: env.RAG_EVIDENCE_CONTRACT === 'ms59-v1',
    documents: reports, blocked_single_roots: reports.filter(row => !row.single_root_complete).length };
  mkdirSync('services/rag/benchmark-results/eleven-sop-audit-2026-10-17', { recursive: true });
  writeFileSync('services/rag/benchmark-results/eleven-sop-audit-2026-10-17/evidence-admission.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  assert.equal(record.blocked_single_roots, 0, 'Published staff documents must admit one complete support root within the active evidence contract');
}
main().catch(error => { console.error(error?.code === 'ERR_ASSERTION' ? error.message : 'EVIDENCE_AUDIT_FAILED'); process.exitCode = 1; });
