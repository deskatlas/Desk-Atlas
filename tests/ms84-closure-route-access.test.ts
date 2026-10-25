// MS84-TC07 / PRD-F13 / QAD-TC23.
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { NextRequest } = createRequire(new URL('../apps/admin-portal/package.json', import.meta.url))('next/server') as typeof import('../apps/admin-portal/node_modules/next/server');
const seams = vi.hoisted(() => ({ verify: vi.fn(), list: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/auth/_lib/verifiedAdmin', () => ({
  verifyAdministrator: seams.verify,
  AdminAccessError: class extends Error { constructor(public code: string, public status: number) { super(code); } },
}));
vi.mock('../apps/admin-portal/src/app/api/admin/reservations/_lib/reservationService', () => ({
  getAdminReservationService: () => ({ listReservations: seams.list }),
}));
import { AdminAccessError } from '../apps/admin-portal/src/app/api/admin/auth/_lib/verifiedAdmin';
import { GET } from '../apps/admin-portal/src/app/api/admin/reservations/route';

describe('MS84 protected closure list', () => {
  it.each([401, 403])('denies unauthorized and cross-role reads (%i) before reading reservations', async status => {
    seams.list.mockClear();
    seams.verify.mockRejectedValue(new AdminAccessError(status === 401 ? 'AUTH_REQUIRED' : 'ACCESS_REVOKED', status));
    const response = await GET(new NextRequest('http://localhost/api/admin/reservations?filter=closure_impacted'));
    expect(response.status).toBe(status); expect(seams.list).not.toHaveBeenCalled();
  });
  it('passes an authenticated closure scope through to the service without mutation', async () => {
    seams.verify.mockResolvedValue({ actor: 'admin' });
    seams.list.mockResolvedValue({ reservations: [], total: 0 });
    const response = await GET(new NextRequest('http://localhost/api/admin/reservations?filter=closure_impacted', { headers: { Authorization: 'Bearer fixture' } }));
    expect(response.status).toBe(200);
    expect(seams.list).toHaveBeenCalledWith('closure_impacted', undefined, undefined);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
