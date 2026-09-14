import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  AdminAlreadyExistsError,
  AdminSetupError,
  PasswordPolicyError,
  InMemoryStaffRepository,
  StaffService,
  createStaffService,
} from '@deskatlas/domain';

describe('MF-90: Setup Password Sealed After Configuration', () => {
  let memoryRepo: InMemoryStaffRepository;
  let staffService: StaffService;

  beforeEach(() => {
    memoryRepo = new InMemoryStaffRepository([]);
    staffService = createStaffService(memoryRepo);
  });

  it('allows initial admin to establish password on first attempt', async () => {
    // 1. Initial admin bootstrapped via OAuth
    await staffService.setupInitialAdmin({
      userId: 'usr-admin-1',
      email: 'admin1@deskatlas.com',
      displayName: 'Admin One',
    });

    // Before password setup: hasAdmin is true, but isPasswordConfigured is false
    const statusBefore = await staffService.getSetupStatus('usr-admin-1');
    assert.equal(statusBefore.hasAdmin, true);
    assert.equal(statusBefore.isPasswordConfigured, false);
    assert.equal(statusBefore.setupAllowed, false);

    // 2. Set password for the first time
    const profile = await staffService.setupInitialAdminPassword({
      userId: 'usr-admin-1',
      email: 'admin1@deskatlas.com',
      password: 'AdminPassword123!',
    });

    assert.equal(profile.userId, 'usr-admin-1');
    assert.equal(memoryRepo.getPasswordByUserId('usr-admin-1'), 'AdminPassword123!');

    // After password setup: isPasswordConfigured is true, setupAllowed is false
    const statusAfter = await staffService.getSetupStatus('usr-admin-1');
    assert.equal(statusAfter.hasAdmin, true);
    assert.equal(statusAfter.isPasswordConfigured, true);
    assert.equal(statusAfter.setupAllowed, false);
  });

  it('strictly rejects a second password creation attempt with the same admin user ID (prevent URL re-access exploit)', async () => {
    // Step 1: Initial admin sets password
    await staffService.setupInitialAdminPassword({
      userId: 'usr-superadmin-saved-url',
      email: 'superadmin@deskatlas.com',
      displayName: 'Super Admin',
      password: 'InitialPassword123!',
    });

    assert.equal(memoryRepo.getPasswordByUserId('usr-superadmin-saved-url'), 'InitialPassword123!');

    // Step 2: Attacker or someone revisiting saved URL attempts to overwrite password with the same userId
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          userId: 'usr-superadmin-saved-url',
          email: 'superadmin@deskatlas.com',
          password: 'MaliciousPassword999#',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminAlreadyExistsError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /already exists.*sealed/i);
        return true;
      }
    );

    // Verify original password was NOT changed or overwritten
    assert.equal(memoryRepo.getPasswordByUserId('usr-superadmin-saved-url'), 'InitialPassword123!');
  });

  it('prevents any other user ID from setting password once setup is sealed', async () => {
    // 1. Initial admin configured
    await staffService.setupInitialAdminPassword({
      userId: 'usr-legit-admin',
      email: 'legit@deskatlas.com',
      password: 'LegitPassword123!',
    });

    // 2. Someone attempts with arbitrary user ID
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          userId: 'usr-different-attacker',
          email: 'attacker@deskatlas.com',
          password: 'AttackerPassword123!',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminAlreadyExistsError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it('accurately reports setup status when password is not yet configured and after completion', async () => {
    // Uninitialized system
    const emptyStatus = await staffService.getSetupStatus();
    assert.equal(emptyStatus.hasAdmin, false);
    assert.equal(emptyStatus.setupAllowed, true);

    // Profile bootstrapped, password not set
    await staffService.setupInitialAdmin({
      userId: 'usr-pending-admin',
      email: 'pending@deskatlas.com',
    });

    const pendingStatus = await staffService.getSetupStatus('usr-pending-admin');
    assert.equal(pendingStatus.hasAdmin, true);
    assert.equal(pendingStatus.isPasswordConfigured, false);
    assert.equal(pendingStatus.setupAllowed, false);

    // Now complete password setup
    await staffService.setupInitialAdminPassword({
      userId: 'usr-pending-admin',
      email: 'pending@deskatlas.com',
      password: 'SecureKey2026@',
    });

    // Sealed for this user
    const sealedUser = await staffService.getSetupStatus('usr-pending-admin');
    assert.equal(sealedUser.hasAdmin, true);
    assert.equal(sealedUser.isPasswordConfigured, true);
    assert.equal(sealedUser.setupAllowed, false);
  });

  it('rejects password setup if admin profile is inactive or non-admin', async () => {
    // Create inactive profile directly in repo
    const inactiveProfile = {
      userId: 'usr-inactive',
      email: 'inactive@deskatlas.com',
      displayName: 'Inactive User',
      role: 'ADMIN' as const,
      isActive: false,
    };
    const testRepo = new InMemoryStaffRepository([inactiveProfile]);
    const testService = createStaffService(testRepo);

    await assert.rejects(
      () =>
        testService.setupInitialAdminPassword({
          userId: 'usr-inactive',
          email: 'inactive@deskatlas.com',
          password: 'ValidPassword123!',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminSetupError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /not an active administrator/i);
        return true;
      }
    );
  });
});
