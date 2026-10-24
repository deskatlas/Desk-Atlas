import { expect, it } from 'vitest';
import { ReservationSupabaseRepository } from '@deskatlas/domain';

// MS-35 / PRD-F15 / SDD-C12: exercise real repository fetches and mapping.
function fixture(size = 1) {
  const calls: URL[] = [];
  const attempts = Array.from({ length: size }, (_, i) => ({
    id: `payment-${i}`, reservation_id: `reservation-${i}`, payment_method_id: 'method-1',
    channel: 'WEB', status: 'UNDER_REVIEW', refund_status: 'NONE', amount: null,
    created_at: '2026-10-24T00:00:00Z', proof_submitted_at: null, processed_at: null,
  }));
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    let rows: unknown[] = attempts;
    if (url.pathname.endsWith('/reservations')) {
      const ids = url.searchParams.get('id')?.slice(4, -1).split(',') ?? ['unrelated'];
      rows = ids.map(id => ({ id, reference_code: `REF-${id}`, amount_due: '120.50', currency: 'PHP' }));
    } else if (url.pathname.endsWith('/payment_methods')) {
      rows = [{ id: 'method-1', method_type: 'GCASH', display_name: 'GCash' }];
    }
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, repository: new ReservationSupabaseRepository({
    supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture-only', fetcher,
  }) };
}
it('loads only payment-linked reservation and method IDs with unchanged report fields', async () => {
  const { calls, repository } = fixture();
  const result = await repository.listReportPaymentAttempts();
  expect(calls.filter(url => !url.pathname.endsWith('/payment_attempts'))
    .every(url => url.searchParams.has('id'))).toBe(true);
  expect(result[0]).toMatchObject({ reservationReferenceCode: 'REF-reservation-0',
    amount: 120.5, currency: 'PHP', paymentMethodType: 'GCASH', paymentStatus: 'UNDER_REVIEW' });
  expect(calls).toHaveLength(3);
});
it('does not query related tables for an empty payment report', async () => {
  const { calls, repository } = fixture(0);
  expect(await repository.listReportPaymentAttempts()).toEqual([]);
  expect(calls).toHaveLength(1);
});
it('bounds IN filters, deduplicates methods and preserves every selected payment', async () => {
  const { calls, repository } = fixture(125);
  const rows = await repository.listReportPaymentAttempts();
  expect(rows).toHaveLength(125);
  const reservations = calls.filter(url => url.pathname.endsWith('/reservations'));
  expect(reservations).toHaveLength(3);
  expect(reservations.every(url => (url.searchParams.get('id')?.split(',').length ?? 0) <= 60)).toBe(true);
  expect(calls.filter(url => url.pathname.endsWith('/payment_methods'))).toHaveLength(1);
  expect(rows.every(row => row.reservationReferenceCode === `REF-${row.reservationId}`)).toBe(true);
});
