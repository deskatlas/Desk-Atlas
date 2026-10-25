import type { ReservationTabType } from '@deskatlas/domain';

// MS-84 / PRD-F13: explicit closure scope takes precedence over tab defaults.
export function parseReservationNavigation(params: Pick<URLSearchParams, 'get'>): {
  tab: ReservationTabType; filter: 'closure_impacted' | null;
} {
  const filter = params.get('filter') === 'closure_impacted' ? 'closure_impacted' : null;
  const value = params.get('tab');
  const tab = value === 'operations' || value === 'completed' || value === 'expired' ||
    value === 'cancelled_refund_eligible' || value === 'refunded' ? value : 'reservations';
  return { tab: filter ? 'reservations' : tab, filter };
}
