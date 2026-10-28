// PRD-F4/F5/F6/F7/F9/F26/F27 / QAD-TC44/45/46.
// Maintainer-approved replacements only, through the normal audited upload API.
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const apply = process.argv.includes('--publish-approved');
  const directory = resolve('outputs/admin-rag-audit-2026-10-28/source-policy-reconciliation');
  const manifest = JSON.parse(readFileSync(resolve(directory, 'patches.json'), 'utf8'));
  if (manifest.status !== 'UNPUBLISHED_REVIEW_DRAFT' || manifest.files.length !== 5) throw Error('INVALID_REVIEW_MANIFEST');
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')), ...process.env };
  if (!env.RAG_POLICY_ADMIN_EMAIL) throw Error('APPROVED_ADMIN_EMAIL_REQUIRED');
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const actor = users.data?.users?.find(user => user.email?.toLowerCase() === env.RAG_POLICY_ADMIN_EMAIL.toLowerCase());
  if (users.error || !actor) throw Error('APPROVED_ADMIN_REQUIRED');
  const profile = await db.from('staff_profiles').select('role,is_active').eq('user_id', actor.id).single();
  if (profile.error || profile.data?.role !== 'ADMIN' || !profile.data.is_active) throw Error('ACTIVE_ADMIN_REQUIRED');
  const base = new URL('http://127.0.0.1:3010');
  const { issueAdminSession } = await import('../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession.ts');
  const token = issueAdminSession(actor.id, env.SUPABASE_SERVICE_ROLE_KEY);
  const request = async (path, body) => {
    const response = await fetch(new URL(`/api/admin/knowledge/${path}`, base), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw Error(`KNOWLEDGE_${result.error?.code || response.status}`);
    return result.data;
  };
  const receiptPath = resolve(directory, 'publication-receipt.json');
  const receipts = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : [];
  const planned = [];
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve(directory, file.file));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('REVIEWED_FILE_CHANGED');
    const document = await db.from('kb_documents').select('id,title,audience,revision,active_version_id')
      .eq('scope_id', env.RAG_SCOPE_ID).eq('title', file.title).is('deleted_at', null).single();
    if (document.error || !document.data) throw Error('DOCUMENT_REQUIRED');
    const previous = receipts.find(receipt => receipt.document_id === document.data.id);
    if (document.data.active_version_id !== file.original_version && document.data.active_version_id !== previous?.version_id) throw Error('SOURCE_VERSION_CHANGED');
    planned.push({ file, bytes, document: document.data, previous });
  }
  console.log(JSON.stringify({ operation: apply ? 'approved_versioned_replacement' : 'read_only_preflight', documents: planned.length }));
  if (!apply) return;
  for (const { file, bytes, document, previous } of planned) {
    const receipt = previous || { document_id: document.id, title: document.title, original_version_id: file.original_version,
      request_id: randomUUID(), source_sha256: file.sha256, expected_revision: document.revision, approved_at: new Date().toISOString() };
    if (receipt.finalized) { console.log(JSON.stringify({ title: file.title, version_id: receipt.version_id, operation: 'already_finalized' })); continue; }
    if (!previous) receipts.push(receipt);
    writeFileSync(receiptPath, JSON.stringify(receipts, null, 2));
    const target = await request('uploads', { title: document.title, audience: document.audience,
      filename: file.file, declared_type: 'MD', replace_document_id: document.id,
      expected_revision: receipt.expected_revision, request_id: receipt.request_id });
    receipt.version_id = target.version_id;
    writeFileSync(receiptPath, JSON.stringify(receipts, null, 2));
    if (target.upload_url) {
      const transfer = await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/markdown', 'x-upsert': 'false' },
        body: bytes, signal: AbortSignal.timeout(30000) });
      if (!transfer.ok && transfer.status !== 409) throw Error('SOURCE_TRANSFER_FAILED');
    }
    await request(`uploads/${target.version_id}/finalize`, { request_id: receipt.request_id });
    receipt.finalized = true;
    writeFileSync(receiptPath, JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify({ title: file.title, version_id: receipt.version_id, operation: 'accepted_for_verified_publication' }));
  }
}
main().catch(error => { console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'POLICY_PUBLICATION_FAILED'); process.exitCode = 1; });
