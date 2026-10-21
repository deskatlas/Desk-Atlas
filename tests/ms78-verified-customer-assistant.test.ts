// MS78-TC01..18 / QAD-TC38/44/46. Boundary and regression evidence, no activation claim.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CustomerMemoryRepository, CustomerService, RateLimiterService,
  CustomerAssistanceService, projectCustomerBooking, validateCustomerFactClaims,
  CustomerAssistanceSupabaseRepository, type CustomerAssistanceRepository } from '@deskatlas/domain';
import { customerVerifyIdentitySchema, customerAssistanceReservationsSchema, type PublicCustomerResponse,
  customerAssistanceSnapshotSchema, type CustomerAssistanceSnapshot } from '@deskatlas/validation';
import { authorizeVerifiedCustomer, prepareVerifiedAnswer, VerifiedCustomerError } from '../apps/customer-website/src/server/customer-assistant/verified';
import { getSharedMemoryRepos } from '../apps/customer-website/src/app/api/customer/_services';
import { customerBookingActionDestination } from '../apps/customer-website/src/features/assistant/VerifiedReservationControls';
import { POST as verifyIdentity } from '../apps/customer-website/src/app/api/customer/verify-identity/route';
import { buildVerifiedResponse } from '../apps/customer-website/src/server/customer-assistant/verifiedResponse';

const NOW = new Date('2026-10-21T00:00:00Z');
function snapshot(patch: Partial<CustomerAssistanceSnapshot> = {}): CustomerAssistanceSnapshot {
  return { id: randomUUID(), reference: 'SAFE-REF', status: 'CONFIRMED', channel: 'WEB',
    start_at: '2026-10-22T00:00:00Z', end_at: '2026-10-22T02:00:00Z', workspace: 'Desk 1',
    assigned: true, checked_in_at: null, checked_out_at: null, payment_status: 'APPROVED',
    reschedule_count: 0, closure_pending: false, timezone: 'Asia/Manila',
    reschedule_cutoff_hours: 24, cancellation_cutoff_value: 1, cancellation_cutoff_unit: 'DAYS', ...patch };
}
async function identity(repo = new CustomerMemoryRepository(() => NOW)) {
  const customer = await repo.createCustomer({ customerCode: 'ABC234', email: `${randomUUID()}@example.test`,
    firstName: 'Test', lastName: 'Guest', firstConfirmedReservationId: randomUUID() });
  return { repo, customer, service: new CustomerService(repo, undefined, () => NOW) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('MS78 verified customer assistance', () => {
  it('TC01: the existing identity route normalizes the same fields and explicitly returns combined purpose', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ''); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''); vi.stubEnv('SUPABASE_URL', '');
    const repo = getSharedMemoryRepos().customerRepo;
    const email = `${randomUUID()}@example.test`;
    await repo.createCustomer({ customerCode: 'ABC237', email, firstName: 'Test', lastName: 'Guest', firstConfirmedReservationId: randomUUID() });
    const response = await verifyIdentity(new Request('http://localhost/api/customer/verify-identity', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.237' },
      body: JSON.stringify({ customer_code: 'abc237', email: ` ${email.toUpperCase()} `, access_intent: 'REWARDS_AND_ASSISTANT' }),
    }) as Parameters<typeof verifyIdentity>[0]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.purpose).toBe('REWARDS_AND_ASSISTANT_ACCESS');
    expect(await new CustomerService(repo).verifyAccessToken(body.data.access_token, undefined, 'REWARDS_AND_ASSISTANT_ACCESS')).toMatchObject({ email });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('TC01/02: strict intent preserves legacy verification and issues hashed combined-purpose tokens', async () => {
    const { repo, customer, service } = await identity();
    const legacy = await service.createAccessChallenge(customer.customerCode, customer.email);
    const combined = await service.createAccessChallenge(customer.customerCode.toLowerCase(), customer.email.toUpperCase(), 'REWARDS_AND_ASSISTANT_ACCESS');
    expect(combined.accessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(combined.expiresAt) - NOW.getTime()).toBe(900000);
    expect(await repo.findAccessChallengeByHash(combined.accessToken)).toBeNull();
    expect(await service.verifyAccessToken(legacy.accessToken, NOW, 'REWARDS_AND_ASSISTANT_ACCESS')).toBeNull();
    expect(await service.verifyAccessToken(combined.accessToken, NOW)).toMatchObject({ id: customer.id });
    expect(await service.verifyAccessToken(combined.accessToken, NOW, 'REWARDS_AND_ASSISTANT_ACCESS')).toMatchObject({ id: customer.id });
    expect(customerVerifyIdentitySchema.parse({ customer_code: 'ABC234', email: customer.email }).access_intent).toBe('REWARDS');
    expect(customerVerifyIdentitySchema.safeParse({ customer_code: 'ABC234', email: customer.email, access_intent: 'ADMIN' }).success).toBe(false);
    expect(await service.createAccessChallenge(customer.customerCode, 'different@example.test', 'REWARDS_AND_ASSISTANT_ACCESS')).toBeNull();
  });
  it('TC03: exact expiry and revocation deny combined access', async () => {
    const { customer, service } = await identity();
    const combined = await service.createAccessChallenge(customer.customerCode, customer.email, 'REWARDS_AND_ASSISTANT_ACCESS');
    expect(await service.verifyAccessToken(combined.accessToken, new Date(combined.expiresAt), 'REWARDS_AND_ASSISTANT_ACCESS')).toBeNull();
    await service.revokeAccessToken(combined.accessToken);
    expect(await service.verifyAccessToken(combined.accessToken, NOW, 'REWARDS_AND_ASSISTANT_ACCESS')).toBeNull();
  });
  it('TC03/16: route authority distinguishes rewards purpose and rejects staff/missing credentials; final auth revocation is checked', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ''); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''); vi.stubEnv('SUPABASE_URL', '');
    const repo = getSharedMemoryRepos().customerRepo;
    const customer = await repo.createCustomer({ customerCode: 'ABC235', email: `${randomUUID()}@example.test`, firstName: 'Test', lastName: 'Guest', firstConfirmedReservationId: randomUUID() });
    const service = new CustomerService(repo);
    const request = (token?: string) => new Request('http://localhost/api/customer-assistant/query', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    await expect(authorizeVerifiedCustomer(request())).rejects.toMatchObject({ status: 401 });
    await expect(authorizeVerifiedCustomer(request('staff-token'))).rejects.toMatchObject({ status: 401 });
    const legacy = await service.createAccessChallenge(customer.customerCode, customer.email);
    await expect(authorizeVerifiedCustomer(request(legacy.accessToken))).rejects.toMatchObject({ status: 403 });
    const combined = await service.createAccessChallenge(customer.customerCode, customer.email, 'REWARDS_AND_ASSISTANT_ACCESS');
    const auth = await authorizeVerifiedCustomer(request(combined.accessToken), true);
    await service.revokeAccessToken(combined.accessToken);
    await expect(auth.reauthorize()).rejects.toBeInstanceOf(VerifiedCustomerError);
  });
  it('TC05/07: foreign/missing ids share unavailable response; truncated pages never auto-select', async () => {
    const read = vi.fn(async () => null);
    const repo: CustomerAssistanceRepository = { list: async () => ({ items: [{ id: randomUUID(), reference: 'A', status: 'CONFIRMED', start_at: null, end_at: null, workspace: null }], next_cursor: 'more' }), read };
    const service = new CustomerAssistanceService(repo, () => NOW);
    expect((await service.resolve('customer')).kind).toBe('CLARIFY');
    expect(read).not.toHaveBeenCalled();
    expect(await service.resolve('customer', randomUUID())).toEqual(await service.resolve('customer', randomUUID()));
    expect(read).toHaveBeenCalledTimes(2);
    expect(await service.resolve('customer', 'malformed')).toEqual({ kind: 'RESERVATION_UNAVAILABLE' });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('TC08: safe projection excludes arbitrary secrets and all identity correlation from model facts', () => {
    const raw = { ...snapshot(), email: 'secret@example.test', payment_link: 'secret', notes: 'secret' };
    const context = projectCustomerBooking(raw, NOW);
    const facts = JSON.stringify(context.facts);
    expect(facts).not.toMatch(/secret|SAFE-REF|reservationId|customerId/);
    expect(customerAssistanceSnapshotSchema.safeParse(raw).success).toBe(false);
    expect(context.actions).toContain('REVIEW_CANCELLATION');
  });
  it('TC09/10: exact cutoff permits review; one millisecond later denies; missing rules stay UNKNOWN', () => {
    const booking = snapshot();
    expect(projectCustomerBooking(booking, NOW).facts).toMatchObject({ cancel: true, reschedule: true });
    expect(projectCustomerBooking(booking, new Date(NOW.getTime() + 1)).facts).toMatchObject({ cancel: false, reschedule: false });
    expect(projectCustomerBooking({ ...booking, cancellation_cutoff_value: null, reschedule_cutoff_hours: null }, NOW).facts).toMatchObject({ cancel: 'UNKNOWN', reschedule: 'UNKNOWN' });
    expect(projectCustomerBooking({ ...booking, status: 'INVENTED' }, NOW).facts.status).toBe('UNKNOWN');
    expect(projectCustomerBooking({ ...booking, assigned: false }, NOW).facts).toMatchObject({ cancel: 'UNKNOWN', reschedule: 'UNKNOWN', relocation: 'UNKNOWN', workspace: null });
    expect(projectCustomerBooking({ ...booking, status: 'CANCELLED', closure_pending: true }, NOW).actions).toEqual(['VIEW_RESERVATION']);
  });
  it('TC11/13/15: enum unknowns and unsupported features stay limited; exact typed claims cannot override permissions', () => {
    const context = projectCustomerBooking(snapshot({ status: 'CANCELLED', payment_status: null }), NOW);
    expect(context.facts.payment_status).toBe('UNKNOWN');
    expect(context.limitations.join(' ')).toContain('Refund progress');
    expect(validateCustomerFactClaims([{ handle: 'cancel', value: true }], context.facts)).toBe(false);
    expect(validateCustomerFactClaims([{ handle: 'status', value: 'CANCELLED' }], context.facts)).toBe(true);
    expect(validateCustomerFactClaims([{ handle: 'constructor', value: 'x' }], context.facts)).toBe(false);
  });
  it('TC12: booking changes invalidate existing actions before release', async () => {
    const original = snapshot();
    let current = original;
    const service = new CustomerAssistanceService({ list: async () => ({ items: [], next_cursor: null }), read: async () => current }, () => NOW);
    const context = await service.current('customer', original.id);
    current = { ...original, status: 'CANCELLED' };
    const result = await service.revalidate('customer', context);
    expect(result.kind).toBe('CHANGED');
    if (result.kind === 'CHANGED') expect(result.context.actions).not.toContain('REVIEW_CANCELLATION');
  });
  it('TC12: gateway refreshes once and returns no stale actions after another change', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const original = snapshot({ start_at: '2099-01-01T00:00:00Z', end_at: '2099-01-01T01:00:00Z' });
    const read = vi.spyOn(CustomerAssistanceSupabaseRepository.prototype, 'read');
    read.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, status: 'CANCELLED' })
      .mockResolvedValueOnce({ ...original, status: 'COMPLETED' });
    const compose = vi.fn(async () => undefined); const reauthorize = vi.fn(async () => undefined);
    expect(await prepareVerifiedAnswer({ customerId: 'customer', reauthorize }, original.id, 'HISTORY', compose)).toEqual({ kind: 'BOOKING_CHANGED' });
    expect(compose).toHaveBeenCalledTimes(2); expect(reauthorize).toHaveBeenCalledTimes(2);
  });
  it('TC12: a stable refresh uses the new state and final authority, never previous actions', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const original = snapshot({ start_at: '2099-01-01T00:00:00Z', end_at: '2099-01-01T01:00:00Z' });
    const changed = { ...original, status: 'CANCELLED' };
    vi.spyOn(CustomerAssistanceSupabaseRepository.prototype, 'read').mockResolvedValueOnce(original).mockResolvedValueOnce(changed).mockResolvedValueOnce(changed);
    const reauthorize = vi.fn(async () => undefined);
    const result = await prepareVerifiedAnswer({ customerId: 'customer', reauthorize }, original.id);
    expect(result.kind).toBe('CONTEXT');
    if (result.kind === 'CONTEXT') expect(result.context.actions).not.toContain('REVIEW_CANCELLATION');
    expect(reauthorize).toHaveBeenCalledTimes(2);
  });
  it('TC14: only allowlisted actions navigate into the existing credential-free URL workflow', () => {
    expect(customerBookingActionDestination('REVIEW_CANCELLATION', 'REF')).toBe('/track/REF');
    expect(customerBookingActionDestination('https://evil.test', 'REF')).toBeNull();
    expect(customerBookingActionDestination('VIEW_RESERVATION', 'a/b?email=bad')).toBe('/track/a%2Fb%3Femail%3Dbad');
    expect(customerAssistanceReservationsSchema.safeParse({ customer_email: 'foreign@example.test' }).success).toBe(false);
  });
  it('TC10/13: response wrapper discards policy prose that could override exact booking facts', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const cancelled = snapshot({ status: 'CANCELLED' });
    vi.spyOn(CustomerAssistanceSupabaseRepository.prototype, 'read').mockResolvedValue(cancelled);
    const base: PublicCustomerResponse = { version: 'ms77-v1', kind: 'ANSWER', summary: 'You can reschedule unconditionally.',
      citations: [], suggestions: [], actions: [{ id: 'VERIFY_CUSTOMER' }], as_of: NOW.toISOString(), knowledge_epoch: 1, request_id: randomUUID(), limitations: [] };
    const response = await buildVerifiedResponse({ customerId: 'customer', reauthorize: async () => undefined }, { selected_reservation_id: cancelled.id }, base);
    expect(response.summary).not.toContain('unconditionally');
    expect(response.booking_context.facts.cancel).toBe(false);
    expect(response.booking_context.actions).toEqual(['VIEW_RESERVATION']);
    expect(response.actions).toEqual([]);
  });
  it('TC13: temporary policy composition failure falls back to current facts without granting permissions', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const cancelled = snapshot({ status: 'CANCELLED' });
    vi.spyOn(CustomerAssistanceSupabaseRepository.prototype, 'read').mockResolvedValue(cancelled);
    const base: PublicCustomerResponse = { version: 'ms77-v1', kind: 'ANSWER', summary: '', citations: [], suggestions: [], actions: [],
      as_of: NOW.toISOString(), knowledge_epoch: 1, request_id: randomUUID(), limitations: [] };
    const auth = { customerId: 'customer', reauthorize: vi.fn(async () => undefined) };
    const response = await buildVerifiedResponse(auth, { selected_reservation_id: cancelled.id }, base, undefined, async () => { throw new Error('Provider unavailable'); });
    expect(response.booking_context.actions).toEqual(['VIEW_RESERVATION']);
    expect(response.policy_excerpts).toEqual([]);
    expect(response.limitations.join(' ')).toContain('temporarily unavailable');
    await expect(buildVerifiedResponse(auth, { selected_reservation_id: cancelled.id }, base, undefined, async () => { throw new Error('KNOWLEDGE_CHANGED'); })).rejects.toThrow('KNOWLEDGE_CHANGED');
  });
  it('TC17: concurrent callers share atomic token quotas; successful verification cannot reset shared limits', async () => {
    const repo = new CustomerMemoryRepository(() => NOW);
    const a = new RateLimiterService(repo, 'test-secret'); const b = new RateLimiterService(repo, 'test-secret');
    const results = await Promise.all(Array.from({ length: 15 }, (_, index) => (index % 2 ? a : b).consumeTogether([
      { scope: 'CUSTOMER_TOKEN', subject: 'opaque-token' }, { scope: 'ASSISTANT_TOKEN', subject: 'opaque-token' },
    ])));
    expect(results.filter(r => r.allowed)).toHaveLength(10);
    expect(a.hashSubject('email@example.test')).not.toContain('@');
    const attempts = await Promise.all(Array.from({ length: 8 }, () => a.consumeTogether([
      { scope: 'VERIFY_IP', subject: '192.0.2.1' }, { scope: 'VERIFY_EMAIL', subject: 'email@example.test' },
    ])));
    expect(attempts.filter(r => r.allowed)).toHaveLength(5);
  });
});
