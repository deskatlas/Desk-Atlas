import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { knowledgeWorkingDocument, type KnowledgeDocument, type KnowledgeStatus } from '../packages/domain/src/models/knowledge';
import { KnowledgeFreshness } from '../apps/admin-portal/src/features/settings/knowledgeFreshness';

const boundary = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server', async importOriginal => {
  const original = await importOriginal<typeof import('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server')>();
  return { ...original, authorizeKnowledge: boundary.authorize };
});
import { GET } from '../apps/admin-portal/src/app/api/admin/knowledge/[...path]/route';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function document(n = 1, statuses: KnowledgeStatus[] = ['PUBLISHED']): KnowledgeDocument {
  return { id: id(n), title: 'Operating guide', audience: 'ADMIN_ONLY', revision: 3, deleted_at: null,
    active_version_id: statuses.includes('PUBLISHED') ? `v${statuses.indexOf('PUBLISHED')}` : null,
    versions: statuses.map((status, index) => ({ id: `v${index}`, document_id: id(n), status, version_number: index + 1,
      original_filename: `guide-${index}.md`, warning_codes: [], created_at: '2026-10-15T00:00:00Z', reviewed_at: null,
      published_at: null, expected_revision: 3, generation: 1, chunk_count: 1 })), jobs: [] };
}
afterEach(() => vi.restoreAllMocks());
describe('MS51-TC01-04/08/09: working document lifecycle projection', () => {
  it('hides removed documents and documents with only retained history', () => {
    expect(knowledgeWorkingDocument({ ...document(), deleted_at: '2026-10-15' })).toBeNull();
    expect(knowledgeWorkingDocument(document(1, ['REMOVED', 'SUPERSEDED']))).toBeNull();
  });
  it.each<KnowledgeStatus>(['UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'])('keeps publication primary during %s replacement', status => {
    const source = document(1, ['SUPERSEDED', 'PUBLISHED', status, 'REMOVED']);
    const result = knowledgeWorkingDocument(source)!;
    expect(result.versions.map(v => v.status)).toEqual(['PUBLISHED', status]);
    expect(source.versions).toHaveLength(4);
  });
  it('promotes publication while preserving all actionable drafts and review warnings', () => {
    const source = document(1, ['SUPERSEDED', 'FAILED', 'PUBLISHED', 'READY']);
    source.versions[3].warning_codes = ['OCR_USED'];
    expect(knowledgeWorkingDocument(source)?.versions.map(v => v.status)).toEqual(['PUBLISHED', 'READY', 'FAILED']);
    expect(knowledgeWorkingDocument(source)?.versions[1].warning_codes).toEqual(['OCR_USED']);
    expect(knowledgeWorkingDocument(document(1, ['FAILED', 'REMOVED']))?.versions[0].status).toBe('FAILED');
  });
  it('keeps the publication even when the newest file was removed', () => {
    expect(knowledgeWorkingDocument(document(1, ['PUBLISHED', 'REMOVED']))?.versions.map(v => v.status)).toEqual(['PUBLISHED']);
  });
});
describe('MS51-TC06/07: delayed reads, pagination and mutation fences', () => {
  it('rejects delayed pre-write pages, overlapping snapshots and reads during writes', async () => {
    const state = new KnowledgeFreshness();
    const oldPage = state.beginRead();
    const newerSnapshot = state.beginRead();
    expect(state.accepts(oldPage)).toBe(false);
    expect(state.accepts(newerSnapshot)).toBe(true);
    expect(state.beginWrite()).toBe(true);
    expect(state.beginWrite()).toBe(false);
    expect(state.beginRead()).toBeNull();
    expect(state.accepts(newerSnapshot)).toBe(false);
    state.endWrite();
    const reconcile = state.beginRead();
    expect(state.accepts(oldPage)).toBe(false);
    expect(state.accepts(reconcile)).toBe(true);
    state.reset();
    expect(state.accepts(reconcile)).toBe(false);
  });
});
describe('MS51-TC05/08/11: real route and Supabase query serialization', () => {
  function setup(rows: KnowledgeDocument[]) {
    const urls: URL[] = [];
    const client = createClient('http://localhost:54321', 'synthetic-ms51-test-key', { global: { fetch: async input => {
      const url = new URL(String(input)); urls.push(url);
      const q = url.searchParams;
      // Emulate PostgREST selection using the actual serialized query, including
      // parent filtering and embedded !inner semantics before the limit.
      let selected = rows.slice();
      if (q.get('deleted_at') === 'is.null') selected = selected.filter(row => row.deleted_at === null);
      if (q.get('versions.status') === 'not.in.(REMOVED,SUPERSEDED)') {
        selected = selected.map(row => ({ ...row, versions: row.versions.filter(v => !['REMOVED', 'SUPERSEDED'].includes(v.status)) }));
        if (q.get('select')?.includes('_fkey!inner')) selected = selected.filter(row => row.versions.length > 0);
      }
      if (q.get('jobs.kind') === 'eq.PURGE') selected = selected.map(row => ({ ...row, jobs: row.jobs.filter(j => j.kind === 'PURGE' && ['QUEUED', 'RUNNING', 'RETRY', 'FAILED'].includes(j.status)) })).filter(row => row.jobs.length);
      const cursor = q.get('id')?.replace('gt.', '');
      if (cursor) selected = selected.filter(row => row.id > cursor);
      selected.sort((a, b) => a.id.localeCompare(b.id));
      return Response.json(selected.slice(0, Number(q.get('limit'))));
    } }, auth: { persistSession: false, autoRefreshToken: false } });
    boundary.authorize.mockResolvedValue({ client, actor: id(99), scope: 'scope' });
    return urls;
  }
  async function read(resource = 'documents', cursor?: string) {
    const response = await GET(new Request(`http://localhost:3000/api/admin/knowledge/${resource}${cursor ? `?cursor=${cursor}` : ''}`), { params: Promise.resolve({ path: [resource] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return (await response.json()).data;
  }
  it('pages across many tombstones and retired-only documents without empty-page traps', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => i % 3 === 0 ? document(i + 1, ['REMOVED']) : i % 3 === 1 ? { ...document(i + 1), deleted_at: '2026-10-15' } : document(i + 1, ['PUBLISHED', 'REMOVED', 'SUPERSEDED', 'READY']));
    const urls = setup(rows);
    const first = await read();
    expect(first.documents).toHaveLength(20);
    expect(first.next_cursor).toBe(id(60));
    const second = await read('documents', first.next_cursor);
    expect(second.documents).toHaveLength(10);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.documents, ...second.documents].map((row: KnowledgeDocument) => row.id)).size).toBe(30);
    expect(first.documents[0].versions.map((v: { status: string }) => v.status)).toEqual(['PUBLISHED', 'READY']);
    expect(urls[0].searchParams.get('scope_id')).toBe('eq.scope');
  });
  it('exposes actionable cleanup separately, including deleted documents, with its own cursor', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ ...document(i + 1, ['REMOVED']), deleted_at: '2026-10-15', jobs: [{ id: 'j', version_id: 'v0', kind: 'PURGE', status: i % 2 ? 'QUEUED' : 'FAILED', stage: null, last_error_code: null }] }));
    setup(rows);
    expect((await read()).documents).toEqual([]);
    const first = await read('cleanup');
    expect(first.documents).toHaveLength(20);
    expect(first.documents[0]).toMatchObject({ id: id(1), title: 'Operating guide', revision: 3, pending: 0, failed: 1 });
    const last = await read('cleanup', first.next_cursor);
    expect(last.documents).toHaveLength(3); expect(last.next_cursor).toBeNull();
  });
});
