// MS81-TC02/03/04 / PRD-F13 / QAD-TC23: application contract and open security gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffManagementAuthorizationError } from '@deskatlas/domain';

const seams = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../apps/admin-portal/src/app/api/admin/staff/_lib/staffService', () => ({
  getStaffManagementService: () => ({ createStaff: seams.create }),
}));
import { POST } from '../apps/admin-portal/src/app/api/admin/staff/route';

const request = (extra: Record<string, unknown> = {}) => new Request('http://localhost/api/admin/staff', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'synthetic@example.invalid', displayName: 'Synthetic User', role: 'STAFF', ...extra }),
});

beforeEach(() => { seams.create.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('MS81 staff route contract', () => {
  it('keeps the existing success envelope', async () => {
    const member = { id: 'synthetic-user', email: 'synthetic@example.invalid', rawRole: 'STAFF' };
    seams.create.mockResolvedValue(member);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ staff: member });
  });

  it('keeps explicit service authorization denial as 403', async () => {
    seams.create.mockRejectedValue(new StaffManagementAuthorizationError('Only ADMIN profiles may create staff accounts.'));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only ADMIN profiles may create staff accounts.' });
  });

  it.fails('MS81-TC04 OPEN GATE: rejects a body-supplied actor before privileged service access', async () => {
    seams.create.mockResolvedValue({ id: 'synthetic-user' });
    const response = await POST(request({ actorUserId: 'forged-admin', actorRole: 'ADMIN', actorIsSuperAdmin: true }));
    expect([401, 403]).toContain(response.status);
    expect(seams.create).not.toHaveBeenCalled();
  });
});
