import { expect, it } from 'vitest';
import { ReservationSupabaseRepository, SupabaseAvailabilityRepository, ActivityLogSupabaseRepository } from '@deskatlas/domain';

const rid = '10000000-0000-4000-8000-000000000001';
function fixture(embedded = false, closure = false, distinctReviews = false) {
  const calls: URL[] = [];
  const tables: Record<string, unknown[]> = {
    reservations: [{ id: rid, reference_code: 'REF-1', source: 'WEB', status: 'PAYMENT_UNDER_REVIEW',
      customer_first_name: 'Test', customer_last_name: 'Guest', customer_email: 'fixture@example.invalid',
      amount_due: 120, currency: 'PHP', is_closure_impacted: closure,
      created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z' }],
    reservation_candidates: [{ id: 'candidate-1', reservation_id: rid, workspace_instance_id: 'spot-1',
      rank: 0, is_assigned: true, start_at: '2026-10-24T01:00:00Z', end_at: '2026-10-24T03:00:00Z' }],
    payment_attempts: Array.from({ length: 20 }, (_, i) => ({ id: `payment-${i}`, reservation_id: rid,
      channel: 'WEB', status: 'UNDER_REVIEW', payment_method_id: null, proof_submitted_at: '2026-10-24T00:00:00Z',
      refund_status: 'NONE', proof_storage_path: 'private-proof', processed_at: null, processed_by_user_id: null })),
    workspace_instances: [{ id: 'spot-1', template_id: 'template-1', floor_id: 'floor-1', display_name: 'Desk One', instance_code: 'D1' }],
    workspace_templates: [{ id: 'template-1', name: 'Desk' }], floors: [{ id: 'floor-1', name: 'Floor One' }],
    staff_profiles: [{ user_id: 'actor-1', display_name: 'Operator' }],
    audit_logs: Array.from({ length: 20 }, (_, i) => ({ id: `event-${i}`, entity_id: rid,
      action: i === 0 ? 'reservation_reentered' : 'reservation_checked_in', actor_user_id: 'actor-1',
      actor_role: 'STAFF', metadata: i === 0 ? { actor_name: 'Recorded Actor' } : {}, created_at: `2026-10-24T01:00:${String(i).padStart(2, '0')}Z` })),
  };
  if (distinctReviews) {
    const ids = Array.from({ length: 20 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    const base = tables.reservations[0] as object;
    tables.reservations = ids.map((id, i) => ({ ...base, id, reference_code: `REF-${i + 1}` }));
    tables.reservation_candidates = ids.map((id, i) => ({ id: `candidate-${i}`, reservation_id: id,
      workspace_instance_id: 'spot-1', rank: 0, is_assigned: false,
      start_at: '2026-10-24T01:00:00Z', end_at: '2026-10-24T03:00:00Z' }));
    tables.payment_attempts = tables.payment_attempts.map((row, i) => ({ ...row as object, reservation_id: ids[i] }));
  }
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    let rows = tables[url.pathname.split('/').at(-1) ?? ''] ?? [];
    if (embedded && url.pathname.endsWith('/reservations')) rows = rows.map(row => ({ ...row as object,
      candidates: tables.reservation_candidates, attempts: tables.payment_attempts }));
    return new Response(JSON.stringify(rows),
      { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, repository: new ReservationSupabaseRepository({ supabaseUrl: 'https://fixture.invalid',
    serviceRoleKey: 'fixture-only', fetcher }) };
}
it('QAD-TC35: hydrates twenty review items in bounded batches with the same queue fields', async () => {
  const { calls, repository } = fixture(false, false, true);
  const queue = await repository.listPaymentReviewQueue();
  expect(queue).toHaveLength(20);
  expect(calls.length).toBeLessThanOrEqual(6);
  expect(queue[0]).toMatchObject({ reservationReferenceCode: 'REF-1', amountDue: 120,
    submittedCandidates: [{ workspaceDisplayName: 'Desk One', workspaceTemplateName: 'Desk', floorName: 'Floor One' }] });
  expect(queue[0]).not.toHaveProperty('proofStoragePath');
  expect(queue.map(item => item.paymentAttemptId)).toEqual([...queue.map(item => item.paymentAttemptId)].sort());
});

it('QAD-TC35: parallel dashboard readers share one in-flight catalog load', async () => {
  const { calls, repository } = fixture();
  await Promise.all([repository.listReportReservations(), repository.listAdminReservations()]);
  expect(calls.filter(url => url.pathname.endsWith('/workspace_templates'))).toHaveLength(1);
  expect(calls.filter(url => url.pathname.endsWith('/floors'))).toHaveLength(1);
});

it('QAD-TC35: admin lists use embedded children without per-batch follow-up reads', async () => {
  const { calls, repository } = fixture(true);
  const rows = await repository.listAdminReservations();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ referenceCode: 'REF-1', workspaceDisplayName: 'Desk One' });
  expect(calls.some(url => url.pathname.endsWith('/reservation_candidates') || url.pathname.endsWith('/payment_attempts'))).toBe(false);
  expect(calls[0].searchParams.get('candidates.order')).toBe('rank.asc');
  expect(calls[0].searchParams.get('attempts.order')).toBe('created_at.desc');
});

it('QAD-TC35: closure cleanup uses optimistic version and state guards', async () => {
  const { calls, repository } = fixture(true, true);
  await repository.listAdminReservations();
  const cleanup = calls.find(url => url.searchParams.has('updated_at'));
  expect(cleanup?.searchParams.get('updated_at')).toBe('eq.2026-10-24T00:00:00Z');
  expect(cleanup?.searchParams.get('is_closure_impacted')).toBe('eq.true');
});

it('QAD-TC35: batched availability preserves business blocks, spot isolation and fresh requests', async () => {
  const calls: URL[] = [];
  const repo = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://window-fixture.invalid', serviceRoleKey: 'fixture-only' });
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    return new Response(JSON.stringify(url.pathname.endsWith('/schedule_blocks')
      ? [{ id: 'block-1', scope: 'BUSINESS', workspace_instance_id: null, block_type: 'CLOSURE', start_at: '2026-10-24T01:00:00Z', end_at: '2026-10-24T02:00:00Z' }]
      : [{ workspace_instance_id: 'spot-1', start_at: '2026-10-24T01:00:00Z', end_at: '2026-10-24T02:00:00Z', reservation: { id: rid, status: 'CONFIRMED' } }]));
  };
  try {
    const ids = Array.from({ length: 20 }, (_, i) => `spot-${i}`);
    const window = await repo.prepareWindow(ids, '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z');
    expect(await window.listScheduleBlocks('spot-2', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toHaveLength(1);
    expect(await window.listBlockingReservations('spot-2', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toEqual([]);
    expect(await window.listBlockingReservations('spot-1', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toHaveLength(1);
    expect(calls).toHaveLength(2);
    await repo.prepareWindow(ids, '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z');
    expect(calls).toHaveLength(4);
  } finally { globalThis.fetch = original; }
});

it('QAD-TC35: availability batches follow Content-Range through server-capped pages', async () => {
  const repo = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://paged-fixture.invalid', serviceRoleKey: 'fixture-only' });
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/schedule_blocks')) return new Response('[]', { headers: { 'Content-Range': '*/0' } });
    const offset = Number(url.searchParams.get('offset'));
    return new Response(JSON.stringify([{ workspace_instance_id: `spot-${offset + 1}`, start_at: '2026-10-24T01:00:00Z',
      end_at: '2026-10-24T02:00:00Z', reservation: { id: `${rid}-${offset}`, status: 'CONFIRMED' } }]),
      { headers: { 'Content-Range': `${offset}-${offset}/2` } });
  };
  try {
    const window = await repo.prepareWindow(['spot-1', 'spot-2'], '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z');
    expect(await window.listBlockingReservations('spot-2', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toHaveLength(1);
  } finally { globalThis.fetch = original; }
});

it('QAD-TC4: pending candidates never consume availability reads or block inventory', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    return new Response(JSON.stringify(url.search.includes('PENDING') ? [{ start_at: '2026-10-24T00:00:00Z',
      end_at: '2026-10-25T00:00:00Z', reservation: { id: rid, status: 'PAYMENT_UNDER_REVIEW' } }] : []));
  };
  const repo = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://availability-fixture.invalid', serviceRoleKey: 'fixture-only' });
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  try {
    expect(await repo.listBlockingReservations('spot-1', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toEqual([]);
    expect(calls).toHaveLength(1);
  } finally { globalThis.fetch = original; }
});

it('QAD-TC35: audit date filters retain both bounds', async () => {
  let captured: URL | undefined;
  const repo = new ActivityLogSupabaseRepository({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture-only' });
  const original = globalThis.fetch;
  globalThis.fetch = async input => { captured = new URL(String(input)); return new Response('[]'); };
  try {
    await repo.listActivityLogs({ from: '2026-10-01', to: '2026-10-24' });
    expect(captured?.searchParams.getAll('created_at')).toEqual(['gte.2026-10-01T00:00:00.000Z', 'lte.2026-10-24T00:00:00.000Z']);
  } finally { globalThis.fetch = original; }
});
it('QAD-TC14/35: activity hydration preserves all events without reading payment/history details', async () => {
  const { calls, repository } = fixture();
  const events = await repository.listOperationalActivity(20);
  expect(events).toHaveLength(20);
  expect(events[0]).toMatchObject({ activityType: 'REENTRY', actorName: 'Recorded Actor', workspaceDisplayName: 'Desk One' });
  expect(events[1].actorName).toBe('Operator');
  expect(calls.length).toBeLessThanOrEqual(5);
  expect(calls.filter(url => url.pathname.endsWith('/audit_logs'))).toHaveLength(1);
  expect(calls.some(url => url.pathname.endsWith('/payment_attempts'))).toBe(false);
});
