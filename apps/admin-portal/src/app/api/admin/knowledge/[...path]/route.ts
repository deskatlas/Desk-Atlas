import { knowledgeValidation as z } from '@deskatlas/validation';
import { knowledgeDisplayTitle, knowledgeWorkingDocument, type KnowledgeDocument } from '@deskatlas/domain';
import { KnowledgeAudienceChangeSchema, KnowledgeFinalizeSchema, KnowledgePublishSchema, KnowledgeRevisionSchema, KnowledgeUploadSchema } from '@deskatlas/validation';
import { authorizeKnowledge, checkDatabase, detectKnowledgeType, KnowledgeError, knowledgeFailure, knowledgeResponse, missingUploadIntent, sha256 } from '../_lib/server';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
const uuid = z.string().uuid();
async function handle(request: Request, context: Context) {
  try {
    const { client, actor, scope } = await authorizeKnowledge(request);
    const { path } = await context.params;
    const [resource, rawId, action] = path;
    const id = rawId ? uuid.parse(rawId) : undefined;
    const command = async (operation: string, data: unknown) => {
      const result = await client.rpc('kb_admin_command', { p_scope: scope, p_actor: actor, p_operation: operation, p_id: id ?? null, p_data: data });
      checkDatabase(result.error); return result.data;
    };
    const body = async () => request.json().catch(() => { throw new KnowledgeError('INVALID_INPUT'); });
    // MS65 / ERD-E25,E27: property-based inventory and explicit, durable repair.
    if (resource === 'repairs' && path.length === 1 && request.method === 'GET') {
      const after = new URL(request.url).searchParams.get('cursor');
      const result = await client.rpc('kb_evidence_repairs', { p_scope: scope, p_actor: actor, p_after: after ? uuid.parse(after) : null });
      checkDatabase(result.error);
      const rows = z.array(z.object({id: uuid, revision: z.number().int().positive(), version_id: uuid, chunk_count: z.number().int().positive()}).strict()).max(21).parse(result.data);
      return knowledgeResponse({ documents: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null });
    }
    if (resource === 'documents' && id && action === 'repair' && path.length === 3 && request.method === 'POST') {
      const input = KnowledgeRevisionSchema.parse(await body());
      const result = await client.rpc('kb_begin_evidence_repair', {p_scope: scope, p_actor: actor, p_document: id, p_revision: input.expected_revision, p_request: input.request_id});
      checkDatabase(result.error);
      const repair = z.object({id: uuid, status: z.string(), source_object_key: z.string(), target_object_key: z.string(), source_sha256: z.string(), source_bytes: z.number().int().positive(), request_id: uuid}).strict().parse(result.data);
      if (repair.status !== 'UPLOADING') return knowledgeResponse({version_id: repair.id, status: repair.status}, 202);
      // Reuse the removal/issuance fence for delayed private storage copies.
      const permitArgs = {p_scope: scope, p_actor: actor, p_version: repair.id, p_expiry_seconds: 86400};
      const permit = await client.rpc('kb_upload_permit', permitArgs);
      checkDatabase(permit.error);
      const authorization = z.object({permit_id: uuid, issue_before: z.string(), object_key: z.string()}).strict().parse(permit.data);
      // Copy into a distinct immutable object. A duplicate/lost copy response is
      // reconciled by reading and hashing that exact target, never by upsert.
      await client.storage.from('knowledge-base').copy(repair.source_object_key, repair.target_object_key);
      const target = await client.storage.from('knowledge-base').download(repair.target_object_key);
      if (target.error || !target.data) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
      const bytes = new Uint8Array(await target.data.arrayBuffer());
      const hash = sha256(bytes);
      if (hash !== repair.source_sha256 || bytes.length !== repair.source_bytes) throw new KnowledgeError('MANIFEST_INVALID', 409);
      const confirmed = await client.rpc('kb_upload_permit', {...permitArgs, p_permit: authorization.permit_id});
      checkDatabase(confirmed.error);
      const completed = await client.rpc('kb_finalize_evidence_repair', {p_scope: scope, p_actor: actor, p_version: repair.id, p_hash: hash, p_bytes: bytes.length});
      checkDatabase(completed.error);
      return knowledgeResponse(completed.data, 202);
    }
    // MS64-TC05: reconcile an ambiguous upload response before issuing writes.
    if (resource === 'uploads' && id && path.length === 2 && request.method === 'GET') {
      const result = await client.from('kb_document_versions')
        .select('id,document_id,status,document:kb_documents!kb_document_versions_document_id_fkey!inner(scope_id,deleted_at)')
        .eq('request_id', id).eq('uploaded_by', actor).eq('document.scope_id', scope).is('document.deleted_at', null).maybeSingle();
      checkDatabase(result.error);
      return knowledgeResponse(result.data);
    }
    if (request.method === 'GET' && resource === 'documents' && path.length === 1) {
      const cursor = new URL(request.url).searchParams.get('cursor');
      // MS51-TC05: filter parents and nested files before applying the page limit.
      let query = client.from('kb_documents').select('*,versions:kb_document_versions!kb_document_versions_document_id_fkey!inner(id,document_id,version_number,status,original_filename,warning_codes,created_at,reviewed_at,published_at,chunk_count,expected_revision,generation,upload_intent),jobs:kb_jobs(id,version_id,kind,status,stage,last_error_code)').eq('scope_id', scope).is('deleted_at', null).not('versions.status', 'in', '(REMOVED,SUPERSEDED)').order('id').limit(21);
      if (cursor) query = query.gt('id', uuid.parse(cursor));
      const result = await query;
      let rows = result.data ?? [];
      if (missingUploadIntent(result.error)) {
        // MS-64 rollout compatibility: existing files remain readable before 025.
        // Keep identical scope, lifecycle filters and pagination on the retry.
        let legacy = client.from('kb_documents').select('*,versions:kb_document_versions!kb_document_versions_document_id_fkey!inner(id,document_id,version_number,status,original_filename,warning_codes,created_at,reviewed_at,published_at,chunk_count,expected_revision,generation),jobs:kb_jobs(id,version_id,kind,status,stage,last_error_code)').eq('scope_id', scope).is('deleted_at', null).not('versions.status', 'in', '(REMOVED,SUPERSEDED)').order('id').limit(21);
        if (cursor) legacy = legacy.gt('id', uuid.parse(cursor));
        const fallback = await legacy;
        checkDatabase(fallback.error);
        rows = (fallback.data ?? []).map(row => ({ ...row, versions: row.versions.map(version => ({ ...version, upload_intent: null })) }));
      } else checkDatabase(result.error);
      return knowledgeResponse({ documents: (rows.slice(0, 20).map(row => ({ ...row, versions: row.versions.map(({ upload_intent, ...version }) => ({ ...version, automatic_preparation: Boolean(upload_intent) })) })) as KnowledgeDocument[]).map(knowledgeWorkingDocument).filter(document => document !== null), next_cursor: rows.length > 20 ? rows[19].id : null });
    }
    if (request.method === 'GET' && resource === 'cleanup' && path.length === 1) {
      // Compact, separately paged feedback keeps tombstones out of working files.
      const cursor = new URL(request.url).searchParams.get('cursor');
      let query = client.from('kb_documents').select('id,title,revision,jobs:kb_jobs!inner(status,stage,lease_until,next_attempt_at)')
        .eq('scope_id', scope).eq('jobs.kind', 'PURGE').in('jobs.status', ['QUEUED', 'RUNNING', 'RETRY', 'FAILED']).order('id').limit(21);
      if (cursor) query = query.gt('id', uuid.parse(cursor));
      const result = await query; checkDatabase(result.error);
      const rows = result.data ?? [];
      return knowledgeResponse({ documents: rows.slice(0, 20).map(row => ({ id: row.id, title: row.title, revision: row.revision,
        pending: row.jobs.filter(job => job.status !== 'FAILED').length, failed: row.jobs.filter(job => job.status === 'FAILED').length,
        waiting_upload: row.jobs.filter(job => job.stage === 'WAITING_UPLOAD' && Date.parse(job.next_attempt_at) > Date.now()).length,
        retrying: row.jobs.filter(job => job.status === 'RETRY' && job.stage !== 'WAITING_UPLOAD' && job.stage !== 'CLEANING_CHUNKS').length,
        cleaning_chunks: row.jobs.filter(job => job.stage === 'CLEANING_CHUNKS').length,
        running: row.jobs.filter(job => job.status === 'RUNNING' && job.lease_until && Date.parse(job.lease_until) > Date.now()).length,
        awaiting_worker: row.jobs.filter(job => (job.status === 'QUEUED' && (job.stage !== 'WAITING_UPLOAD' || Date.parse(job.next_attempt_at) <= Date.now())) || (job.status === 'RETRY' && job.stage === 'WAITING_UPLOAD' && Date.parse(job.next_attempt_at) <= Date.now()) || (job.status === 'RUNNING' && (!job.lease_until || Date.parse(job.lease_until) <= Date.now()))).length })), next_cursor: rows.length > 20 ? rows[19].id : null });
    }
    if (resource === 'uploads' && request.method === 'POST' && path.length === 1) {
      const input = KnowledgeUploadSchema.parse(await body());
      const fingerprint = process.env.RAG_EMBEDDING_FINGERPRINT;
      if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new KnowledgeError('NOT_CONFIGURED', 503);
      // Do not create catalog state or upload intent against an older schema.
      const readiness = await client.from('kb_document_versions').select('upload_intent').limit(0);
      if (missingUploadIntent(readiness.error)) throw new KnowledgeError('UPDATE_REQUIRED', 503);
      checkDatabase(readiness.error);
      const catalog = await client.rpc('kb_initialize_catalog', { p_scope: scope, p_fingerprint: fingerprint });
      checkDatabase(catalog.error);
      const version = await command('upload_auto', { ...input, title: input.title ?? knowledgeDisplayTitle(input.filename) });
      const state = await client.from('kb_document_versions').select('status,created_at').eq('id', version.id).single();
      checkDatabase(state.error);
      if (state.data.status !== 'UPLOADING') return knowledgeResponse({ version_id: version.id, document_id: version.document_id, status: state.data.status });
      const expiry = Number(process.env.KB_UPLOAD_EXPIRY_SECONDS ?? 86400);
      if (!Number.isSafeInteger(expiry) || expiry < 7200) throw new KnowledgeError('NOT_CONFIGURED', 503);
      if (new Date(state.data.created_at).getTime() + expiry * 1000 <= Date.now()) throw new KnowledgeError('UPLOAD_EXPIRED', 409);
      // MS46-TC08: removal and issuance reserve the same document lock. Never
      // expose a provider token until the live permit is confirmed afterward.
      const permitArgs = { p_scope: scope, p_actor: actor, p_version: version.id, p_expiry_seconds: expiry };
      const permit = await client.rpc('kb_upload_permit', permitArgs);
      checkDatabase(permit.error);
      const authorization = z.object({ permit_id: uuid, issue_before: z.string().datetime({ offset: true }), object_key: z.string().min(1) }).strict().parse(permit.data);
      const target = await client.storage.from('knowledge-base').createSignedUploadUrl(authorization.object_key, { upsert: false });
      if (target.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
      const confirmed = await client.rpc('kb_upload_permit', { ...permitArgs, p_permit: authorization.permit_id });
      checkDatabase(confirmed.error);
      if (Date.now() >= Date.parse(authorization.issue_before)) throw new KnowledgeError('UPLOAD_EXPIRED', 409);
      return knowledgeResponse({ version_id: version.id, document_id: version.document_id, upload_url: target.data.signedUrl, request_id: input.request_id }, 201);
    }
    if (resource === 'uploads' && id && action === 'finalize' && path.length === 3 && request.method === 'POST') {
      const input = KnowledgeFinalizeSchema.parse(await body());
      const result = await client.from('kb_document_versions').select('*,document:kb_documents!kb_document_versions_document_id_fkey(scope_id,deleted_at)').eq('id', id).single();
      checkDatabase(result.error);
      const version = result.data;
      if (!version || version.document?.scope_id !== scope || version.uploaded_by !== actor || version.request_id !== input.request_id || version.document.deleted_at || version.status === 'REMOVED') throw new KnowledgeError('NOT_FOUND', 404);
      if (version.status !== 'UPLOADING') return knowledgeResponse(await command('finalize', input), 202);
      const source = await client.storage.from('knowledge-base').download(version.source_object_key);
      if (source.error || !source.data) throw new KnowledgeError('UPLOAD_MISSING');
      const bytes = new Uint8Array(await source.data.arrayBuffer());
      const allowedMime: Record<string, string[]> = { MD: ['text/markdown', 'text/plain', 'text/x-markdown'], DOC: ['application/msword'], DOCX: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], PDF: ['application/pdf'] };
      const mime = source.data.type.split(';')[0].toLowerCase();
      if (mime && mime !== 'application/octet-stream' && !allowedMime[version.detected_type]?.includes(mime)) throw new KnowledgeError('TYPE_MISMATCH');
      detectKnowledgeType(bytes, version.detected_type);
      return knowledgeResponse(await command('finalize', { ...input, source_sha256: sha256(bytes), source_bytes: bytes.length }), 202);
    }
    if (resource === 'notifications' && !action) {
      if (request.method === 'GET' && path.length === 1) {
        const result = await client.from('kb_notifications').select('id,document_id,version_id,kind,created_at,read_at,error_code,document:kb_documents!inner(scope_id)').eq('recipient_user_id', actor).eq('document.scope_id', scope).order('created_at', { ascending: false }).limit(100);
        checkDatabase(result.error); return knowledgeResponse(result.data);
      }
      if (request.method === 'PATCH' && id && path.length === 2) {
        const result = await client.from('kb_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('recipient_user_id', actor);
        checkDatabase(result.error); return knowledgeResponse({ read: true });
      }
    }
    if (resource === 'documents' && id && path.length <= 3) {
      if (request.method === 'DELETE' && !action) return knowledgeResponse(await command('remove_document', KnowledgeRevisionSchema.parse(await body())), 202);
      if (request.method === 'PATCH' && action === 'audience') return knowledgeResponse(await command('audience', KnowledgeAudienceChangeSchema.parse(await body())));
      if (request.method === 'POST' && action === 'cleanup') return knowledgeResponse(await command('retry_cleanup', KnowledgeRevisionSchema.parse(await body())), 202);
    }
    if (resource === 'versions' && id && path.length <= 3) {
      if (request.method === 'POST' && action === 'publish') return knowledgeResponse(await command('publish', KnowledgePublishSchema.parse(await body())));
      if (request.method === 'POST' && action === 'retry') return knowledgeResponse(await command('retry', KnowledgeRevisionSchema.parse(await body())), 202);
      if (request.method === 'DELETE' && !action) return knowledgeResponse(await command('remove_version', KnowledgeRevisionSchema.parse(await body())), 202);
      const result = await client.from('kb_document_versions').select('*,document:kb_documents!kb_document_versions_document_id_fkey(scope_id,deleted_at)').eq('id', id).single();
      checkDatabase(result.error);
      const version = result.data;
      if (!version || version.document?.scope_id !== scope || version.document.deleted_at || version.status === 'REMOVED') throw new KnowledgeError('NOT_FOUND', 404);
      if (request.method === 'GET' && !action) {
        const { source_object_key: _source, preview_object_key: _preview, ...metadata } = version;
        return knowledgeResponse(metadata);
      }
      if (request.method === 'GET' && action === 'preview') {
        if (!['READY', 'PUBLISHED', 'SUPERSEDED'].includes(version.status)) throw new KnowledgeError('INVALID_STATE', 409);
        // Page by ordinal: never silently truncate the review preview.
        const chunks: { content: string; heading_path: string; page_start: number | null; page_end: number | null; ordinal: number }[] = [];
        for (let offset = 0; ; offset += 200) {
          const batch = await client.from('kb_chunks').select('content,heading_path,page_start,page_end,ordinal,section_context,extraction_method').eq('version_id', id).eq('generation', version.generation).order('ordinal').range(offset, offset + 199);
          checkDatabase(batch.error); chunks.push(...(batch.data ?? []));
          if ((batch.data?.length ?? 0) < 200) break;
        }
        return knowledgeResponse({ chunks, warning_codes: version.warning_codes, extraction_manifest: version.extraction_manifest, review_identity: version.parser_fingerprint?.startsWith('kb-parser-v5:') ? { source_sha256: version.source_sha256, content_sha256: version.content_sha256, structure_manifest_sha256: version.structure_manifest_sha256, generation: version.generation } : null });
      }
      if (request.method === 'POST' && action === 'download') {
        const target = await client.storage.from('knowledge-base').createSignedUrl(version.source_object_key, 60, { download: version.original_filename });
        if (target.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
        return knowledgeResponse({ url: target.data.signedUrl });
      }
    }
    throw new KnowledgeError('NOT_FOUND', 404);
  } catch (error) { return knowledgeFailure(error instanceof z.ZodError ? new KnowledgeError('INVALID_INPUT') : error); }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
