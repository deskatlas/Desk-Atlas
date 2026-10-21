// MS78-TC03/05/07/16: actual route behavior with isolated server seams.
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
const seams = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), reauthorize: vi.fn() }));
vi.mock('../apps/customer-website/src/server/customer-assistant/verified', () => ({
  authorizeVerifiedCustomer: seams.auth,
  getCustomerAssistanceService: () => ({ list: seams.list }),
  VerifiedCustomerError: class extends Error {
    constructor(public code: string, public status: number, public retryAfterSeconds?: number) { super(code); }
  },
}));
import { POST } from '../apps/customer-website/src/app/api/customer-assistant/reservations/route';
import { VerifiedCustomerError } from '../apps/customer-website/src/server/customer-assistant/verified';

function request(body = '{}', headers: Record<string, string> = {}) {
  return new Request('https://customer.example.test/api/customer-assistant/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  });
}
beforeEach(() => {
  vi.stubEnv('CUSTOMER_ASSISTANT_VERIFIED_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_ASSISTANT_ALLOWED_ORIGINS', 'https://customer.example.test');
  seams.auth.mockReset().mockResolvedValue({ customerId: 'server-owned', reauthorize: seams.reauthorize });
  seams.reauthorize.mockReset().mockResolvedValue(undefined);
  seams.list.mockReset().mockResolvedValue({ items: [], next_cursor: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('MS78 reservations route', () => {
  it('accepts the configured browser host when Next exposes its local bind address', async () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_ALLOWED_ORIGINS', 'http://localhost:3001');
    const response = await POST(new Request('http://0.0.0.0:3001/api/customer-assistant/reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', host: 'localhost:3001', Origin: 'http://localhost:3001' }, body: '{}',
    }));
    expect(response.status).toBe(200);
    expect(seams.list).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429])('rejects denied authority (%s) before reading bookings', async status => {
    seams.auth.mockRejectedValue(new VerifiedCustomerError(status === 429 ? 'RATE_LIMITED' : 'ACCESS_EXPIRED', status, status === 429 ? 60 : undefined));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    if (status === 429) expect(response.headers.get('Retry-After')).toBe('60');
    expect(seams.list).not.toHaveBeenCalled();
  });
  it('keeps activation disabled by default', async () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_VERIFIED_ENABLED', '');
    expect((await POST(request())).status).toBe(503);
    expect(seams.list).not.toHaveBeenCalled();
  });
  it('reads only the server-resolved customer and reauthorizes before release', async () => {
    const response = await POST(request('{"filter":"HISTORY","cursor":"opaque"}'));
    expect(response.status).toBe(200);
    expect(seams.list).toHaveBeenCalledWith('server-owned', 'HISTORY', 'opaque');
    expect(seams.reauthorize).toHaveBeenCalledOnce();
  });
  it('drops a completed page when credentials expire before release', async () => {
    seams.list.mockResolvedValue({ items: [{ reference: 'private' }], next_cursor: null });
    seams.reauthorize.mockRejectedValue(new VerifiedCustomerError('ACCESS_EXPIRED', 401));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('private');
  });
  it('rejects cross-origin and non-JSON calls before authority or data reads', async () => {
    expect((await POST(request('{}', { Origin: 'https://foreign.example.test' }))).status).toBe(403);
    expect((await POST(request('{}', { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect(seams.auth).not.toHaveBeenCalled();
  });
  it.each(['{', '{"customer_id":"foreign"}', '{"filter":"INTERNAL"}'])('rejects invalid body %s', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(seams.list).not.toHaveBeenCalled();
  });
  it('bounds request bytes before decoding JSON', async () => {
    expect((await POST(request(' '.repeat(32769)))).status).toBe(413);
    expect(seams.list).not.toHaveBeenCalled();
  });
});
