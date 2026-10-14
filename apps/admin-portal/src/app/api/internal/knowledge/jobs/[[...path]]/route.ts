import { knowledgeValidation as z } from '@deskatlas/validation';
import { KnowledgeCheckpointSchema, KnowledgeCompleteSchema, KnowledgeLeaseSchema } from '@deskatlas/validation';
import { authorizeKnowledgeWorker, checkDatabase, KnowledgeError, knowledgeFailure, knowledgeResponse } from '../../../../admin/knowledge/_lib/server';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  try {
    const { client, scope } = authorizeKnowledgeWorker(request);
    const { path = [] } = await context.params;
    const [jobId, action] = path;
    const operation = jobId === 'claim' && path.length === 1 ? 'claim' : action;
    if (!['claim', 'heartbeat', 'checkpoint', 'complete'].includes(operation ?? '') || (operation !== 'claim' && path.length !== 2)) throw new KnowledgeError('NOT_FOUND', 404);
    const id = operation === 'claim' ? null : z.string().uuid().parse(jobId);
    const raw = await request.json();
    const data = operation === 'claim' ? z.object({}).strict().parse(raw)
      : operation === 'checkpoint' ? KnowledgeCheckpointSchema.parse(raw)
      : operation === 'complete' ? KnowledgeCompleteSchema.parse(raw) : KnowledgeLeaseSchema.strict().parse(raw);
    if (operation === 'claim') {
      const expiry = Number(process.env.KB_UPLOAD_EXPIRY_SECONDS ?? 86400);
      if (!Number.isSafeInteger(expiry) || expiry < 7200) throw new KnowledgeError('NOT_CONFIGURED', 503);
      // Signed provider upload authorizations last two hours. Stop renewal at
      // the transfer deadline and wait that grace period before deleting bytes.
      const reconciled = await client.rpc('kb_reconcile_uploads', { p_scope: scope, p_expiry_seconds: expiry + 7200 });
      checkDatabase(reconciled.error);
    }
    const result = await client.rpc('kb_worker_command', { p_scope: scope, p_operation: operation, p_id: id, p_data: data });
    checkDatabase(result.error);
    if (operation === 'claim' && result.data) {
      const version = result.data.version;
      if (result.data.job.kind === 'INGEST') {
        const target = await client.storage.from('knowledge-base').createSignedUrl(version.source_object_key, 60);
        if (target.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
        return knowledgeResponse({ ...result.data, source_url: target.data.signedUrl });
      }
      // Only the TypeScript gateway has storage credentials. The worker gets no service key.
      const keys = [version.source_object_key, version.preview_object_key].filter((v): v is string => typeof v === 'string');
      if (keys.length) {
        const removed = await client.storage.from('knowledge-base').remove(keys);
        if (removed.error) {
          const failed = await client.rpc('kb_worker_command', { p_scope: scope, p_operation: 'complete', p_id: result.data.job.id, p_data: { lease_token: result.data.job.lease_token, generation: result.data.job.generation, error_code: 'STORAGE_FAILED', retryable: true } });
          checkDatabase(failed.error); throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
        }
      }
    }
    return knowledgeResponse(result.data);
  } catch (error) { return knowledgeFailure(error instanceof z.ZodError ? new KnowledgeError('INVALID_INPUT') : error); }
}
