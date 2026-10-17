import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { KnowledgeUploadSchema, KnowledgeCompleteSchema } from '../packages/validation/src/knowledgeSchema';
import { knowledgeDisplayTitle, knowledgeProcessingRemedy } from '../packages/domain/src/models/knowledge';

const boundary = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server', async importOriginal => {
  const original = await importOriginal<typeof import('../apps/admin-portal/src/app/api/admin/knowledge/_lib/server')>();
  return { ...original, authorizeKnowledge: boundary.authorize };
});
import { GET, POST } from '../apps/admin-portal/src/app/api/admin/knowledge/[...path]/route';
const id = '00000000-0000-4000-8000-000000000001';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('MS64-TC01/03/05/11/13: single upload contract and server authority', () => {
  it('accepts filename and audience alone, defaulting private, without accepting forged verification', () => {
    const input = { filename: 'guide.md', declared_type: 'MD', request_id: id };
    expect(KnowledgeUploadSchema.parse(input).audience).toBe('ADMIN_ONLY');
    expect(KnowledgeUploadSchema.safeParse({ ...input, system_verification: {} }).success).toBe(false);
    expect(KnowledgeUploadSchema.safeParse({ ...input, audience: 'PUBLIC' }).success).toBe(false);
    expect(KnowledgeUploadSchema.safeParse({ ...input, replace_document_id: id }).success).toBe(false);
    expect(KnowledgeCompleteSchema.safeParse({ lease_token: id, generation: 1, preparation_policy: 'invented' }).success).toBe(false);
  });
  it.each([
    ['  Daily guide.PDF', 'Daily guide'], ['<>.md', 'Untitled document'],
    ['a\u202eb.docx', 'ab'], ['\u0001.md', 'Untitled document'],
  ])('derives a safe title from %s', (filename, expected) => expect(knowledgeDisplayTitle(filename)).toBe(expected));
  it('bounds Unicode titles and keeps matching names independent of document IDs', () => {
    expect(Array.from(knowledgeDisplayTitle('😀'.repeat(230) + '.md'))).toHaveLength(200);
    expect(knowledgeDisplayTitle('guide.md')).toBe(knowledgeDisplayTitle('guide.pdf'));
    expect(knowledgeProcessingRemedy('ENCRYPTED_FILE')).toContain('unlocked');
    expect(knowledgeProcessingRemedy('STORAGE_FAILED')).toContain('Retry');
    expect(knowledgeProcessingRemedy('private stack')).not.toContain('private stack');
  });
  it.each([['Staff checkout guide', 'Staff checkout guide'], [undefined, 'guide']])('routes an upload using the entered name %s with a filename fallback', async (title, expected) => {
    vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'a'.repeat(64));
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const client = createClient('http://localhost:54321', 'synthetic-ms64-test', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith('kb_admin_command')) return Response.json({ id, document_id: id });
      if (url.pathname.includes('/kb_document_versions')) return Response.json({ status: 'QUEUED', created_at: new Date().toISOString() });
      return Response.json({});
    } } });
    boundary.authorize.mockResolvedValue({ client, actor: id, scope: 'test' });
    const response = await POST(new Request('http://localhost:3000/api/admin/knowledge/uploads', { method: 'POST', body: JSON.stringify({ filename: 'guide.md', title, declared_type: 'MD', request_id: id }) }), { params: Promise.resolve({ path: ['uploads'] }) });
    expect(response.status).toBe(200);
    expect(calls.find(call => call.path.endsWith('kb_admin_command'))?.body).toMatchObject({ p_operation: 'upload_auto', p_data: { title: expected, audience: 'ADMIN_ONLY' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('reconciles an ambiguous upload using owner and scope filters without another write', async () => {
    const urls: URL[] = [];
    const client = createClient('http://localhost:54321', 'synthetic-ms64-test', { global: { fetch: async input => {
      urls.push(new URL(String(input))); return Response.json(null);
    } } });
    boundary.authorize.mockResolvedValue({ client, actor: id, scope: 'test' });
    const response = await GET(new Request(`http://localhost:3000/api/admin/knowledge/uploads/${id}`), { params: Promise.resolve({ path: ['uploads', id] }) });
    expect(response.status).toBe(200);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('uploaded_by')).toBe(`eq.${id}`);
    expect(urls[0].searchParams.get('document.scope_id')).toBe('eq.test');
    expect(urls[0].searchParams.get('request_id')).toBe(`eq.${id}`);
  });
});
