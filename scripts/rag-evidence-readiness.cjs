// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44-TC46: read-only release compatibility gate.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHmac, randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

function assessReadiness({ contract, publishedContracts, serviceContracts }) {
  if (!contract) return { ready: false, reason: 'READER_NOT_CONFIGURED' };
  if (!['legacy', 'ms59-v1', 'ms65-v1'].includes(contract)
    || publishedContracts.some(value => value !== null && value !== 'ms65-v1')) return { ready: false, reason: 'UNKNOWN_CONTRACT' };
  if (contract !== 'ms65-v1' && publishedContracts.includes('ms65-v1')) return { ready: false, reason: 'READER_INCOMPATIBLE' };
  if (contract === 'ms65-v1' && !serviceContracts.includes(contract)) return { ready: false, reason: 'SERVICE_CONTRACT_UNVERIFIED' };
  return { ready: true, reason: 'COMPATIBLE' };
}

async function main() {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const env = { ...parseEnv(readFileSync(option('env-file') || 'apps/admin-portal/.env.local', 'utf8')), ...process.env };
  const contract = option('contract') || env.RAG_EVIDENCE_CONTRACT;
  for (const key of ['RAG_SCOPE_ID', 'RAG_EMBEDDING_FINGERPRINT', 'RAG_SERVICE_URL', 'RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[key]) throw Error('CONFIGURATION_REQUIRED');
  }
  const base = new URL(env.RAG_SERVICE_URL);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw Error('CONFIGURATION_REQUIRED');
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const catalog = await db.from('kb_catalog').select('epoch,active_embedding_fingerprint').eq('scope_id', env.RAG_SCOPE_ID).single();
  if (catalog.error || catalog.data.active_embedding_fingerprint !== env.RAG_EMBEDDING_FINGERPRINT) throw Error('CATALOG_MISMATCH');
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const docs = await db.from('kb_documents').select('active_version_id').eq('scope_id', env.RAG_SCOPE_ID)
      .is('deleted_at', null).order('id').range(offset, offset + 999);
    if (docs.error) throw Error('METADATA_UNAVAILABLE');
    ids.push(...docs.data.map(row => row.active_version_id).filter(Boolean));
    if (docs.data.length < 1000) break;
  }
  const contracts = [];
  // Explicit pagination avoids silently checking only the provider's first page.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const versions = await db.from('kb_document_versions').select('support_contract')
      .in('id', ids.slice(offset, offset + 100)).eq('status', 'PUBLISHED');
    if (versions.error || versions.data.length !== ids.slice(offset, offset + 100).length) throw Error('METADATA_UNAVAILABLE');
    contracts.push(...versions.data.map(row => row.support_contract));
  }
  if (!ids.length) throw Error('NO_PUBLISHED_EVIDENCE');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: randomUUID(), role: 'ADMIN',
    request_id: randomUUID(), scope: env.RAG_SCOPE_ID, ops: ['answer'], iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
  const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
  const response = await fetch(new URL('/health', base), { headers: { Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`,
    'X-Request-Capability': `${payload}.${signature}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('SERVICE_UNAVAILABLE');
  const health = await response.json();
  if (health.ready !== true) throw Error('SERVICE_UNAVAILABLE');
  const serviceContracts = Array.isArray(health.evidence_contracts) && health.evidence_contracts.every(value => typeof value === 'string') ? health.evidence_contracts : [];
  const result = assessReadiness({ contract, publishedContracts: contracts, serviceContracts });
  const finalCatalog = await db.from('kb_catalog').select('epoch,active_embedding_fingerprint').eq('scope_id', env.RAG_SCOPE_ID).single();
  if (finalCatalog.error || finalCatalog.data.epoch !== catalog.data.epoch
    || finalCatalog.data.active_embedding_fingerprint !== catalog.data.active_embedding_fingerprint) throw Error('CATALOG_MISMATCH');
  console.log(JSON.stringify({ ...result, read_only: true, candidate_override: Boolean(option('contract')),
    configured_contract: env.RAG_EVIDENCE_CONTRACT || null, evaluated_contract: contract || null,
    published_versions: ids.length, ms65_versions: contracts.filter(value => value === 'ms65-v1').length,
    service_contracts: serviceContracts.filter(value => value === 'ms65-v1') }));
  if (!result.ready) process.exitCode = 1;
}

module.exports = { assessReadiness };
if (require.main === module) main().catch(error => {
  const codes = ['CONFIGURATION_REQUIRED', 'CATALOG_MISMATCH', 'METADATA_UNAVAILABLE', 'NO_PUBLISHED_EVIDENCE', 'SERVICE_UNAVAILABLE'];
  console.error(JSON.stringify({ ready: false, reason: codes.includes(error.message) ? error.message : 'READINESS_UNVERIFIABLE' }));
  process.exitCode = 1;
});
