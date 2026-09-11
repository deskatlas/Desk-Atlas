import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  AdminAlreadyExistsError,
  AdminSetupError,
  PasswordPolicyError,
  InMemoryStaffRepository,
  StaffService,
  createStaffService,
  type StaffProfile,
} from '@deskatlas/domain';

describe('MF-67: Initial Admin Password Creation After Google OAuth Connection', () => {
  let memoryRepo: InMemoryStaffRepository;
  let staffService: StaffService;

  beforeEach(() => {
    memoryRepo = new InMemoryStaffRepository([]);
    staffService = createStaffService(memoryRepo);
  });

  it('allows initial admin to establish password and finalizes admin profile', async () => {
    const adminInput = {
      userId: 'usr-admin-101',
      email: 'admin.super@deskatlas.com',
      displayName: 'Super Admin',
      password: 'AdminPassword123!',
    };

    const profile = await staffService.setupInitialAdminPassword(adminInput);

    assert.equal(profile.userId, adminInput.userId);
    assert.equal(profile.email, adminInput.email.toLowerCase());
    assert.equal(profile.displayName, adminInput.displayName);
    assert.equal(profile.role, 'ADMIN');
    assert.equal(profile.isActive, true);

    // Password must be recorded in repository
    assert.equal(memoryRepo.getPasswordByUserId(adminInput.userId), 'AdminPassword123!');

    // Admin setup is now sealed
    assert.equal(await staffService.checkAdminExists(), true);
  });

  it('allows setting password for an already bootstrapped initial admin', async () => {
    // Step 1: OAuth callback bootstrapped profile
    await staffService.setupInitialAdmin({
      userId: 'usr-admin-google-1',
      email: 'founder@gmail.com',
      displayName: 'Founder',
    });

    // Step 2: Immediate password creation step
    const profile = await staffService.setupInitialAdminPassword({
      userId: 'usr-admin-google-1',
      email: 'founder@gmail.com',
      password: 'MasterKey2026#',
    });

    assert.equal(profile.userId, 'usr-admin-google-1');
    assert.equal(profile.role, 'ADMIN');
    assert.equal(memoryRepo.getPasswordByUserId('usr-admin-google-1'), 'MasterKey2026#');
  });

  it('enforces MF-46 password policy and rejects passwords violating rules', async () => {
    const baseInput = {
      userId: 'usr-admin-test',
      email: 'admin.policy@deskatlas.com',
    };

    // 1. Too short (< 8 chars)
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          ...baseInput,
          password: 'Pass1!',
        }),
      (err: any) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.match(err.message, /at least 8 characters/i);
        return true;
      }
    );

    // 2. Missing uppercase letter
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          ...baseInput,
          password: 'password123!',
        }),
      (err: any) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.match(err.message, /uppercase letter/i);
        return true;
      }
    );

    // 3. Missing digit
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          ...baseInput,
          password: 'PasswordNoDigits!',
        }),
      (err: any) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.match(err.message, /number/i);
        return true;
      }
    );

    // 4. Missing special character
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          ...baseInput,
          password: 'Password12345',
        }),
      (err: any) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.match(err.message, /special character/i);
        return true;
      }
    );
  });

  it('prevents another user from setting admin password once setup is sealed', async () => {
    // 1. Initial admin configured
    await staffService.setupInitialAdminPassword({
      userId: 'usr-first-admin',
      email: 'first@deskatlas.com',
      password: 'FirstPassword123!',
    });

    // 2. Attacker / secondary user attempts to initialize password
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          userId: 'usr-attacker',
          email: 'attacker@gmail.com',
          password: 'AttackerPassword123!',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminAlreadyExistsError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );

    // Ensure attacker password was NOT recorded
    assert.equal(memoryRepo.getPasswordByUserId('usr-attacker'), undefined);
  });

  it('validates email and user ID presence for password initialization', async () => {
    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          userId: '',
          email: 'admin@deskatlas.com',
          password: 'ValidPassword123!',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminSetupError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    await assert.rejects(
      () =>
        staffService.setupInitialAdminPassword({
          userId: 'usr-valid',
          email: 'invalid-email',
          password: 'ValidPassword123!',
        }),
      (err: any) => {
        assert.ok(err instanceof AdminSetupError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
});
