import { knowledgeValidation as z } from '@deskatlas/validation';
import { KnowledgeAudienceChangeSchema, KnowledgeFinalizeSchema, KnowledgePublishSchema, KnowledgeRevisionSchema, KnowledgeUploadSchema } from '@deskatlas/validation';
import { authorizeKnowledge, checkDatabase, detectKnowledgeType, KnowledgeError, knowledgeFailure, knowledgeResponse, sha256 } from '../_lib/server';

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
    if (request.method === 'GET' && resource === 'documents' && path.length === 1) {
      const cursor = new URL(request.url).searchParams.get('cursor');
      let query = client.from('kb_documents').select('*,versions:kb_document_versions!kb_document_versions_document_id_fkey(id,document_id,version_number,status,original_filename,warning_codes,created_at,reviewed_at,published_at,chunk_count,expected_revision,generation),jobs:kb_jobs(id,version_id,kind,status,stage,last_error_code)').eq('scope_id', scope).order('id').limit(21);
      if (cursor) query = query.gt('id', uuid.parse(cursor));
      const result = await query; checkDatabase(result.error);
      const rows = result.data ?? [];
      return knowledgeResponse({ documents: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null });
    }
    if (resource === 'uploads' && request.method === 'POST' && path.length === 1) {
      const input = KnowledgeUploadSchema.parse(await body());
      const fingerprint = process.env.RAG_EMBEDDING_FINGERPRINT;
      if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new KnowledgeError('NOT_CONFIGURED', 503);
      const catalog = await client.rpc('kb_initialize_catalog', { p_scope: scope, p_fingerprint: fingerprint });
      checkDatabase(catalog.error);
      const version = await command('upload', input);
      const state = await client.from('kb_document_versions').select('status,created_at').eq('id', version.id).single();
      checkDatabase(state.error);
      if (state.data.status !== 'UPLOADING') return knowledgeResponse({ version_id: version.id, document_id: version.document_id, status: state.data.status });
      const expiry = Number(process.env.KB_UPLOAD_EXPIRY_SECONDS ?? 86400);
      if (!Number.isSafeInteger(expiry) || expiry < 7200) throw new KnowledgeError('NOT_CONFIGURED', 503);
      if (new Date(state.data.created_at).getTime() + expiry * 1000 <= Date.now()) throw new KnowledgeError('UPLOAD_EXPIRED', 409);
      const target = await client.storage.from('knowledge-base').createSignedUploadUrl(`${version.document_id}/${version.id}/source`, { upsert: false });
      if (target.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
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
          const batch = await client.from('kb_chunks').select('content,heading_path,page_start,page_end,ordinal').eq('version_id', id).eq('generation', version.generation).order('ordinal').range(offset, offset + 199);
          checkDatabase(batch.error); chunks.push(...(batch.data ?? []));
          if ((batch.data?.length ?? 0) < 200) break;
        }
        return knowledgeResponse({ chunks, warning_codes: version.warning_codes });
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
