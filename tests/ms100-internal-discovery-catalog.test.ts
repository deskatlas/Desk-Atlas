// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44/46: internal discovery boundaries.
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { readInternalDiscoveryCatalog } from '../apps/admin-portal/src/server/assistant/catalog';

function fixture(count = 2) {
  const documents = Array.from({ length: count }, () => ({ id: randomUUID(), active_version_id: randomUUID(), audience: 'ADMIN_AND_STAFF' }));
  const versions = documents.map(document => ({ id: document.active_version_id, generation: 2 }));
  const chunks = documents.map(document => ({ id: randomUUID(), version_id: document.active_version_id, generation: 2, ordinal: 0, heading_path: 'Procedure' }));
  const content = 'Original introduction.';
  const originals = chunks.map((chunk, i) => ({ document_id: documents[i].id, version_id: chunk.version_id, chunk_id: chunk.id,
    title: 'Operations', heading_path: chunk.heading_path, content, epoch: 7, source_page: null, extraction_method: 'TEXT',
    content_hash: createHash('sha256').update(content).digest('hex') }));
  const query = (data: unknown[]) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })) });
  const documentQuery = query(documents), chunkQuery = query(chunks);
  const from = vi.fn((table: string) => table === 'kb_documents' ? documentQuery : table === 'kb_document_versions' ? query(versions) : chunkQuery);
  const source = vi.fn(async (_version: string, chunk: string) => originals.find(original => original.chunk_id === chunk));
  const authorize = vi.fn(async () => {});
  return { documents, versions, chunks, originals, documentQuery, chunkQuery, source, authorize,
    db: { from } as unknown as SupabaseClient };
}
const signal = () => new AbortController().signal;

it.each(['ADMIN', 'STAFF'] as const)('filters %s metadata and reads source text only through the actor-bound port', async role => {
  const f = fixture();
  const result = await readInternalDiscoveryCatalog(f.db, role, 'scope', 7, signal(), f);
  expect(result.sources).toEqual(f.originals);
  expect(f.documentQuery.in).toHaveBeenCalledWith('audience', role === 'ADMIN' ? ['ADMIN_ONLY', 'ADMIN_AND_STAFF'] : ['ADMIN_AND_STAFF']);
  expect(f.chunkQuery.select).toHaveBeenCalledWith('id,version_id,generation,ordinal,heading_path');
  expect(f.authorize).toHaveBeenCalledTimes(2);
});
it('rejects administrator-only metadata on the staff path even if a query adapter violates its filter', async () => {
  const f = fixture(); f.documents[0].audience = 'ADMIN_ONLY';
  await expect(readInternalDiscoveryCatalog(f.db, 'STAFF', 'scope', 7, signal(), f)).rejects.toThrow();
  expect(f.source).not.toHaveBeenCalled();
});
it.each(['epoch', 'hash', 'version', 'withdrawal'])('rejects %s changes before sending a catalog to inference', async change => {
  const f = fixture();
  if (change === 'epoch') f.originals[0].epoch++;
  if (change === 'hash') f.originals[0].content = 'Changed';
  if (change === 'version') f.originals[0].version_id = randomUUID();
  if (change === 'withdrawal') f.source.mockRejectedValue(new Error('WITHDRAWN'));
  await expect(readInternalDiscoveryCatalog(f.db, 'STAFF', 'scope', 7, signal(), f)).rejects.toThrow();
});
it('fails an oversized catalog instead of silently dropping documents', async () => {
  const f = fixture(17);
  await expect(readInternalDiscoveryCatalog(f.db, 'ADMIN', 'scope', 7, signal(), f)).rejects.toThrow();
  expect(f.source).not.toHaveBeenCalled();
});
it('rejects authority revocation after introductions have been read', async () => {
  const f = fixture(); f.authorize.mockResolvedValueOnce().mockRejectedValueOnce(new Error('REVOKED'));
  await expect(readInternalDiscoveryCatalog(f.db, 'STAFF', 'scope', 7, signal(), f)).rejects.toThrow('REVOKED');
});
it('ignores old-generation seeds and headings left by retried ingestion', async () => {
  const f = fixture();
  f.chunks.unshift({ ...f.chunks[0], id: randomUUID(), generation: 1, heading_path: 'Obsolete policy' });
  const result = await readInternalDiscoveryCatalog(f.db, 'STAFF', 'scope', 7, signal(), f);
  expect(result.sources).toEqual(f.originals);
  expect(result.headings).toEqual([['Procedure'], ['Procedure']]);
  expect(f.source).not.toHaveBeenCalledWith(f.chunks[0].version_id, f.chunks[0].id);
});
