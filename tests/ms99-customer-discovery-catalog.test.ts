// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44/46: discovery cannot become policy authority.
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerKnowledgeReader } from '@deskatlas/server/assistant';
import { describe, expect, it, vi } from 'vitest';
import { readCustomerDiscoveryCatalog } from '../apps/customer-website/src/server/customer-assistant/catalog';

function fixture(count = 2) {
  const documents = Array.from({ length: count }, () => ({ id: randomUUID(), active_version_id: randomUUID() }));
  const versions = documents.map(document => ({ id: document.active_version_id, generation: 2 }));
  const chunks = documents.map(document => ({ id: randomUUID(), version_id: document.active_version_id, generation: 2, ordinal: 0, heading_path: 'Booking' }));
  const content = 'No customer account is required.';
  const originals = chunks.map((chunk, i) => ({ document_id: documents[i].id, version_id: chunk.version_id, chunk_id: chunk.id,
    title: 'Booking', heading_path: chunk.heading_path, content, epoch: 7, source_page: null, extraction_method: 'TEXT',
    content_hash: createHash('sha256').update(content).digest('hex') }));
  const query = (data: unknown[]) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data, error: null })) });
  const documentQuery = query(documents), chunkQuery = query(chunks);
  const from = vi.fn((table: string) => table === 'kb_documents' ? documentQuery : table === 'kb_document_versions' ? query(versions) : chunkQuery);
  const read = vi.fn(async (_operation: string, args: Record<string, string>) => originals.find(source => source.chunk_id === args.p_chunk));
  return { documents, chunks, originals, documentQuery, chunkQuery, from, read,
    db: { from } as unknown as SupabaseClient, reader: { read } as unknown as CustomerKnowledgeReader };
}

describe('MS99 source-bound customer discovery', () => {
  it('filters current customer metadata before reading content through the existing principal-bound RPC', async () => {
    const f = fixture(); const authorize = vi.fn(async () => {});
    const catalog = await readCustomerDiscoveryCatalog(f.db, f.reader, 'scope', 7, authorize);
    expect(catalog.sources).toEqual(f.originals);
    expect(catalog.headings).toEqual([['Booking'], ['Booking']]);
    expect(f.documentQuery.eq).toHaveBeenCalledWith('scope_id', 'scope');
    expect(f.documentQuery.eq).toHaveBeenCalledWith('audience', 'CUSTOMER');
    expect(f.chunkQuery.select).toHaveBeenCalledWith('id,version_id,generation,ordinal,heading_path');
    expect(f.chunkQuery.in).toHaveBeenCalledWith('version_id', f.documents.map(document => document.active_version_id));
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it.each(['epoch', 'hash', 'version', 'withdrawal'])('rejects a %s change before metadata can reach the discovery model', async mutation => {
    const f = fixture();
    if (mutation === 'epoch') f.originals[0].epoch = 8;
    if (mutation === 'hash') f.originals[0].content = 'Changed policy';
    if (mutation === 'version') f.originals[0].version_id = randomUUID();
    if (mutation === 'withdrawal') f.read.mockRejectedValue(new Error('KNOWLEDGE_UNAVAILABLE'));
    await expect(readCustomerDiscoveryCatalog(f.db, f.reader, 'scope', 7, async () => {})).rejects.toThrow();
  });
  it('refuses an oversized catalog instead of silently omitting documents', async () => {
    const f = fixture(13);
    await expect(readCustomerDiscoveryCatalog(f.db, f.reader, 'scope', 7, async () => {})).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
  });
  it('does not select obsolete-generation seeds or discovery headings', async () => {
    const f = fixture();
    f.chunks.unshift({ ...f.chunks[0], id: randomUUID(), generation: 1, heading_path: 'Obsolete policy' });
    const result = await readCustomerDiscoveryCatalog(f.db, f.reader, 'scope', 7, async () => {});
    expect(result.sources).toEqual(f.originals);
    expect(result.headings).toEqual([['Booking'], ['Booking']]);
    expect(f.read).not.toHaveBeenCalledWith('source', expect.objectContaining({ p_chunk: f.chunks[0].id }));
  });
});
