import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assistantAvailabilitySchema } from '../packages/validation/src/assistantSchema';
import { assistantStatus, assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

// MS45-TC01/02/04/05/09/11, QAD-TC44/45: authenticated gateway behavior.
const fixture = vi.hoisted(() => ({ role: 'ADMIN', active: true, eligible: false, epoch: 1, rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => fixture.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { role: fixture.role, is_active: fixture.active }, error: null }),
    abortSignal: () => ({
      single: async () => ({ data: { timezone: 'Asia/Manila' }, error: null }),
      maybeSingle: async () => ({ data: { epoch: fixture.epoch, active_embedding_fingerprint: 'fixture' }, error: null }),
    }),
  }) }) }),
}) }));
const actor = '00000000-0000-4000-8000-000000000001';
function request(post = false) {
  return new Request('http://localhost/api/assistant/query', {
    method: post ? 'POST' : 'GET', headers: { Authorization: `Bearer ${issueAdminSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}`, Origin: 'http://localhost', 'Content-Type': 'application/json' },
    ...(post ? { body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: 'Current operations' }) } : {}),
  });
}
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: randomUUID(), RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(), RAG_CAPABILITY_SECRET: randomUUID(), RAG_SCOPE_ID: 'fixture-scope', RAG_EMBEDDING_FINGERPRINT: 'fixture', RAG_MIN_SIMILARITY: '0.5' })) vi.stubEnv(key, value);
  fixture.role = 'ADMIN'; fixture.active = true; fixture.eligible = false; fixture.epoch = 1;
  fixture.rpc.mockImplementation(async (name: string) => ({ data: name === 'assistant_knowledge_availability' ? { enabled: fixture.eligible, knowledge_epoch: fixture.epoch } : { tables: [], interpretation: [], limitations: [] }, error: null }));
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('MS45 actor-scoped availability', () => {
  it.each(['ADMIN', 'STAFF'])('returns only verified projection for %s without inference', async role => {
    fixture.role = role; fixture.eligible = true;
    const response = await assistantStatus(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ data: { enabled: true, knowledge_epoch: 1, identity: { id: actor, role } } });
    expect(fixture.rpc).toHaveBeenCalledWith('assistant_knowledge_availability', { p_actor: actor, p_scope: 'fixture-scope', p_fingerprint: 'fixture' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sees first publication and last withdrawal on fresh reads', async () => {
    expect((await (await assistantStatus(request())).json()).data.enabled).toBe(false);
    fixture.eligible = true; fixture.epoch++;
    expect((await (await assistantStatus(request())).json()).data.enabled).toBe(true);
    fixture.eligible = false; fixture.epoch++;
    expect((await (await assistantStatus(request())).json()).data).toMatchObject({ enabled: false, knowledge_epoch: 3 });
  });
  it.each(['RAG_ENABLED', 'KB_ENABLED'])('keeps %s disabled even with published files', async flag => {
    fixture.eligible = true; vi.stubEnv(flag, 'false');
    expect((await (await assistantStatus(request())).json()).data.enabled).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect((await assistantQuery(request(true))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects direct live-data queries before running tools when knowledge is empty', async () => {
    expect((await assistantQuery(request(true))).status).toBe(503);
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(['assistant_knowledge_availability']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects final results if last publication is revoked while a tool runs', async () => {
    fixture.eligible = true;
    fixture.rpc.mockImplementation(async (name: string) => {
      if (name === 'assistant_knowledge_availability') return { data: { enabled: fixture.eligible, knowledge_epoch: 1 }, error: null };
      fixture.eligible = false;
      return { data: { tables: [], interpretation: [], limitations: [] }, error: null };
    });
    expect((await assistantQuery(request(true))).status).toBe(503);
  });
  it('fails closed on infrastructure errors, invalid payloads, and permission changes', async () => {
    for (const data of [null, { enabled: true }, { enabled: true, knowledge_epoch: 1, title: 'restricted' }]) {
      fixture.rpc.mockResolvedValue({ data, error: null }); expect((await assistantStatus(request())).status).toBe(503);
    }
    fixture.rpc.mockImplementation(async () => { fixture.active = false; return { data: { enabled: true, knowledge_epoch: 1 }, error: null }; });
    expect((await assistantStatus(request())).status).toBe(403);
  });
  it('rejects forged and cross-site reads without exposing metadata', async () => {
    const forged = request(); forged.headers.set('authorization', 'Bearer da_admin_v1.forged');
    expect((await assistantStatus(forged)).status).toBe(401);
    const cross = request(); cross.headers.set('sec-fetch-site', 'cross-site');
    expect((await assistantStatus(cross)).status).toBe(403);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('validates the minimal response strictly', () => {
    expect(assistantAvailabilitySchema.safeParse({ enabled: true, identity: { id: actor, role: 'ADMIN' }, knowledge_epoch: -1 }).success).toBe(false);
  });
});
