// MS83-TC03/08/12: HTTP boundary authorization, abuse controls and ambiguous outcomes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationSupabaseRepository, DatabaseInterruptionError } from '@deskatlas/domain';
import { POST } from '../apps/customer-website/src/app/api/track/recovery/route';

const limiter = vi.hoisted(() => ({ consumeTogether: vi.fn() }));
vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({ getCustomerServices: () => ({ rateLimiterService: limiter }) }));
const identity = { referenceCode: 'DA-TEST', customerEmail: 'guest@example.invalid' };
function request(body: unknown, origin = 'https://synthetic.invalid') {
  return new Request('https://synthetic.invalid/api/track/recovery', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'x-real-ip': '127.0.0.1' }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic');
  vi.stubEnv('REWARDS_RATE_LIMIT_SECRET', 'synthetic');
  vi.stubEnv('CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER', 'x-real-ip');
  limiter.consumeTogether.mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('MS83 protected recovery route', () => {
  it('rejects missing verification and forged economic fields before database access', async () => {
    const commit = vi.spyOn(ReservationSupabaseRepository.prototype, 'commitPaidRecovery');
    expect((await POST(request({ referenceCode: 'DA-TEST' }))).status).toBe(400);
    expect((await POST(request({ ...identity, episodeId: '00000000-0000-4000-8000-000000000001', remedy: 'REFUND', amountDue: 0 }))).status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
    expect(limiter.consumeTogether).not.toHaveBeenCalled();
  });
  it('rejects cross-origin requests and shared rate exhaustion', async () => {
    expect((await POST(request(identity, 'https://other.invalid'))).status).toBe(403);
    limiter.consumeTogether.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await POST(request(identity));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });
  it('requires the configured shared verification secret', async () => {
    vi.stubEnv('REWARDS_RATE_LIMIT_SECRET', '');
    expect((await POST(request(identity))).status).toBe(409);
    expect(limiter.consumeTogether).not.toHaveBeenCalled();
  });
  it('does not disclose a mismatched reservation or private database errors', async () => {
    vi.spyOn(ReservationSupabaseRepository.prototype, 'readPaidRecovery').mockResolvedValue(null);
    const response = await POST(request(identity));
    expect(await response.json()).toEqual({ context: null });
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });
  it('reports an unknown mutation outcome without replaying the command', async () => {
    const commit = vi.spyOn(ReservationSupabaseRepository.prototype, 'commitPaidRecovery').mockRejectedValue(new DatabaseInterruptionError('deadline', true));
    const response = await POST(request({ ...identity, episodeId: '00000000-0000-4000-8000-000000000001', remedy: 'REFUND' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ outcomeUnknown: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
