import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueAdminSession, ADMIN_SESSION_DURATION_MS } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

// MS47-TC02/03, QAD-TC23/45: real heartbeat and Knowledge Base boundary.
const fixture = vi.hoisted(() => ({
  profile: { role: 'ADMIN', is_active: true } as { role: string; is_active: boolean } | null,
  profileError: null as null | { message: string },
  getUser: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: fixture.getUser },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixture.profile, error: fixture.profileError }) }) }) }),
}) }));
vi.mock('../apps/admin-portal/src/app/api/admin/staff/_lib/staffService', () => ({
  getStaffManagementService: () => ({ getStaffById: async () => ({ id: 'admin', role: 'ADMIN', isActive: true, email: 'admin@example.test' }) }),
}));
import { GET } from '../apps/admin-portal/src/app/api/admin/auth/session/route';
import { authorizeKnowledge, checkDatabase, knowledgeFailure } from '../apps/admin-portal/src/app/api/admin/knowledge/_lib/server';
import { AdminSessionLifecycle, STORAGE_KEY } from '../apps/admin-portal/src/features/auth/sessionLifecycle';
import { createHmac } from 'node:crypto';

const secret = 'synthetic-ms47-signing-key';
const now = 1800000000000;
function request(token?: string) {
  return new Request('http://localhost:3000/api/admin/auth/session', { headers: {
    'x-user-id': 'admin', 'x-user-role': 'ADMIN', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } });
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('KB_SCOPE_ID', 'test');
  fixture.profile = { role: 'ADMIN', is_active: true }; fixture.profileError = null;
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('MS-47 session consistency', () => {
  it('cannot keep an active account authenticated after its signed credential expires', async () => {
    const expired = issueAdminSession('admin', secret, now - ADMIN_SESSION_DURATION_MS);
    await expect(authorizeKnowledge(request(expired))).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect((await GET(request(expired))).status).toBe(401);
  });
  it.each([-1, 0, 1])('enforces signed expiry boundary at offset %s', async offset => {
    const token = issueAdminSession('admin', secret, now - ADMIN_SESSION_DURATION_MS - offset);
    const response = await GET(request(token));
    expect(response.status).toBe(offset < 0 ? 200 : 401);
    if (offset < 0) {
      expect(await response.json()).toMatchObject({ active: true, user: { id: 'admin', role: 'admin' }, expiresAt: now + 1 });
      expect((await authorizeKnowledge(request(token))).actor).toBe('admin');
    }
  });
  it.each([undefined, 'da_admin_v1.forged', 'da_staff_v1.forged', 'da_admin_v1.bad.claims.extra'])('never trusts supplied identity for %s', async token => {
    expect((await GET(request(token))).status).toBe(401);
    await expect(authorizeKnowledge(request(token))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(fixture.getUser).not.toHaveBeenCalled();
  });
  it('rejects signature tampering without provider fallback', async () => {
    const token = issueAdminSession('admin', secret);
    expect((await GET(request(`${token.slice(0, -5)}aaaaa`))).status).toBe(401);
    expect(fixture.getUser).not.toHaveBeenCalled();
  });
  it.each([{ sub: 'admin', iat: now, exp: now + 1 }, { sub: '', iat: now, exp: now + ADMIN_SESSION_DURATION_MS }, { sub: 'admin', iat: 'invalid', exp: now + ADMIN_SESSION_DURATION_MS }])('rejects signed malformed claims', async claims => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const prefix = `da_admin_v1.${payload}`;
    const signature = createHmac('sha256', secret).update(prefix).digest('base64url');
    expect((await GET(request(`${prefix}.${signature}`))).status).toBe(401);
    expect(fixture.getUser).not.toHaveBeenCalled();
  });
  it('accepts only the trusted Supabase verdict and separates provider outages', async () => {
    fixture.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: null });
    expect((await GET(request('provider-token'))).status).toBe(200);
    expect((await authorizeKnowledge(request('provider-token'))).actor).toBe('admin');
    fixture.getUser.mockResolvedValue({ data: { user: { id: 'admin' } }, error: { status: 401 } });
    expect((await GET(request('provider-token'))).status).toBe(401);
    fixture.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, message: 'private provider detail' } });
    const outage = await GET(request('provider-token'));
    expect(outage.status).toBe(503); expect(await outage.json()).toMatchObject({ deactivated: false, error: { code: 'AUTH_UNAVAILABLE' } });
    fixture.getUser.mockRejectedValue(new Error('private timeout'));
    await expect(authorizeKnowledge(request('provider-token'))).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
  });
  it('checks fresh role and activity and fails closed on profile errors', async () => {
    const token = issueAdminSession('admin', secret);
    fixture.profile = { role: 'STAFF', is_active: true };
    expect((await GET(request(token))).status).toBe(403);
    await expect(authorizeKnowledge(request(token))).rejects.toMatchObject({ code: 'ACCESS_REVOKED' });
    fixture.profile = { role: 'ADMIN', is_active: false };
    expect(await (await GET(request(token))).json()).toMatchObject({ deactivated: true, error: { code: 'ACCOUNT_INACTIVE' } });
    fixture.profile = null;
    expect(await (await GET(request(token))).json()).toMatchObject({ deactivated: false, error: { code: 'ACCESS_REVOKED' } });
    fixture.profileError = { message: 'private profile detail' };
    const response = await GET(request(token));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private profile detail');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('keeps origin and RPC denials distinct from session failure', async () => {
    const token = issueAdminSession('admin', secret);
    const cross = new Request('http://localhost:3000/api/admin/knowledge/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://other.invalid' } });
    await expect(authorizeKnowledge(cross)).rejects.toMatchObject({ code: 'ORIGIN_DENIED', status: 403 });
    try { checkDatabase({ message: 'FORBIDDEN' }); } catch (error) {
      const response = knowledgeFailure(error);
      expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
  });
});

describe('MS47-TC03/08/09/10/12 client lifecycle integration', () => {
  function client(transport: typeof fetch = async (_input, init) => GET(new Request('http://localhost/api/admin/auth/session', init))) {
    const stored = new Map<string, string>();
    const persist = vi.fn((user: unknown) => { if (user) stored.set(STORAGE_KEY, JSON.stringify(user)); else stored.delete(STORAGE_KEY); });
    const lifecycle = new AdminSessionLifecycle(transport, persist);
    return { lifecycle, stored, persist };
  }
  const candidate = (token = issueAdminSession('admin', secret)) => JSON.stringify({ id: 'forged-local-id', role: 'admin', token });
  it('never displays restored local identity before verification and recovers after expiry', async () => {
    const { lifecycle, stored } = client();
    const restored = lifecycle.restore(candidate());
    expect(lifecycle.snapshot()).toMatchObject({ loading: true, user: null });
    await restored;
    expect(lifecycle.snapshot()).toMatchObject({ loading: false, user: { id: 'admin' } });
    await lifecycle.restore(candidate(issueAdminSession('admin', secret, now - ADMIN_SESSION_DURATION_MS)));
    expect(lifecycle.snapshot()).toMatchObject({ user: null, loading: false, isDeactivated: false, error: 'Your session ended. Sign in again.' });
    expect(stored.size).toBe(0);
    await lifecycle.restore(candidate());
    expect(lifecycle.snapshot()).toMatchObject({ user: { id: 'admin' }, error: '' });
    expect((await authorizeKnowledge(request(lifecycle.snapshot().user?.token))).actor).toBe('admin');
  });
  it('reauthenticates legacy storage lacking a credential without issuing a request', async () => {
    const transport = vi.fn(); const { lifecycle } = client(transport);
    await lifecycle.restore(JSON.stringify({ id: 'admin', role: 'admin' }));
    expect(lifecycle.snapshot()).toMatchObject({ user: null, loading: false });
    expect(transport).not.toHaveBeenCalled();
  });
  it('deduplicates verification, ignores late results after logout or cross-tab identity changes', async () => {
    let resolve!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    const { lifecycle } = client(transport);
    const pending = lifecycle.restore(candidate());
    const check = lifecycle.check();
    expect(transport).toHaveBeenCalledTimes(1);
    lifecycle.logout();
    resolve(Response.json({ active: true, user: { id: 'admin', role: 'admin' } }));
    await Promise.all([pending, check]);
    expect(lifecycle.snapshot().user).toBeNull();
    const next = lifecycle.restore(candidate());
    await lifecycle.restore(null);
    resolve(Response.json({ active: true, user: { id: 'admin', role: 'admin' } }));
    await next; expect(lifecycle.snapshot().user).toBeNull();
  });
  it('handles concurrent auth failures once and never replays protected writes', async () => {
    const { lifecycle, persist } = client(); await lifecycle.restore(candidate());
    const generation = lifecycle.snapshot().generation;
    persist.mockClear();
    lifecycle.reject(generation, 'AUTH_REQUIRED'); lifecycle.reject(generation, 'AUTH_REQUIRED');
    expect(persist).toHaveBeenCalledTimes(1);
    await lifecycle.restore(candidate());
    lifecycle.reject(generation, 'AUTH_REQUIRED');
    expect(lifecycle.snapshot().user).not.toBeNull();
    const current = lifecycle.snapshot().generation;
    lifecycle.reject(current, 'FORBIDDEN'); lifecycle.reject(current, 'ORIGIN_DENIED');
    expect(lifecycle.snapshot().user).not.toBeNull();
  });
  it('suspends protected access during outages, preserves the candidate and retries without deactivation', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ error: { code: 'AUTH_UNAVAILABLE' } }, { status: 503 }));
    const { lifecycle, persist } = client(transport);
    await lifecycle.restore(candidate());
    expect(lifecycle.snapshot()).toMatchObject({ user: null, loading: true, retryable: true, isDeactivated: false });
    expect(persist).not.toHaveBeenCalled();
    transport.mockImplementation(async (_input, init) => GET(new Request('http://localhost/api/admin/auth/session', init)));
    await lifecycle.check();
    expect(lifecycle.snapshot()).toMatchObject({ user: { id: 'admin' }, error: '', retryable: false });
  });
  it('can retry synchronous transport failures and invalidates the old generation during outages', async () => {
    const transport = vi.fn(() => { throw new Error('synthetic transport outage'); });
    const { lifecycle } = client(transport);
    await lifecycle.restore(candidate());
    const generation = lifecycle.snapshot().generation;
    await lifecycle.check();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(lifecycle.snapshot().generation).toBeGreaterThan(generation);
  });
});
