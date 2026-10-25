// MS-80 / PRD-F9/F10/F12/F14 / QAD-TC20/22/24/35.
import { describe, expect, it } from 'vitest';
import { ReservationSupabaseRepository } from '@deskatlas/domain';

const candidate = { id: 'candidate', reservation_id: 'reservation', rank: 0,
  workspace_instance_id: 'desk', is_assigned: true,
  start_at: '2026-10-25T15:00:00Z', end_at: '2026-10-25T18:00:00Z',
  workspace_instances: { display_name: 'Window desk', instance_code: 'D1', workspace_templates: { name: 'Desk' } } };
const block = { id: 'closure', start_at: '2026-10-25T16:00:00Z', end_at: '2026-10-25T20:00:00Z', reason: 'Repairs' };
const reservation = { id: 'reservation', reference_code: 'REF1', status: 'CONFIRMED', source: 'WEB',
  customer_first_name: 'Test', customer_last_name: 'Guest', customer_email: 'guest@example.invalid',
  updated_at: '2026-10-25T00:00:00Z', created_at: '2026-10-24T00:00:00Z',
  is_closure_impacted: true, closure_exception_id: 'closure', closure_impact_status: 'AFFECTED_PENDING_ACTION',
  amount_due: 100, currency: 'PHP', reservation_candidates: [candidate], candidates: [candidate], attempts: [] };

function fixture(options: { blocks?: object[]; reservations?: object[]; candidates?: object[]; fail?: string; timezone?: string; stale?: boolean } = {}) {
  const calls: Array<{ url: URL; method: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').at(-1) ?? '';
    const method = init?.method ?? 'GET';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, method, body });
    if (method === 'PATCH' && options.stale) return new Response('[]');
    if (options.fail === table) return new Response('{"code":"XX000"}', { status: 503 });
    if (/closure_reason|closure_date|workspace_instances\(name/.test(decodeURIComponent(url.search)) ||
      'closure_reason' in body || 'closure_date' in body) {
      return new Response('{"code":"42703","message":"column does not exist"}', { status: 400 });
    }
    const tables: Record<string, object[]> = {
      reservations: options.reservations ?? [reservation], reservation_candidates: options.candidates ?? [candidate],
      schedule_blocks: options.blocks ?? [block], business_settings: [{ timezone: options.timezone ?? 'Asia/Manila' }],
      workspace_instances: [{ id: 'desk', template_id: 'template', display_name: 'Window desk', instance_code: 'D1' }],
      workspace_templates: [{ id: 'template', name: 'Desk' }],
    };
    return new Response(JSON.stringify(tables[table] ?? []));
  };
  return { calls, repo: new ReservationSupabaseRepository({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture', fetcher }) };
}

describe('MS80 normalized reservation query contracts', () => {
  it('TC02/03: projects overnight closure metadata using venue timezone in bounded reads', async () => {
    const { repo, calls } = fixture();
    expect(await repo.getClosureAlerts()).toMatchObject({ impactedCount: 1, closureReason: 'Repairs', closureDateRange: '2026-10-26' });
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(3);
  });
  it('TC04: uses instance labels and template names without losing schedules', async () => {
    const { repo } = fixture();
    expect(await repo.findCandidatesByReservationId('reservation')).toEqual([{ rank: 0, startAt: candidate.start_at,
      endAt: candidate.end_at, workspaceDisplayName: 'Window desk', workspaceTemplateName: 'Desk' }]);
  });
  it.each(['schedule_blocks', 'reservations', 'business_settings'])('TC03/06: %s failure cannot return zero or clear impact', async fail => {
    const { repo, calls } = fixture({ fail });
    await expect(repo.getClosureAlerts()).rejects.toThrow();
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });
  it('TC04: candidate failures propagate', async () => {
    await expect(fixture({ fail: 'reservation_candidates' }).repo.findCandidatesByReservationId('reservation')).rejects.toThrow();
  });
  it('TC02: missing link uses all current overlapping closures without inventing a reason', async () => {
    const { repo } = fixture({ reservations: [{ ...reservation, closure_exception_id: null }],
      blocks: [{ ...block, reason: null }, { ...block, id: 'second', reason: 'Maintenance' }] });
    expect(await repo.getClosureAlerts()).toMatchObject({ impactedCount: 1, closureReason: 'Maintenance' });
  });
  it('TC02/06: unknown candidate schedule preserves an impact without cleanup', async () => {
    const { repo, calls } = fixture({ reservations: [{ ...reservation, reservation_candidates: [] }] });
    expect((await repo.getClosureAlerts()).impactedCount).toBe(1);
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });
  it('TC06: successful non-overlap cleans only the observed active version with supported columns', async () => {
    const { repo, calls } = fixture({ blocks: [{ ...block, start_at: candidate.end_at }] });
    expect((await repo.getClosureAlerts()).impactedCount).toBe(0);
    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url.searchParams.get('updated_at')).toBe(`eq.${reservation.updated_at}`);
    expect(patch?.url.searchParams.get('is_closure_impacted')).toBe('eq.true');
    expect(patch?.body).not.toHaveProperty('closure_reason');
    expect(patch?.body).not.toHaveProperty('closure_date');
  });
  it('TC03: successful empty alert result differs from a failed read', async () => {
    expect(await fixture({ reservations: [] }).repo.getClosureAlerts()).toMatchObject({ impactedCount: 0, reservations: [] });
  });
  it('TC02: uses the configured venue timezone and excludes an exact midnight end', async () => {
    const { repo } = fixture({ timezone: 'UTC', blocks: [{ ...block, end_at: '2026-10-26T00:00:00Z' }] });
    expect((await repo.getClosureAlerts()).closureDateRange).toBe('2026-10-25');
  });
  it('TC02: missing reasons remain null', async () => {
    expect((await fixture({ blocks: [{ ...block, reason: null }] }).repo.getClosureAlerts()).closureReason).toBeNull();
  });
  it.each(['display', 'code', 'template', 'missing'] as const)('TC04: %s workspace label fallback', async kind => {
    const instance = kind === 'missing' ? null : { display_name: kind === 'display' ? 'Display' : null,
      instance_code: kind === 'code' ? 'CODE' : null, workspace_templates: { name: 'Template' } };
    const { repo } = fixture({ candidates: [{ ...candidate, workspace_instances: instance }] });
    expect((await repo.findCandidatesByReservationId('reservation'))[0].workspaceDisplayName)
      .toBe(({ display: 'Display', code: 'CODE', template: 'Template', missing: 'desk' })[kind]);
  });
  it('TC06: stale cleanup retains an alert and reports no resolved reservation', async () => {
    const { repo } = fixture({ blocks: [], stale: true });
    expect((await repo.getClosureAlerts()).impactedCount).toBe(1);
    expect(await repo.reconcileClearedClosureImpact()).toEqual({ clearedReservationIds: [] });
  });
  it.each(['schedule_blocks', 'reservations', 'reservation_candidates'])('TC06: reconciliation fails closed on %s read failure', async fail => {
    const { repo, calls } = fixture({ fail });
    await expect(repo.reconcileClearedClosureImpact()).rejects.toThrow();
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });
  it.each(['guest', 'staff', 'admin', 'staffList', 'adminList'] as const)('TC02/03/05: %s reads normalized closure metadata', async reader => {
    const { repo } = fixture();
    const read = {
      guest: () => repo.findGuestReservationTrackingRecord({ referenceCode: 'REF1' }),
      staff: () => repo.getOperationalReservation('REF1'),
      admin: () => repo.getAdminReservationDetail('REF1'),
      staffList: async () => (await repo.listOperationalReservations('2026-10-25T00:00:00Z'))[0],
      adminList: async () => (await repo.listAdminReservations())[0],
    }[reader];
    expect(await read()).toMatchObject({ isClosureImpacted: true, closureReason: 'Repairs', closureDate: '2026-10-26' });
  });
  it.each(['staffList', 'adminList', 'admin'] as const)('TC06: %s read failure cannot clear an impact', async reader => {
    const { repo, calls } = fixture({ fail: 'schedule_blocks' });
    const read = { staffList: () => repo.listOperationalReservations('2026-10-25T00:00:00Z'),
      adminList: () => repo.listAdminReservations(), admin: () => repo.getAdminReservationDetail('REF1') }[reader];
    await expect(read()).rejects.toThrow();
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });
  it.each(['staffList', 'adminList', 'admin'] as const)('TC06: %s stale cleanup retains the impact', async reader => {
    const { repo } = fixture({ blocks: [], stale: true });
    const read = { staffList: async () => (await repo.listOperationalReservations('2026-10-25T00:00:00Z'))[0],
      adminList: async () => (await repo.listAdminReservations())[0], admin: () => repo.getAdminReservationDetail('REF1') }[reader];
    expect(await read()).toMatchObject({ isClosureImpacted: true });
  });
  it('TC06: reconciliation reports and audits only successful guarded cleanup', async () => {
    const { repo, calls } = fixture({ blocks: [] });
    expect(await repo.reconcileClearedClosureImpact()).toEqual({ clearedReservationIds: ['reservation'] });
    expect(calls.filter(c => c.method === 'POST' && c.url.pathname.endsWith('/audit_logs'))).toHaveLength(1);
  });
  it('TC08: twenty impacted reservations still use three reads', async () => {
    const { repo, calls } = fixture({ reservations: Array.from({ length: 20 }, (_, index) => ({ ...reservation, id: `r${index}` })) });
    expect((await repo.getClosureAlerts()).impactedCount).toBe(20);
    expect(calls).toHaveLength(3);
  });
});
