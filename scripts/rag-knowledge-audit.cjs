// MS48-TC06/13 / SDD-C23,C24: read-only, content-free rollout diagnostics.
// Never requests document text, titles, filenames, source URLs or embeddings.
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

function summarize(contexts) {
  const nodes = new Map();
  let missing = 0;
  for (const context of contexts) {
    if (!context) { missing++; continue; }
    nodes.set(context.section_id, context);
  }
  let blocked = 0;
  for (const seed of nodes.keys()) {
    const seen = new Set(), pending = [seed];
    let bad = false;
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = nodes.get(id);
      if (!node || node.unresolved || ['UNRESOLVED', 'UNREVIEWED'].includes(node.scope)) bad = true;
      for (const target of node?.dependencies ?? []) if (!seen.has(target)) pending.push(target);
    }
    if (bad) blocked++;
  }
  return { chunks: contexts.length, sections: nodes.size, missing_structure_chunks: missing,
    structural_versions: [...new Set([...nodes.values()].map(node => node.version))],
    unresolved_sections: [...nodes.values()].filter(node => node.unresolved).length,
    blocked_sections: blocked, max_dependencies: Math.max(0, ...[...nodes.values()].map(node => node.dependencies.length)) };
}

async function main() {
  const root = resolve(__dirname, '..');
  const file = resolve(root, 'apps/admin-portal/.env.local');
  const saved = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const env = { ...saved, ...process.env };
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('CONFIGURATION_REQUIRED');
  const client = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (target, init) => fetch(target, { ...init, signal: AbortSignal.timeout(15000) }) } });
  const documents = await client.from('kb_documents').select('active_version_id').is('deleted_at', null);
  if (documents.error) throw new Error('METADATA_QUERY_FAILED');
  // Immutable SQL function with synthetic input only: distinguish applied 020
  // from a working tree containing 020 while the database still runs 019.
  const contract = await client.rpc('kb_structure_hash', { c: { version: 2, section_id: 's1',
    dependencies: [], unresolved: false, ancestors: [], references: [], scope: 'LOCAL',
    structure_known: true, unresolved_references: false } });
  const expected = createHash('sha256').update(['2', 's1', '', 'false', '', '', 'LOCAL', 'true', 'false'].join('|')).digest('hex');
  const reports = [];
  for (const document of documents.data.filter(row => row.active_version_id)) {
    const result = await client.from('kb_document_versions')
      .select('generation,detected_type,parser_fingerprint,expected_chunk_count,structure_reviewed,structure_manifest_sha256')
      .eq('id', document.active_version_id).single();
    if (result.error) throw new Error('METADATA_QUERY_FAILED');
    const contexts = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await client.from('kb_chunks').select('section_context').eq('version_id', document.active_version_id)
        .eq('generation', result.data.generation).order('ordinal').range(offset, offset + 999);
      if (page.error) throw new Error('METADATA_QUERY_FAILED');
      contexts.push(...page.data.map(row => row.section_context));
      if (page.data.length < 1000) break;
    }
    reports.push({ document_index: reports.length, type: result.data.detected_type,
      parser_revision: result.data.parser_fingerprint?.match(/^kb-parser-v\d+/)?.[0] ?? 'unknown',
      expected_chunks: result.data.expected_chunk_count, reviewed: result.data.structure_reviewed,
      structural_manifest_present: Boolean(result.data.structure_manifest_sha256), ...summarize(contexts) });
  }
  process.stdout.write(JSON.stringify({ read_only: true,
    reviewed_scope_contract: contract.error ? 'UNVERIFIABLE' : contract.data === expected,
    documents: reports }, null, 2) + '\n');
}

module.exports = { summarize };
if (require.main === module) main().catch(() => {
  // Provider errors can contain private identifiers. Emit only a fixed code.
  process.stderr.write('KNOWLEDGE_AUDIT_FAILED: verify saved configuration and metadata access.\n');
  process.exitCode = 1;
});
