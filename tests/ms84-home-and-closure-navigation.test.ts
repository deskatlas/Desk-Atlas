// MS-84 / PRD-F13/F14 / QAD-TC23/24 / MS84-TC05 through TC08.
import { describe, expect, it, vi } from 'vitest';
import { AdminReservationService, ReservationSupabaseRepository, requiresClosureAction } from '@deskatlas/domain';
import { parseReservationNavigation } from '../apps/admin-portal/src/features/reservations/reservationNavigation';
import { closureReturnDestination, CLOSURE_REVIEW_DESTINATION } from '../apps/admin-portal/src/features/auth/closureReturnDestination';

function fixture(count = 1, failure = false) {
  const calls: URL[] = [];
  const row = (i: number) => ({ id: `reservation-${i}`, reference_code: `REF${i}`, status: 'CONFIRMED', source: 'WEB',
    customer_first_name: 'Test', customer_last_name: 'Guest', customer_email: 'guest@example.invalid',
    updated_at: '2026-10-25T00:00:00Z', created_at: '2026-10-24T00:00:00Z',
    is_closure_impacted: true, closure_exception_id: null, closure_impact_status: 'MANUAL_RESOLUTION_REQUIRED',
    amount_due: 100, currency: 'PHP', candidates: [], attempts: [], reservation_candidates: [] });
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    const table = url.pathname.split('/').at(-1);
    if (table === 'reservations') {
      if (failure && url.searchParams.get('offset') === '500') return new Response('{}', { status: 503 });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return Response.json(Array.from({ length: Math.min(500, Math.max(count - offset, 0)) }, (_, i) => row(i + offset)));
    }
    if (table === 'business_settings') return Response.json([{ timezone: 'Asia/Manila' }]);
    return Response.json([]);
  };
  const repo = new ReservationSupabaseRepository({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture', fetcher });
  return { repo, calls };
}

describe('MS84 closure scope and navigation', () => {
  it('uses typed query state with explicit closure precedence and ordinary tab defaults', () => {
    expect(parseReservationNavigation(new URLSearchParams('filter=closure_impacted&tab=expired')))
      .toEqual({ tab: 'reservations', filter: 'closure_impacted' });
    expect(parseReservationNavigation(new URLSearchParams('tab=operations'))).toEqual({ tab: 'operations', filter: null });
    expect(parseReservationNavigation(new URLSearchParams('tab=unknown&filter=unknown'))).toEqual({ tab: 'reservations', filter: null });
  });
  it.each(['https://evil.invalid', '//evil.invalid', '/manage/reservations?filter=closure_impacted&next=https://evil.invalid', 'javascript:alert(1)', null])
    ('rejects unapproved return destinations: %s', value => expect(closureReturnDestination(value)).toBe('/manage'));
  it('retains exactly the protected closure destination through sign-in', () => {
    expect(closureReturnDestination(CLOSURE_REVIEW_DESTINATION)).toBe(CLOSURE_REVIEW_DESTINATION);
  });
  it.each(['CUSTOMER_RESOLVED', 'STAFF_RESOLVED', null] as const)('excludes resolved/stale flags: %s', closureImpactStatus => {
    expect(requiresClosureAction({ isClosureImpacted: true, closureImpactStatus, reservationStatus: 'CONFIRMED' })).toBe(false);
  });
  it.each(['CANCELLED', 'COMPLETED', 'EXPIRED', 'REJECTED'] as const)('excludes terminal state %s', reservationStatus => {
    expect(requiresClosureAction({ isClosureImpacted: true, closureImpactStatus: 'AFFECTED_PENDING_ACTION', reservationStatus })).toBe(false);
  });
  it('reads all 501 impacts before list pagination and matches the alert despite missing metadata/schedules', async () => {
    const { repo, calls } = fixture(501);
    const list = await new AdminReservationService(repo).listReservations('closure_impacted');
    const alerts = await repo.getClosureAlerts();
    expect(list.total).toBe(501);
    expect(alerts.impactedCount).toBe(list.total);
    expect(list.reservations.map(r => r.id)).toEqual(alerts.reservations.map(r => r.reservationId));
    const queries = calls.filter(url => url.pathname.endsWith('/reservations'));
    expect(queries).toHaveLength(4);
    for (const url of queries) {
      expect(url.searchParams.get('is_closure_impacted')).toBe('eq.true');
      expect(url.searchParams.get('closure_impact_status')).toBe('in.(AFFECTED_PENDING_ACTION,MANUAL_RESOLUTION_REQUIRED)');
      expect(url.searchParams.get('limit')).toBe('500');
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.asc');
    }
    expect(list.reservations.at(-1)?.closureReason).toBeNull();
  });
  it('keeps an unresolved impact through elapsed-time presentation mapping', async () => {
    const { repo } = fixture();
    const [summary] = await repo.listAdminReservations(true);
    const read = vi.spyOn(repo, 'listAdminReservations').mockResolvedValue([
      { ...summary, id: 'unresolved', endAt: '2026-01-01T00:00:00Z', reservationStatus: 'CONFIRMED' },
      { ...summary, id: 'resolved', closureImpactStatus: 'STAFF_RESOLVED' },
      { ...summary, id: 'terminal', reservationStatus: 'COMPLETED' },
    ]);
    const result = await new AdminReservationService(repo).listReservations('closure_impacted');
    expect(read).toHaveBeenCalledWith(true);
    expect(result.reservations.map(row => row.id)).toEqual(['unresolved']);
    expect(result.reservations[0].reservationStatus).toBe('EXPIRED');
    read.mockRestore();
  });
  it('distinguishes a true empty result from a failed later page', async () => {
    expect((await new AdminReservationService(fixture(0).repo).listReservations('closure_impacted')).total).toBe(0);
    await expect(new AdminReservationService(fixture(501, true).repo).listReservations('closure_impacted')).rejects.toThrow();
    await expect(fixture(501, true).repo.getClosureAlerts()).rejects.toThrow();
  });
});
