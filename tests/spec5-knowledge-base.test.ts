import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeUploadSchema, KnowledgePublishSchema, KnowledgeCheckpointSchema, KnowledgeCompleteSchema } from '../packages/validation/src/knowledgeSchema';
import { knowledgeCanRetrieve } from '../packages/domain/src/models/knowledge';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

const stub = vi.hoisted(() => ({ profile: { role: 'ADMIN', is_active: true }, error: null as null | { message: string }, calls: 0 }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  from: () => { stub.calls++; return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stub.profile, error: stub.error }) }) }) }; },
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
}) }));
import { authorizeKnowledge, authorizeKnowledgeWorker, detectKnowledgeType, knowledgeFailure } from '../apps/admin-portal/src/app/api/admin/knowledge/_lib/server';
import { POST as workerPost } from '../apps/admin-portal/src/app/api/internal/knowledge/jobs/[[...path]]/route';

const actor = '00000000-0000-4000-8000-000000000001';
const secret = 'synthetic-test-session-signing-key-only';
const token = () => issueAdminSession(actor, secret);
function request(method = 'GET', headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/admin/knowledge/documents', { method, headers: { Authorization: `Bearer ${token()}`, ...(method !== 'GET' ? { Origin: 'http://localhost:3000' } : {}), ...headers } });
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('KB_SCOPE_ID', 'test-scope'); vi.stubEnv('KB_WORKER_TOKEN', 'synthetic-independent-worker-token-only');
  stub.profile = { role: 'ADMIN', is_active: true }; stub.error = null; stub.calls = 0;
});

describe('SPEC5-TC01/05/15: strict inputs and verified actor boundary', () => {
  it('defaults to admin-only and rejects mismatched/unknown/unsafe upload fields', () => {
    const input = { title: 'Safe SOP', filename: 'guide.md', declared_type: 'MD', request_id: actor };
    expect(KnowledgeUploadSchema.parse(input).audience).toBe('ADMIN_ONLY');
    for (const change of [{ declared_type: 'PDF' }, { filename: '../guide.md' }, { role: 'ADMIN' }, { replace_document_id: actor }, { audience: 'PUBLIC' }, { filename: 'script.docm' }])
      expect(KnowledgeUploadSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('requires explicit review inputs and optimistic revision', () => {
    expect(KnowledgePublishSchema.safeParse({ audience: 'ADMIN_ONLY' }).success).toBe(false);
    expect(KnowledgePublishSchema.safeParse({ audience: 'ADMIN_ONLY', expected_revision: 1, request_id: actor, acknowledge_warnings: true }).success).toBe(true);
  });
  it('verifies the signature and fresh active admin profile', async () => {
    expect((await authorizeKnowledge(request())).actor).toBe(actor);
    stub.profile.is_active = false;
    await expect(authorizeKnowledge(request())).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE', status: 403 });
    stub.profile = { role: 'STAFF', is_active: true };
    await expect(authorizeKnowledge(request())).rejects.toMatchObject({ code: 'ACCESS_REVOKED', status: 403 });
  });
  it('accepts same-origin uploads when Next.js binds to 0.0.0.0', async () => {
    const upload = new Request('http://0.0.0.0:3000/api/admin/knowledge/uploads', {
      method: 'POST', headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', Authorization: `Bearer ${token()}` },
    });
    expect((await authorizeKnowledge(upload)).actor).toBe(actor);
  });
  it('preserves host, protocol, port and cross-site restrictions for uploads', async () => {
    for (const headers of [
      { Origin: 'http://attacker.invalid:3000' },
      { Origin: 'http://localhost:3001' },
      { Origin: 'https://localhost:3000' },
      { Origin: 'null' },
      { Origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
      { Origin: 'http://0.0.0.0:3000' },
    ]) {
      const upload = new Request('http://0.0.0.0:3000/api/admin/knowledge/uploads', {
        method: 'POST', headers: { Host: 'localhost:3000', Authorization: `Bearer ${token()}`, ...headers },
      });
      await expect(authorizeKnowledge(upload)).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    }
    expect(stub.calls).toBe(0);
  });
  it('denies forged role headers, expired sessions and cross-origin mutations', async () => {
    await expect(authorizeKnowledge(request('GET', { Authorization: 'Bearer forged', 'x-user-role': 'ADMIN', 'x-user-id': actor }))).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    const expired = issueAdminSession(actor, secret, Date.now() - 3600001);
    await expect(authorizeKnowledge(request('GET', { Authorization: `Bearer ${expired}` }))).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    await expect(authorizeKnowledge(request('POST', { Origin: 'https://attacker.invalid' }))).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    await expect(authorizeKnowledge(request('POST', { Origin: '' }))).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
  });
  it('fails closed while disabled and when identity storage is unavailable', async () => {
    vi.stubEnv('KB_ENABLED', 'false');
    await expect(authorizeKnowledge(request())).rejects.toMatchObject({ code: 'KB_DISABLED' });
    vi.stubEnv('KB_ENABLED', 'true'); stub.error = { message: 'private database detail' };
    await expect(authorizeKnowledge(request())).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    const response = knowledgeFailure(new Error('source content and credentials'));
    expect(await response.text()).not.toContain('credentials');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('worker ingress never accepts an admin/user session as a worker credential', async () => {
    expect(() => authorizeKnowledgeWorker(request())).toThrow('FORBIDDEN');
    const response = await workerPost(new Request('http://localhost/api/internal/knowledge/jobs/claim', { method: 'POST', body: '{}' }), { params: Promise.resolve({ path: ['claim'] }) });
    expect(response.status).toBe(403); expect(stub.calls).toBe(0);
  });
  it('requires matching byte signatures and valid UTF-8; executable/ZIP impersonation fails', () => {
    expect(detectKnowledgeType(Buffer.from('# SOP\nDo this.'), 'MD')).toBe('MD');
    expect(() => detectKnowledgeType(Buffer.from('%PDF-1.7'), 'MD')).toThrow('TYPE_MISMATCH');
    expect(() => detectKnowledgeType(Buffer.from([0xff, 0xfe]), 'MD')).toThrow('TYPE_MISMATCH');
    expect(() => detectKnowledgeType(Buffer.from('MZ executable'), 'MD')).toThrow('UNSAFE_FILE');
    expect(() => detectKnowledgeType(Buffer.from('504b0304', 'hex'), 'DOCX')).toThrow('MALFORMED_FILE');
  });
});

describe('SPEC5-TC09/10/12/18/20: retrieval and replacement visibility', () => {
  const document = { active_version_id: actor, deleted_at: null, audience: 'ADMIN_ONLY' as const };
  const version = { id: actor, status: 'PUBLISHED' as const };
  it('excludes READY, failed replacements, superseded and removed versions', () => {
    expect(knowledgeCanRetrieve(document, version, 'ADMIN', 'v1', 'v1')).toBe(true);
    for (const status of ['READY', 'FAILED', 'SUPERSEDED', 'REMOVED'] as const)
      expect(knowledgeCanRetrieve(document, { ...version, status }, 'ADMIN', 'v1', 'v1')).toBe(false);
    expect(knowledgeCanRetrieve(document, { ...version, id: 'replacement' }, 'ADMIN', 'v1', 'v1')).toBe(false);
  });
  it('revokes removed, restricted and incompatible generation evidence', () => {
    expect(knowledgeCanRetrieve({ ...document, deleted_at: 'now' }, version, 'ADMIN', 'v1', 'v1')).toBe(false);
    expect(knowledgeCanRetrieve(document, version, 'STAFF', 'v1', 'v1')).toBe(false);
    expect(knowledgeCanRetrieve({ ...document, audience: 'ADMIN_AND_STAFF' }, version, 'STAFF', 'v1', 'v1')).toBe(true);
    expect(knowledgeCanRetrieve(document, version, 'ADMIN', 'v2', 'v1')).toBe(false);
  });
});

describe('SPEC5-TC08/16: fenced worker contracts and vector integrity', () => {
  const chunk = { ordinal: 0, heading_path: 'SOP', page_start: null, page_end: null, content: 'Safe text', content_sha256: 'a'.repeat(64), token_count: 10, extraction_method: 'TEXT', embedding: [1, ...Array(1023).fill(0)] };
  const checkpoint = { lease_token: actor, generation: 1, stage: 'EMBEDDING', chunks: [chunk] };
  it('accepts a bounded, normalized 1024-dimensional vector with a lease', () => {
    expect(KnowledgeCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    for (const embedding of [Array(1024).fill(0), [1], [NaN, ...Array(1023).fill(0)], [2, ...Array(1023).fill(0)]])
      expect(KnowledgeCheckpointSchema.safeParse({ ...checkpoint, chunks: [{ ...chunk, embedding }] }).success).toBe(false);
    expect(KnowledgeCheckpointSchema.safeParse({ ...checkpoint, lease_token: undefined }).success).toBe(false);
    expect(KnowledgeCheckpointSchema.safeParse({ ...checkpoint, generation: 0 }).success).toBe(false);
  });
  it('rejects arbitrary exception payloads in persistent errors', () => {
    expect(KnowledgeCompleteSchema.safeParse({ lease_token: actor, generation: 1, error_code: 'source content or credentials' }).success).toBe(false);
  });
});
