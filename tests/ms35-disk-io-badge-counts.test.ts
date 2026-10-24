import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../apps/admin-portal/src/app/api/admin/badge-counts/route';
import { AdminAccessError } from '../apps/admin-portal/src/app/api/admin/auth/_lib/verifiedAdmin';

const fixture = vi.hoisted(() => ({ verify: vi.fn(), rpc: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/auth/_lib/verifiedAdmin', () => ({
  verifyAdministrator: fixture.verify,
  AdminAccessError: class extends Error {
    constructor(public code: string, public status: number) { super(code); }
  },
}));
const counts = { reservationsCount: 503, paymentsCount: 3, kioskCount: 2,
  awaitingProof: 503, paymentReviews: 3, counterQueue: 2, awaitingReviewCount: 1, overdueCount: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  fixture.verify.mockResolvedValue({ actor: 'admin-fixture', client: { rpc: fixture.rpc } });
  fixture.rpc.mockResolvedValue({ data: counts, error: null });
});
it('QAD-TC35: returns one authenticated aggregate without loading queues', async () => {
  const request = new Request('http://localhost/api/admin/badge-counts');
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(fixture.verify).toHaveBeenCalledWith(request);
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('admin_badge_counts', { p_actor: 'admin-fixture' });
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('rejects unauthenticated callers before the aggregate', async () => {
  fixture.verify.mockRejectedValue(new AdminAccessError('AUTH_REQUIRED', 401));
  expect((await GET(new Request('http://localhost'))).status).toBe(401);
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it.each([{ data: null, error: null }, { data: { ...counts, paymentsCount: -1 }, error: null },
  { data: null, error: { message: 'private database diagnostic' } }])('fails closed without expensive fallback', async result => {
  fixture.rpc.mockResolvedValue(result);
  const response = await GET(new Request('http://localhost'));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database diagnostic');
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});
