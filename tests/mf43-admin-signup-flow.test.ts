import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  AdminAlreadyExistsError,
  AdminSetupError,
  InMemoryStaffRepository,
  StaffService,
  createStaffService,
  type StaffProfile,
} from '@deskatlas/domain';

describe('MF-43: Admin Sign-Up Flow (Google OAuth Single-Use Setup)', () => {
  let memoryRepo: InMemoryStaffRepository;
  let staffService: StaffService;

  beforeEach(() => {
    memoryRepo = new InMemoryStaffRepository([]);
    staffService = createStaffService(memoryRepo);
  });

  it('first-run guard allows setup when no admin account exists', async () => {
    const hasAdmin = await staffService.checkAdminExists();
    assert.equal(hasAdmin, false);

    const status = await staffService.getSetupStatus();
    assert.equal(status.hasAdmin, false);
    assert.equal(status.setupAllowed, true);
    assert.equal(status.passwordSetupPending, false);
    assert.equal(status.isPasswordConfigured, false);
  });

  it('first-run guard blocks setup when an active admin account already exists', async () => {
    const existingAdmin: StaffProfile = {
      userId: 'usr-admin-existing',
      email: 'lead.admin@deskatlas.com',
      displayName: 'Lead Admin',
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryRepo = new InMemoryStaffRepository([existingAdmin]);
    staffService = createStaffService(memoryRepo);

    const hasAdmin = await staffService.checkAdminExists();
    assert.equal(hasAdmin, true);

    const status = await staffService.getSetupStatus();
    assert.equal(status.hasAdmin, true);
    assert.equal(status.setupAllowed, false);
    assert.equal(status.passwordSetupPending, true);
    assert.equal(status.isPasswordConfigured, false);

    await assert.rejects(
      () =>
        staffService.setupInitialAdmin({
          userId: 'usr-google-attempt-2',
          email: 'another.admin@gmail.com',
          displayName: 'Second Admin',
        }),
      (err: unknown) => {
        assert.ok(err instanceof AdminAlreadyExistsError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );
  });

  it('successfully creates staff_profiles row with role ADMIN on Google OAuth bootstrap', async () => {
    const googleUser = {
      userId: 'usr-google-oauth-101',
      email: 'founder@gmail.com',
      displayName: 'Founder Admin',
      provider: 'google',
    };

    const profile = await staffService.setupInitialAdmin(googleUser);

    assert.equal(profile.userId, googleUser.userId);
    assert.equal(profile.email, googleUser.email.toLowerCase());
    assert.equal(profile.displayName, googleUser.displayName);
    assert.equal(profile.role, 'ADMIN');
    assert.equal(profile.isActive, true);
    assert.ok(profile.createdAt);
    assert.ok(profile.updatedAt);

    // Verify persisted in repository
    const stored = await staffService.getProfile(googleUser.userId);
    assert.ok(stored);
    assert.equal(stored.role, 'ADMIN');
    assert.equal(stored.isActive, true);

    // Guard is now active
    assert.equal(await staffService.checkAdminExists(), true);
  });

  it('derives default display name from email when Google does not provide display name', async () => {
    const profile = await staffService.setupInitialAdmin({
      userId: 'usr-google-oauth-102',
      email: 'alex.ops@deskatlas.com',
    });

    assert.equal(profile.displayName, 'alex.ops');
    assert.equal(profile.role, 'ADMIN');
    assert.equal(profile.isActive, true);
  });

  it('duplicate setup rejection prevents second administrator creation', async () => {
    // 1. Initial admin bootstrap succeeds
    await staffService.setupInitialAdmin({
      userId: 'usr-admin-first',
      email: 'first.admin@gmail.com',
      displayName: 'First Admin',
    });

    // 2. Second setup attempt is strictly rejected
    await assert.rejects(
      () =>
        staffService.setupInitialAdmin({
          userId: 'usr-admin-second',
          email: 'second.admin@gmail.com',
          displayName: 'Second Admin',
        }),
      AdminAlreadyExistsError
    );

    // Confirm second user was NOT added as admin
    const second = await staffService.getProfile('usr-admin-second');
    assert.equal(second, null);
  });

  it('validates email format and rejects malformed addresses', async () => {
    await assert.rejects(
      () =>
        staffService.setupInitialAdmin({
          userId: 'usr-1',
          email: 'not-an-email',
        }),
      (err: unknown) => {
        assert.ok(err instanceof AdminSetupError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /valid email/i);
        return true;
      }
    );

    await assert.rejects(
      () =>
        staffService.setupInitialAdmin({
          userId: 'usr-2',
          email: '',
        }),
      AdminSetupError
    );
  });

  it('validates user ID and rejects missing user identifiers', async () => {
    await assert.rejects(
      () =>
        staffService.setupInitialAdmin({
          userId: '',
          email: 'valid@gmail.com',
        }),
      (err: unknown) => {
        assert.ok(err instanceof AdminSetupError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /user id is required/i);
        return true;
      }
    );
  });

  it('presence of regular STAFF profiles does not block initial admin setup', async () => {
    // Edge case: if a STAFF profile exists without an ADMIN, setup should still be allowed
    const staffOnly: StaffProfile = {
      userId: 'usr-staff-only',
      email: 'desk.staff@deskatlas.com',
      displayName: 'Frontdesk Staff',
      role: 'STAFF',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryRepo = new InMemoryStaffRepository([staffOnly]);
    staffService = createStaffService(memoryRepo);

    assert.equal(await staffService.checkAdminExists(), false);

    const profile = await staffService.setupInitialAdmin({
      userId: 'usr-admin-bootstrap',
      email: 'primary.admin@gmail.com',
      displayName: 'Primary Admin',
    });

    assert.equal(profile.role, 'ADMIN');
    assert.equal(await staffService.checkAdminExists(), true);
  });
});
