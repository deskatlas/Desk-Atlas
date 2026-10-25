// MS80-TC05: existing admin/staff route response contracts and failure boundary.
import { afterEach, describe, expect, it, vi } from 'vitest';
const seams = vi.hoisted(() => ({ alerts: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/reservations/_lib/reservationService', () => ({
  getAdminReservationService: () => ({ getClosureAlerts: seams.alerts }),
}));
vi.mock('@deskatlas/domain', () => ({
  ReservationSupabaseRepository: class {},
  createStaffOperationsService: () => ({ getClosureAlerts: seams.alerts }),
}));
import { GET as adminAlerts } from '../apps/admin-portal/src/app/api/operations/closure-alerts/route';
import { GET as adminImpacts } from '../apps/admin-portal/src/app/api/admin/reservations/closure-impacts/route';
import { GET as staffAlerts } from '../apps/staff-dashboard/src/app/api/operations/closure-alerts/route';
import { GET as staffImpacts } from '../apps/staff-dashboard/src/app/api/operations/reservations/closure-impacts/route';

afterEach(() => vi.restoreAllMocks());

describe.each([adminAlerts, adminImpacts, staffAlerts, staffImpacts])('MS80 closure route', get => {
  it('returns a successful empty result only after a successful service read', async () => {
    const result = { impactedCount: 0, closureDateRange: null, closureReason: null, reservations: [] };
    seams.alerts.mockResolvedValue(result);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
  it('returns a non-success retry response without database or customer details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    seams.alerts.mockRejectedValue(new Error('Supabase request failed (400): {"code":"42703","message":"private database diagnostic"}'));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Closure alerts are unavailable. Please try again.' });
    expect(log).toHaveBeenCalledWith('CLOSURE_ALERTS_READ_FAILED', { sqlstate: '42703' });
  });
  it('MS82-TC08: records structured SQLSTATE without exposing interruption details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    seams.alerts.mockRejectedValue(Object.assign(new Error('private diagnostic'), { code: '57P03' }));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Closure alerts are unavailable. Please try again.' });
    expect(log).toHaveBeenCalledWith('CLOSURE_ALERTS_READ_FAILED', { sqlstate: '57P03' });
  });
});
