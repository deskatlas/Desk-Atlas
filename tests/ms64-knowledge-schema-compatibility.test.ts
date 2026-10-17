import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const boundary = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server', async importOriginal => ({
  ...await importOriginal<typeof import('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server')>(),
  authorizeKnowledge: boundary.authorize,
}));
import { GET, POST } from '../apps/admin-portal/src/app/api/admin/knowledge/[...path]/route';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// PRD-F27 / QAD-TC45: a pending MS-64 migration must not hide existing files.
it('reads legacy files when only the automatic upload column is missing', async () => {
  const urls: URL[] = [];
  const client = createClient('http://localhost:54321', 'synthetic', { global: { fetch: async input => {
    const url = new URL(String(input)); urls.push(url);
    if (url.searchParams.get('select')?.includes('upload_intent')) return Response.json({ code: '42703', message: 'column kb_document_versions_1.upload_intent does not exist' }, { status: 400 });
    return Response.json([{ id: 'doc', deleted_at: null, active_version_id: 'version', jobs: [], versions: [{ id: 'version', status: 'PUBLISHED' }] }]);
  } } });
  boundary.authorize.mockResolvedValue({ client, actor: 'admin', scope: 'test' });
  const response = await GET(new Request('http://localhost/api/admin/knowledge/documents'), { params: Promise.resolve({ path: ['documents'] }) });
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.documents[0].versions[0].automatic_preparation).toBe(false);
  expect(urls).toHaveLength(2);
  for (const url of urls) {
    expect(url.searchParams.get('scope_id')).toBe('eq.test');
    expect(url.searchParams.get('deleted_at')).toBe('is.null');
    expect(url.searchParams.get('versions.status')).toBe('not.in.(REMOVED,SUPERSEDED)');
    expect(url.searchParams.get('limit')).toBe('21');
  }
});

it('does not retry unrelated database failures as legacy reads', async () => {
  const fetch = vi.fn(async () => Response.json({ code: '42703', message: 'column unrelated does not exist' }, { status: 400 }));
  boundary.authorize.mockResolvedValue({ client: createClient('http://localhost:54321', 'synthetic', { global: { fetch } }), actor: 'admin', scope: 'test' });
  const response = await GET(new Request('http://localhost/api/admin/knowledge/documents'), { params: Promise.resolve({ path: ['documents'] }) });
  expect(response.status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('blocks new uploads with an update remedy before creating intent on a legacy database', async () => {
  vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'a'.repeat(64));
  const fetch = vi.fn(async () => Response.json({ code: '42703', message: 'column kb_document_versions.upload_intent does not exist' }, { status: 400 }));
  boundary.authorize.mockResolvedValue({ client: createClient('http://localhost:54321', 'synthetic', { global: { fetch } }), actor: 'admin', scope: 'test' });
  const response = await POST(new Request('http://localhost/api/admin/knowledge/uploads', { method: 'POST', body: JSON.stringify({ filename: 'guide.md', declared_type: 'MD', request_id: '00000000-0000-4000-8000-000000000001' }) }), { params: Promise.resolve({ path: ['uploads'] }) });
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe('UPDATE_REQUIRED');
  expect(fetch).toHaveBeenCalledTimes(1);
});
