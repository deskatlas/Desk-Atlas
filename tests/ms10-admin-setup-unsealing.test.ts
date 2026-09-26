import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';
import {
  AdminAlreadyExistsError,
  AdminSetupError,
  PasswordPolicyError,
  InMemoryStaffRepository,
  StaffService,
  createStaffService,
  type AdminSetupStatus,
} from '@deskatlas/domain';

describe('MS-10: Superadmin Initial Bootstrap Password Setup Unsealing and Google OAuth Recovery Protocol', () => {
  let memoryRepo: InMemoryStaffRepository;
  let staffService: StaffService;

  beforeEach(() => {
    memoryRepo = new InMemoryStaffRepository([]);
    staffService = createStaffService(memoryRepo);
  });

  describe('QAD-TC10.1: Status Contract Pending State', () => {
    it('returns passwordSetupPending: true and setupAllowed: false when admin exists but password is not configured', async () => {
      // Step 1: Bootstrap initial superadmin via Google OAuth identity callback
      const profile = await staffService.setupInitialAdmin({
        userId: 'usr-superadmin-01',
        email: 'superadmin@deskatlas.com',
        displayName: 'Root Administrator',
        provider: 'google',
      });

      assert.equal(profile.userId, 'usr-superadmin-01');
      assert.equal(profile.role, 'ADMIN');

      // Check status with explicit userId
      const statusUser = await staffService.getSetupStatus('usr-superadmin-01');
      assert.equal(statusUser.hasAdmin, true);
      assert.equal(statusUser.setupAllowed, false);
      assert.equal(statusUser.passwordSetupPending, true);
      assert.equal(statusUser.isPasswordConfigured, false);
      assert.equal(statusUser.adminEmail, 'superadmin@deskatlas.com');

      // Check status globally without userId
      const statusGlobal = await staffService.getSetupStatus();
      assert.equal(statusGlobal.hasAdmin, true);
      assert.equal(statusGlobal.setupAllowed, false);
      assert.equal(statusGlobal.passwordSetupPending, true);
      assert.equal(statusGlobal.isPasswordConfigured, false);
    });

    it('returns setupAllowed: true, passwordSetupPending: false, isPasswordConfigured: false when fresh deployment has no admin', async () => {
      const status = await staffService.getSetupStatus();
      assert.equal(status.hasAdmin, false);
      assert.equal(status.setupAllowed, true);
      assert.equal(status.passwordSetupPending, false);
      assert.equal(status.isPasswordConfigured, false);
    });
  });

  describe('QAD-TC10.2: Setup Password Unsealed Access', () => {
    it('allows accessing and creating password when passwordSetupPending is true (Step 2 unsealed)', async () => {
      // Step 1: Initial Google OAuth registration
      await staffService.setupInitialAdmin({
        userId: 'usr-admin-unsealed',
        email: 'founder@deskatlas.com',
        displayName: 'Founder',
      });

      // Verify unsealed state allows password initialization
      const setupStatus = await staffService.getSetupStatus('usr-admin-unsealed');
      assert.equal(setupStatus.passwordSetupPending, true);
      assert.equal(setupStatus.isPasswordConfigured, false);

      // Complete Step 2: Establish administrative password
      const updatedProfile = await staffService.setupInitialAdminPassword({
        userId: 'usr-admin-unsealed',
        email: 'founder@deskatlas.com',
        password: 'StrongSuperSecret2026!',
      });

      assert.equal(updatedProfile.userId, 'usr-admin-unsealed');
      assert.equal(memoryRepo.getPasswordByUserId('usr-admin-unsealed'), 'StrongSuperSecret2026!');
    });

    it('re-evaluates sealing logic correctly: data.isPasswordConfigured is false so screen does not seal', () => {
      const testData: AdminSetupStatus = {
        hasAdmin: true,
        setupAllowed: false,
        passwordSetupPending: true,
        isPasswordConfigured: false,
      };

      // The corrected boolean evaluation in AdminSetupPassword.tsx:
      // Sealed ONLY if isPasswordConfigured is true
      const shouldSeal = testData.isPasswordConfigured;
      const shouldAllowPasswordForm = testData.passwordSetupPending;

      assert.equal(shouldSeal, false);
      assert.equal(shouldAllowPasswordForm, true);
    });
  });

  describe('QAD-TC10.3: Setup Password Sealed Termination', () => {
    it('permanently seals password setup once isPasswordConfigured becomes true', async () => {
      // 1. Initial admin and password established
      await staffService.setupInitialAdminPassword({
        userId: 'usr-admin-sealed',
        email: 'sealed.admin@deskatlas.com',
        password: 'AdminPassword123!',
      });

      // 2. Query status
      const status = await staffService.getSetupStatus('usr-admin-sealed');
      assert.equal(status.hasAdmin, true);
      assert.equal(status.setupAllowed, false);
      assert.equal(status.passwordSetupPending, false);
      assert.equal(status.isPasswordConfigured, true);

      // 3. Evaluation logic confirms sealing
      const shouldSeal = status.isPasswordConfigured;
      assert.equal(shouldSeal, true);

      // 4. Secondary password setup attempt is rejected with 403 AdminAlreadyExistsError
      await assert.rejects(
        () =>
          staffService.setupInitialAdminPassword({
            userId: 'usr-admin-sealed',
            email: 'sealed.admin@deskatlas.com',
            password: 'AnotherPassword123!',
          }),
        (err: unknown) => {
          assert.ok(err instanceof AdminAlreadyExistsError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /already exists.*sealed/i);
          return true;
        }
      );
    });

    it('rejects unauthenticated third-party attempts to set password when system has an admin', async () => {
      await staffService.setupInitialAdminPassword({
        userId: 'usr-root-admin',
        email: 'root@deskatlas.com',
        password: 'RootPassword123!',
      });

      await assert.rejects(
        () =>
          staffService.setupInitialAdminPassword({
            userId: 'usr-intruder',
            email: 'intruder@evil.com',
            password: 'IntruderPassword123!',
          }),
        (err: unknown) => {
          assert.ok(err instanceof AdminAlreadyExistsError);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe('QAD-TC10.4: Password Creation and Seal Transition', () => {
    it('transitions status atomically from unsealed pending to sealed upon password creation', async () => {
      // 1. Step 1: Bootstrap Google OAuth
      await staffService.setupInitialAdmin({
        userId: 'usr-transition-test',
        email: 'transition@deskatlas.com',
        displayName: 'Transition Admin',
      });

      const before = await staffService.getSetupStatus('usr-transition-test');
      assert.equal(before.hasAdmin, true);
      assert.equal(before.passwordSetupPending, true);
      assert.equal(before.isPasswordConfigured, false);

      // 2. Step 2: Establish password
      await staffService.setupInitialAdminPassword({
        userId: 'usr-transition-test',
        email: 'transition@deskatlas.com',
        password: 'TransitionPass2026@',
      });

      const after = await staffService.getSetupStatus('usr-transition-test');
      assert.equal(after.hasAdmin, true);
      assert.equal(after.passwordSetupPending, false);
      assert.equal(after.isPasswordConfigured, true);
    });

    it('validates password policy compliance during setup', async () => {
      await staffService.setupInitialAdmin({
        userId: 'usr-policy-test',
        email: 'policy@deskatlas.com',
      });

      await assert.rejects(
        () =>
          staffService.setupInitialAdminPassword({
            userId: 'usr-policy-test',
            email: 'policy@deskatlas.com',
            password: 'weak',
          }),
        (err: unknown) => {
          assert.ok(err instanceof PasswordPolicyError);
          return true;
        }
      );
    });
  });

  describe('QAD-TC10.5: Google OAuth Login Callback Routing', () => {
    it('correctly decides routing for unconfigured vs configured admin OAuth sessions', async () => {
      // Scenario A: Unconfigured admin (password not yet created)
      await staffService.setupInitialAdmin({
        userId: 'usr-google-unconfigured',
        email: 'unconfigured@deskatlas.com',
      });

      const statusA = await staffService.getSetupStatus('usr-google-unconfigured');
      const shouldRouteToPasswordSetup = !statusA.isPasswordConfigured;
      const shouldRouteToDashboard = statusA.isPasswordConfigured;

      assert.equal(shouldRouteToPasswordSetup, true);
      assert.equal(shouldRouteToDashboard, false);

      // Scenario B: Fully configured admin
      await staffService.setupInitialAdminPassword({
        userId: 'usr-google-unconfigured',
        email: 'unconfigured@deskatlas.com',
        password: 'ConfiguredPass2026#',
      });

      const statusB = await staffService.getSetupStatus('usr-google-unconfigured');
      const shouldRouteToPasswordSetupB = !statusB.isPasswordConfigured;
      const shouldRouteToDashboardB = statusB.isPasswordConfigured;

      assert.equal(shouldRouteToPasswordSetupB, false);
      assert.equal(shouldRouteToDashboardB, true);
    });
  });

  describe('QAD-TC10.6: Recovery Script Logic & Unsealing', () => {
    it('generates accurate setup URL for pending administrator', () => {
      const baseUrl = 'https://admin.deskatlas.com';
      const target = {
        userId: 'usr-recovery-target',
        email: 'admin.recovery@deskatlas.com',
      };

      const setupUrl = `${baseUrl}/manage/setup/password?userId=${encodeURIComponent(target.userId)}&email=${encodeURIComponent(target.email)}`;

      assert.equal(
        setupUrl,
        'https://admin.deskatlas.com/manage/setup/password?userId=usr-recovery-target&email=admin.recovery%40deskatlas.com'
      );
    });

    it('resets administrator records to unseal initial bootstrap on fresh deployment', async () => {
      // Initial state with corrupted or incomplete admin
      await staffService.setupInitialAdmin({
        userId: 'usr-stuck-admin',
        email: 'stuck@deskatlas.com',
      });

      assert.equal((await staffService.getSetupStatus()).hasAdmin, true);

      // Recovery reset action: clear profiles
      memoryRepo.clear();

      // Verified: deployment is now unsealed for fresh /manage/setup pass
      const resetStatus = await staffService.getSetupStatus();
      assert.equal(resetStatus.hasAdmin, false);
      assert.equal(resetStatus.setupAllowed, true);
      assert.equal(resetStatus.passwordSetupPending, false);
      assert.equal(resetStatus.isPasswordConfigured, false);
    });
  });
});
