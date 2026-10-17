import { knowledgeValidation as z } from '@deskatlas/validation';
import { KnowledgeCheckpointSchema, KnowledgeClaimSchema, KnowledgeCompleteSchema, KnowledgeLeaseSchema } from '@deskatlas/validation';
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
    const data = operation === 'claim' ? z.object({ kind: z.enum(['INGEST', 'PURGE']).optional() }).strict().parse(raw)
      : operation === 'checkpoint' ? KnowledgeCheckpointSchema.parse(raw)
      : operation === 'complete' ? KnowledgeCompleteSchema.parse(raw) : KnowledgeLeaseSchema.strict().parse(raw);
    if (operation === 'claim' && !('kind' in data && data.kind === 'PURGE')) {
      const expiry = Number(process.env.KB_UPLOAD_EXPIRY_SECONDS ?? 86400);
      if (!Number.isSafeInteger(expiry) || expiry < 7200) throw new KnowledgeError('NOT_CONFIGURED', 503);
      // Signed provider upload authorizations last two hours. Stop renewal at
      // the transfer deadline and wait that grace period before deleting bytes.
      const reconciled = await client.rpc('kb_reconcile_uploads', { p_scope: scope, p_expiry_seconds: expiry + 7200 });
      checkDatabase(reconciled.error);
    }
    let completion: Record<string, unknown> = data;
    if (operation === 'complete' && !('error_code' in data)) {
      // Only a currently leased PURGE may receive targets. SQL validates the
      // scope/generation/lease before storage side effects or final completion.
      const job = await client.from('kb_jobs').select('kind').eq('id', id).maybeSingle();
      checkDatabase(job.error);
      if (job.data?.kind === 'PURGE') {
        const targets = await client.rpc('kb_worker_command', { p_scope: scope, p_operation: 'purge_targets', p_id: id, p_data: data });
        checkDatabase(targets.error);
        const deferred = z.object({ deferred: z.literal(true), status: z.enum(['WAITING_UPLOAD', 'CLEANING_CHUNKS']) }).strict().safeParse(targets.data);
        if (deferred.success) return knowledgeResponse(deferred.data);
        const paths = z.object({ source_object_key: z.string().nullable(), preview_object_key: z.string().nullable() }).strict().parse(targets.data);
        const keys = [...new Set([paths.source_object_key, paths.preview_object_key].filter((key): key is string => key !== null))];
        let verified = true;
        const started = performance.now();
        try {
          if (keys.length) {
            const removed = await client.storage.from('knowledge-base').remove(keys);
            verified = !removed.error;
            // MS52-TC05: a full page is inconclusive. Group exact targets by
            // directory, without relying on fuzzy search or truncated results.
            const directories = [...new Set(keys.map(key => key.slice(0, key.lastIndexOf('/'))))];
            for (const directory of directories) {
              const listed = await client.storage.from('knowledge-base').list(directory, { limit: 100 });
              if (listed.error || !listed.data || listed.data.length >= 100
                || listed.data.some(object => keys.includes(`${directory}/${object.name}`))) verified = false;
            }
          }
        } catch { verified = false; }
        const storageDuration = Math.round(performance.now() - started);
        completion = verified ? { ...data, storage_verified: true, cleanup_storage_ms: storageDuration, cleanup_object_count: keys.length } : { ...data, error_code: 'STORAGE_FAILED', retryable: true };
      }
    }
    const result = await client.rpc('kb_worker_command', { p_scope: scope, p_operation: operation, p_id: id, p_data: completion });
    checkDatabase(result.error);
    if (operation === 'claim') {
      const parsed = KnowledgeClaimSchema.safeParse(result.data);
      if (!parsed.success) throw new KnowledgeError('MANIFEST_INVALID', 503);
      const claim = parsed.data;
      if (!claim) return knowledgeResponse(null);
      const version = claim.version;
      if (claim.job.kind === 'INGEST') {
        const target = await client.storage.from('knowledge-base').createSignedUrl(version.source_object_key, 60);
        if (target.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
        return knowledgeResponse({ ...claim, source_url: target.data.signedUrl });
      }
      return knowledgeResponse(claim);
    }
    return knowledgeResponse(result.data);
  } catch (error) { return knowledgeFailure(error instanceof z.ZodError ? new KnowledgeError('INVALID_INPUT') : error); }
}
