import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudRunIdentity } from '../apps/admin-portal/src/server/assistant/cloudRun';

// SPEC-6 phase 7 / SDD-C20-C21 / QAD-TC44/46: real HTTP exchange boundary.
const endpoint = 'https://deskatlas-rag-chat-staging-example-uc.a.run.app';
const request = () => new Request('https://preview.example/api/assistant/query', {
  headers: { 'x-vercel-oidc-token': 'synthetic.vercel.assertion' },
});
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', network);
  network.mockReset();
  vi.stubEnv('RAG_GOOGLE_AUTH', 'vercel-oidc');
  vi.stubEnv('RAG_SERVICE_URL', endpoint);
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'dev');
  vi.stubEnv('RAG_GOOGLE_WORKLOAD_PROVIDER', 'projects/123/locations/global/workloadIdentityPools/vercel-preview/providers/vercel');
  vi.stubEnv('RAG_GOOGLE_SERVICE_ACCOUNT', 'vercel-rag-preview@example-project.iam.gserviceaccount.com');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Cloud Run Preview identity', () => {
  it('admits only the explicit customer production identity and target', async () => {
    vi.stubEnv('RAG_GOOGLE_AUTH', 'vercel-oidc-customer-production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('RAG_SERVICE_URL', 'https://deskatlas-rag-chat-production-2ttaxxsoaa-uc.a.run.app');
    vi.stubEnv('RAG_GOOGLE_WORKLOAD_PROVIDER', 'projects/252244258272/locations/global/workloadIdentityPools/vercel-customer-production/providers/vercel');
    vi.stubEnv('RAG_GOOGLE_SERVICE_ACCOUNT', 'vercel-rag-customer@deskatlas-rag.iam.gserviceaccount.com');
    network.mockResolvedValueOnce(Response.json({ access_token: 'synthetic-access' }))
      .mockResolvedValueOnce(Response.json({ token: 'synthetic.google.identity' }));
    expect(await createCloudRunIdentity(request(), new AbortController().signal)()).toBe('synthetic.google.identity');
    expect(network).toHaveBeenCalledTimes(2);
    for (const [name, value] of [['VERCEL_ENV', 'preview'], ['RAG_GOOGLE_SERVICE_ACCOUNT', 'vercel-rag-production@deskatlas-rag.iam.gserviceaccount.com'],
      ['RAG_GOOGLE_WORKLOAD_PROVIDER', 'projects/123/locations/global/workloadIdentityPools/other/providers/vercel'], ['RAG_SERVICE_URL', endpoint]]) {
      const previous = process.env[name];
      vi.stubEnv(name, value);
      network.mockClear();
      await expect(createCloudRunIdentity(request(), new AbortController().signal)()).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
      vi.stubEnv(name, previous ?? '');
    }
  });
  it('exchanges the request assertion and mints an ID token for the service origin once per request', async () => {
    network.mockResolvedValueOnce(Response.json({ access_token: 'synthetic-access' }))
      .mockResolvedValueOnce(Response.json({ token: 'synthetic.google.identity' }));
    const identity = createCloudRunIdentity(request(), new AbortController().signal);
    expect(await Promise.all([identity(), identity()])).toEqual(['synthetic.google.identity', 'synthetic.google.identity']);
    expect(network).toHaveBeenCalledTimes(2);
    const [url, init] = network.mock.calls[0];
    expect(url).toBe('https://sts.googleapis.com/v1/token');
    expect(JSON.parse(String(init?.body))).toMatchObject({ subjectToken: 'synthetic.vercel.assertion',
      audience: '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/vercel-preview/providers/vercel' });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    const [mintUrl, mint] = network.mock.calls[1];
    expect(mintUrl).toBe('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/vercel-rag-preview@example-project.iam.gserviceaccount.com:generateIdToken');
    expect(JSON.parse(String(mint?.body))).toEqual({ audience: endpoint, includeEmail: true });
    expect(new Headers(mint?.headers).get('Authorization')).toBe('Bearer synthetic-access');
    expect(init?.redirect).toBe('error');
    expect(mint?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
  });

  it.each([['VERCEL_ENV', 'production'], ['VERCEL_GIT_COMMIT_REF', 'main'],
    ['VERCEL', ''], ['RAG_GOOGLE_AUTH', ''], ['RAG_SERVICE_URL', 'https://external.example'],
    ['RAG_SERVICE_URL', endpoint + '/different'], ['RAG_GOOGLE_SERVICE_ACCOUNT', 'bad/account']])(
    'fails closed for %s=%s without sending credentials', async (name, value) => {
      vi.stubEnv(name, value);
      await expect(createCloudRunIdentity(request(), new AbortController().signal)()).rejects.toThrow('Assistant cloud authentication is unavailable.');
      expect(network).not.toHaveBeenCalled();
    });

  it('does not use a stale environment token if the request assertion is missing', async () => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'synthetic-build-token');
    const absent = new Request('https://preview.example/api/assistant/query');
    await expect(createCloudRunIdentity(absent, new AbortController().signal)()).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });

  it('leaves the existing local transport without Google authentication', async () => {
    vi.stubEnv('RAG_GOOGLE_AUTH', '');
    vi.stubEnv('RAG_SERVICE_URL', 'http://127.0.0.1:8000');
    expect(await createCloudRunIdentity(request(), new AbortController().signal)()).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });

  it('does not expose errors or credentials from a rejected exchange', async () => {
    network.mockResolvedValue(Response.json({ error: 'synthetic-secret-in-provider-body' }, { status: 403 }));
    await expect(createCloudRunIdentity(request(), new AbortController().signal)()).rejects.toThrow('Assistant cloud authentication is unavailable.');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('does not share an identity between requests', async () => {
    network.mockImplementation(async url => Response.json(String(url).includes('sts.googleapis.com')
      ? { access_token: 'synthetic-access' } : { token: 'synthetic.google.identity' }));
    await createCloudRunIdentity(request(), new AbortController().signal)();
    await createCloudRunIdentity(request(), new AbortController().signal)();
    expect(network).toHaveBeenCalledTimes(4);
  });

  it('passes cancellation through the exchange', async () => {
    const controller = new AbortController();
    controller.abort();
    network.mockImplementation(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error('synthetic-sensitive-network-diagnostic');
    });
    await expect(createCloudRunIdentity(request(), controller.signal)()).rejects.toThrow('Assistant cloud authentication is unavailable.');
  });
});
