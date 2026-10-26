// MS83-TC02/03/08/12, PRD-F6/F13/F14. Database races live in ms83-postgres-recovery.py.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paidRecoveryCommandSchema, paidRecoveryReadSchema } from '@deskatlas/validation';
import {
  PaidRecoveryService, ReservationSupabaseRepository, renderManualResolutionEmail,
  CustomerMemoryRepository, CustomerService, TransactionalEmailService,
  createBookingAccessService, type BookingAccessRecord,
  buildReservationTrackingUrl,
} from '@deskatlas/domain';

const identity = { referenceCode: 'DA-TEST', customerEmail: 'guest@example.invalid' };
const episodeId = '00000000-0000-4000-8000-000000000001';
const workspaceInstanceId = '00000000-0000-4000-8000-000000000002';

afterEach(() => vi.unstubAllEnvs());
describe('MS83 paid recovery', () => {
  it('prefills tracking reference and the registered email with safe query encoding', () => {
    const email = ' Guest+Recovery@example.invalid ';
    const link = buildReservationTrackingUrl('https://synthetic.invalid', ' da-test ', email);
    const url = new URL(link);
    expect(url.searchParams.get('code')).toBe('DA-TEST');
    expect(url.searchParams.get('email')).toBe('guest+recovery@example.invalid');
    expect(link).toContain('guest%2Brecovery%40example.invalid');
    expect(buildReservationTrackingUrl('https://synthetic.invalid', 'da-test')).toBe('https://synthetic.invalid/track?code=DA-TEST');
  });
  it('expires the opaque booking pass at the exact committed end boundary', async () => {
    const record: BookingAccessRecord = { reservationId: episodeId, referenceCode: 'DA-TEST', reservationStatus: 'CONFIRMED',
      customerFirstName: 'Synthetic', customerLastName: 'Guest', bookingTokenHash: 'synthetic', qrIssuedAt: '2026-10-26T00:00:00Z',
      qrRevokedAt: null, checkedInAt: null, checkedOutAt: null, assignedWorkspaceInstanceId: workspaceInstanceId,
      assignedWorkspaceDisplayName: 'Desk', assignedWorkspaceInstanceCode: 'D1', assignedWorkspaceTemplateName: 'Desk', assignedFloorName: 'Floor',
      assignedStartAt: '2026-11-01T01:00:00Z', assignedEndAt: '2026-11-01T03:00:00Z' };
    const service = createBookingAccessService({ issueBookingAccessToken: async () => true, findBookingAccessByTokenHash: async () => record,
      recordBookingScan: async () => {} }, () => new Date(record.assignedEndAt));
    expect((await service.getBookingAccess('opaque-token')).accessState).toBe('EXPIRED');
  });
  it('requires verification and rejects client template, price, duration and state overrides', () => {
    expect(paidRecoveryReadSchema.safeParse({ referenceCode: 'DA-TEST' }).success).toBe(false);
    const command = { ...identity, episodeId, remedy: 'REPOSITION', workspaceInstanceId };
    expect(paidRecoveryCommandSchema.safeParse(command).success).toBe(true);
    for (const field of ['templateId', 'durationMinutes', 'amountDue', 'status', 'endAt']) {
      expect(paidRecoveryCommandSchema.safeParse({ ...command, [field]: 'forged' }).success).toBe(false);
    }
    expect(paidRecoveryCommandSchema.safeParse({ ...identity, episodeId, remedy: 'REFUND', workspaceInstanceId }).success).toBe(false);
    expect(paidRecoveryCommandSchema.safeParse({ ...command, remedy: 'RESCHEDULE', startAt: 'invalid' }).success).toBe(false);
  });

  it('normalizes verified identity and sends one atomic command without REST fallback', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(String(options?.body)) as unknown });
      return Response.json({ status: 'CONFIRMED' });
    };
    const service = new PaidRecoveryService(new ReservationSupabaseRepository({ supabaseUrl: 'https://synthetic.invalid', serviceRoleKey: 'synthetic', fetcher }));
    await service.commit({ ...identity, customerEmail: ' GUEST@example.invalid ', episodeId, remedy: 'REPOSITION', workspaceInstanceId });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/rpc/recover_paid_reservation');
    expect(calls[0].body).toEqual({ p_reference: 'DA-TEST', p_email: identity.customerEmail, p_episode: episodeId, p_remedy: 'REPOSITION', p_workspace: workspaceInstanceId, p_start: null });
  });

  it('never retries an uncertain recovery mutation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network loss'));
    const service = new PaidRecoveryService(new ReservationSupabaseRepository({ supabaseUrl: 'https://synthetic.invalid', serviceRoleKey: 'synthetic', fetcher }));
    await expect(service.commit({ ...identity, episodeId, remedy: 'REFUND' })).rejects.toMatchObject({ outcomeUnknown: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('renders actionable HTML and text with an escaped tracking CTA, original schedule and no assigned pass', () => {
    const result = renderManualResolutionEmail({ to: identity.customerEmail, referenceCode: 'DA-TEST',
      trackingUrl: 'https://synthetic.invalid/track?code=DA-TEST', workspaceName: '<Desk>',
      startAt: '2026-11-01T01:00:00Z', endAt: '2026-11-01T03:00:00Z' });
    for (const content of [result.html, result.text]) {
      for (const word of ['Choose a new desk or time', 'request a refund', 'payment has been received', 'DA-TEST']) expect(content).toContain(word);
      expect(content).not.toContain('/api/booking/');
    }
    expect(result.html).toContain('&lt;Desk&gt;');
    expect(result.html).toContain('https://synthetic.invalid/track?code=DA-TEST');
  });

  it('queues one logical notice, retries failed delivery and keeps its provider identity', async () => {
    vi.stubEnv('TRACKING_BASE_URL', 'https://synthetic.invalid');
    vi.stubEnv('RESEND_API_KEY', 'synthetic');
    let now = new Date('2026-10-26T00:00:00Z');
    const repo = new CustomerMemoryRepository(() => now);
    const job = { kind: 'PAID_CANDIDATE_EXHAUSTED' as const, dedupeKey: `paid-candidate-exhausted:${episodeId}`,
      reservationId: episodeId, recipientEmail: identity.customerEmail, payload: { referenceCode: identity.referenceCode } };
    const first = await repo.enqueueOutboxJob(job);
    expect((await repo.enqueueOutboxJob(job)).id).toBe(first.id);
    const keys: Array<string | null> = [];
    const messages: Array<{ html: string; text: string }> = [];
    const sender = new TransactionalEmailService({ apiKey: 'synthetic', settingsProvider: async () => ({ businessName: 'Synthetic' }),
      fetcher: async (_url, options) => { messages.push(JSON.parse(String(options?.body)) as { html: string; text: string }); keys.push(new Headers(options?.headers).get('Idempotency-Key')); return keys.length === 1 ? new Response('unavailable', { status: 503 }) : Response.json({ id: 'synthetic-message' }); } });
    const service = new CustomerService(repo, sender, () => now);
    expect((await service.processOutboxBatch()).retried).toBe(1);
    expect((await repo.getOutboxJobById(first.id))?.status).toBe('RETRY');
    now = new Date(now.getTime() + 61 * 60 * 1000);
    expect((await service.processOutboxBatch()).sent).toBe(1);
    expect(keys).toEqual([job.dedupeKey, job.dedupeKey]);
    expect(messages[1].html).toContain('code=DA-TEST&amp;email=guest%40example.invalid');
    expect(messages[1].text).toContain('code=DA-TEST&email=guest%40example.invalid');
    expect((await service.processOutboxBatch()).claimed).toBe(0);
  });

  it('treats rejected webhook delivery as retryable failure', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const sender = new TransactionalEmailService({ apiKey: '', webhookUrl: 'https://synthetic.invalid/email',
      settingsProvider: async () => ({ businessName: 'Synthetic' }), fetcher: async () => new Response('unavailable', { status: 503 }) });
    expect((await sender.sendManualResolutionEmail({ to: identity.customerEmail, referenceCode: 'DA-TEST', idempotencyKey: 'episode' })).success).toBe(false);
  });
});
