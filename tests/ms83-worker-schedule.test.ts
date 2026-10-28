// MS83-R02 / SDD-C11 / QAD-TC10: scheduled queue delivery must reach the worker.
import { readFileSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../apps/admin-portal/src/app/api/internal/rewards/process/route';

const mocks = vi.hoisted(() => ({ outbox: vi.fn(), campaigns: vi.fn() }));
vi.mock('@deskatlas/domain', () => ({
  CustomerSupabaseRepository: class {},
  createCustomerService: () => ({ processOutboxBatch: mocks.outbox }),
  createTransactionalEmailService: () => ({}),
}));
vi.mock('../apps/admin-portal/src/app/api/admin/campaigns/_lib/campaignServiceHelper', () => ({
  getAdminCampaignService: () => ({ runWorkerCycle: mocks.campaigns }),
}));
function request(token?: string) {
  return new Request('https://admin.example.invalid/api/internal/rewards/process', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
  vi.stubEnv('REWARDS_WORKER_SECRET', 'synthetic-worker-secret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  mocks.outbox.mockResolvedValue({ claimed: 1, sent: 1, failed: 0, retried: 0 });
  mocks.campaigns.mockResolvedValue({ processed: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('MS83 Vercel notification scheduling', () => {
  it('registers one minute-level cron in the admin project only', () => {
    const path = 'apps/admin-portal/vercel.json';
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons).toEqual([{ path: '/api/internal/rewards/process', schedule: '* * * * *' }]);
    for (const app of ['customer-website', 'staff-dashboard', 'kiosk']) {
      const appPath = `apps/${app}/vercel.json`;
      const appConfig = existsSync(appPath)
        ? JSON.parse(readFileSync(appPath, 'utf8')) as { crons?: unknown[] } : {};
      expect(appConfig.crons ?? []).toEqual([]);
    }
  });
  it('accepts Vercel CRON_SECRET on GET and actually processes due mail', async () => {
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(200);
    expect(mocks.outbox).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ outbox: { claimed: 1, sent: 1 } });
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });
  it('retains manual worker authentication independently', async () => {
    expect((await POST(request('synthetic-worker-secret'))).status).toBe(200);
    expect(mocks.outbox).toHaveBeenCalledOnce();
  });
  it('rejects missing, incorrect and unconfigured credentials before queue access', async () => {
    for (const token of [undefined, 'wrong', 'synthetic-cron-secret-extra']) expect((await GET(request(token))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', ''); vi.stubEnv('REWARDS_WORKER_SECRET', '');
    expect((await GET(request('synthetic-cron-secret'))).status).toBe(401);
    expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('returns a retryable, sanitized error when database processing fails', async () => {
    mocks.outbox.mockRejectedValue(new Error('private credential or recipient detail'));
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private credential');
  });
});
