import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assistantSourceSchema, knowledgeValidation as z } from '@deskatlas/validation';
import type { CustomerKnowledgeReader } from '@deskatlas/server/assistant';

// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44/46: discovery only. Policy still comes
// from complete originals through the existing principal-bound evidence RPC.
export async function readCustomerDiscoveryCatalog(db: SupabaseClient, reader: CustomerKnowledgeReader,
  scope: string, epoch: number, authorize: () => Promise<void>) {
  await authorize();
  const documents = await db.from('kb_documents').select('id,active_version_id').eq('scope_id', scope)
    .eq('audience', 'CUSTOMER').is('deleted_at', null).not('active_version_id', 'is', null).order('id').limit(13);
  const parsedDocuments = z.array(z.object({ id: z.string().uuid(), active_version_id: z.string().uuid() }).strict()).max(12).safeParse(documents.data);
  if (documents.error || !parsedDocuments.success || !parsedDocuments.data.length) throw new Error('CUSTOMER_CATALOG_UNAVAILABLE');
  const rows = parsedDocuments.data;
  const versions = await db.from('kb_document_versions').select('id,generation').in('id', rows.map(row => row.active_version_id));
  const generations = z.array(z.object({ id: z.string().uuid(), generation: z.number().int().positive() }).strict()).safeParse(versions.data);
  if (versions.error || !generations.success || generations.data.length !== rows.length
    || new Set(generations.data.map(version => version.id)).size !== rows.length
    || rows.some(row => !generations.data.some(version => version.id === row.active_version_id))) throw new Error('CUSTOMER_CATALOG_UNAVAILABLE');
  const chunks = await db.from('kb_chunks').select('id,version_id,generation,ordinal,heading_path')
    .in('version_id', rows.map(row => row.active_version_id)).order('ordinal').limit(1001);
  const parsedChunks = z.array(z.object({ id: z.string().uuid(), version_id: z.string().uuid(), generation: z.number().int().positive(),
    ordinal: z.number().int().nonnegative(), heading_path: z.string().max(500) }).strict()).max(1000).safeParse(chunks.data);
  if (chunks.error || !parsedChunks.success) throw new Error('CUSTOMER_CATALOG_UNAVAILABLE');
  const entries = parsedChunks.data;
  const sources: z.infer<typeof assistantSourceSchema>[] = [];
  const headings: string[][] = [];
  // Bounded parallel reads use the existing authorization and full version verifier.
  // No content is read directly from the service-role chunks query above.
  for (let offset = 0; offset < rows.length; offset += 3) {
    const batch = await Promise.all(rows.slice(offset, offset + 3).map(async document => {
      const generation = generations.data.find(version => version.id === document.active_version_id)!.generation;
      const matching = entries.filter(chunk => chunk.version_id === document.active_version_id && chunk.generation === generation);
      const seed = matching.find(chunk => chunk.ordinal === 0);
      if (!seed) throw new Error('CUSTOMER_CATALOG_UNAVAILABLE');
      const source = assistantSourceSchema.parse(await reader.read('source', { p_version: document.active_version_id, p_chunk: seed.id }));
      if (source.epoch !== epoch || source.document_id !== document.id || source.version_id !== document.active_version_id
        || source.chunk_id !== seed.id || createHash('sha256').update(source.content).digest('hex') !== source.content_hash) throw new Error('KNOWLEDGE_CHANGED');
      return { source, headings: [...new Set(matching.map(chunk => chunk.heading_path))] };
    }));
    for (const entry of batch) { sources.push(entry.source); headings.push(entry.headings); }
  }
  await authorize();
  return { sources, headings };
}
