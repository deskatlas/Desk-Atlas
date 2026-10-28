import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assistantSourceSchema, knowledgeValidation as z } from '@deskatlas/validation';
import { AssistantError } from '@deskatlas/domain';

// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44/46. Discovery metadata grants no
// policy authority. Every introduction uses the existing actor-bound reader.
export async function readInternalDiscoveryCatalog(db: SupabaseClient, role: 'ADMIN' | 'STAFF', scope: string,
  epoch: number, signal: AbortSignal, ports: { authorize(): Promise<void>; source(version: string, chunk: string): Promise<unknown> }) {
  await ports.authorize();
  const audiences = role === 'ADMIN' ? ['ADMIN_ONLY', 'ADMIN_AND_STAFF'] : ['ADMIN_AND_STAFF'];
  const documents = await db.from('kb_documents').select('id,active_version_id,audience').eq('scope_id', scope)
    .in('audience', audiences).is('deleted_at', null).not('active_version_id', 'is', null).order('id').limit(17).abortSignal(signal);
  const rows = z.array(z.object({ id: z.string().uuid(), active_version_id: z.string().uuid(),
    audience: z.enum(['ADMIN_ONLY', 'ADMIN_AND_STAFF']) }).strict()).min(1).max(16).safeParse(documents.data);
  if (documents.error || !rows.success || rows.data.some(row => !audiences.includes(row.audience))) throw new AssistantError('DATA_UNAVAILABLE', 'The authorized discovery catalog is unavailable.', 503);
  const versions = await db.from('kb_document_versions').select('id,generation')
    .in('id', rows.data.map(row => row.active_version_id)).abortSignal(signal);
  const generations = z.array(z.object({ id: z.string().uuid(), generation: z.number().int().positive() }).strict()).safeParse(versions.data);
  if (versions.error || !generations.success || generations.data.length !== rows.data.length
    || new Set(generations.data.map(version => version.id)).size !== rows.data.length
    || rows.data.some(row => !generations.data.some(version => version.id === row.active_version_id))) throw new AssistantError('DATA_UNAVAILABLE', 'Discovery generations are unavailable.', 503);
  const chunks = await db.from('kb_chunks').select('id,version_id,generation,ordinal,heading_path')
    .in('version_id', rows.data.map(row => row.active_version_id)).order('ordinal').limit(1001).abortSignal(signal);
  const entries = z.array(z.object({ id: z.string().uuid(), version_id: z.string().uuid(), generation: z.number().int().positive(), ordinal: z.number().int().nonnegative(),
    heading_path: z.string().max(500) }).strict()).max(1000).safeParse(chunks.data);
  if (chunks.error || !entries.success) throw new AssistantError('DATA_UNAVAILABLE', 'The authorized discovery catalog is unavailable.', 503);
  const sources: z.infer<typeof assistantSourceSchema>[] = [], headings: string[][] = [];
  for (let offset = 0; offset < rows.data.length; offset += 3) {
    const batch = await Promise.all(rows.data.slice(offset, offset + 3).map(async document => {
      const generation = generations.data.find(version => version.id === document.active_version_id)!.generation;
      const matching = entries.data.filter(chunk => chunk.version_id === document.active_version_id && chunk.generation === generation);
      const seed = matching.find(chunk => chunk.ordinal === 0);
      if (!seed) throw new AssistantError('DATA_UNAVAILABLE', 'A discovery source is missing.', 503);
      const source = assistantSourceSchema.parse(await ports.source(document.active_version_id, seed.id));
      if (source.epoch !== epoch || source.document_id !== document.id || source.version_id !== document.active_version_id
        || source.chunk_id !== seed.id || createHash('sha256').update(source.content).digest('hex') !== source.content_hash) {
        throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
      }
      return { source, headings: [...new Set(matching.map(chunk => chunk.heading_path))] };
    }));
    for (const entry of batch) { sources.push(entry.source); headings.push(entry.headings); }
  }
  await ports.authorize();
  return { sources, headings };
}
