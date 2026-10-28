import { createHash } from 'node:crypto';
import { knowledgeValidation as z, preparedSupportClaimSchema, preparedSupportCompletionSchema,
  preparedSupportLeaseSchema } from '@deskatlas/validation';
import { authorizeKnowledgeWorker, checkDatabase, KnowledgeError, knowledgeFailure,
  knowledgeResponse } from '../../../../admin/knowledge/_lib/server';
import { validatePreparedOriginals } from '../../../../../../server/assistant/preparation';

export const runtime = 'nodejs';
// PRD-F27 / ERD-E25,E27: the existing private worker capability owns preparation.
export async function POST(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  try {
    const { client, scope } = authorizeKnowledgeWorker(request);
    if (process.env.KB_SUPPORT_PREPARATION_ENABLED !== 'true') throw new KnowledgeError('NOT_CONFIGURED', 503);
    const { path = [] } = await context.params;
    const [jobId, action] = path;
    const operation = jobId === 'claim' && path.length === 1 ? 'claim' : action;
    if (!['claim', 'heartbeat', 'complete', 'fail', 'retry'].includes(operation ?? '')
      || (operation !== 'claim' && path.length !== 2)) throw new KnowledgeError('NOT_FOUND', 404);
    const id = operation === 'claim' ? null : z.string().uuid().parse(jobId);
    const raw: unknown = await request.json();
    const data = operation === 'claim' || operation === 'retry' ? z.object({ compiler_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(raw)
      : operation === 'complete' ? preparedSupportCompletionSchema.parse(raw)
      : operation === 'fail' ? preparedSupportLeaseSchema.extend({ error_code: z.enum([
        'PREPARATION_CAPACITY', 'PREPARATION_INVALID', 'PREPARATION_INCOMPLETE', 'PREPARATION_UNVERIFIED',
        'PREPARATION_MODEL_FAILURE', 'MANIFEST_INVALID',
      ]) }).strict().parse(raw) : preparedSupportLeaseSchema.parse(raw);
    if (operation === 'complete') {
      const completion = preparedSupportCompletionSchema.parse(data);
      const read = await client.rpc('kb_support_command', { p_scope: scope, p_operation: 'read', p_id: id,
        p_data: { lease_token: completion.lease_token, generation: completion.generation } });
      checkDatabase(read.error);
      const receipt = z.object({ accepted: z.literal(true), status: z.literal('DONE'),
        artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(read.data);
      if (receipt.success) {
        if (createHash('sha256').update(completion.artifact_text).digest('hex') !== receipt.data.artifact_sha256) {
          throw new KnowledgeError('MANIFEST_INVALID', 409);
        }
        return knowledgeResponse(receipt.data);
      }
      const current = preparedSupportClaimSchema.parse(read.data);
      let artifact: unknown;
      try { artifact = JSON.parse(completion.artifact_text); } catch { throw new KnowledgeError('MANIFEST_INVALID', 409); }
      if (!current || !validatePreparedOriginals(artifact, current.sources)) throw new KnowledgeError('MANIFEST_INVALID', 409);
    }
    const result = await client.rpc('kb_support_command', { p_scope: scope, p_operation: operation, p_id: id, p_data: data });
    checkDatabase(result.error);
    return knowledgeResponse(operation === 'claim' ? preparedSupportClaimSchema.parse(result.data) : result.data);
  } catch (error) {
    return knowledgeFailure(error instanceof z.ZodError ? new KnowledgeError('INVALID_INPUT') : error);
  }
}
