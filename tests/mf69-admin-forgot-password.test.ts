import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdminPasswordResetError,
  AdminPasswordResetService,
  InMemoryAdminPasswordResetRepository,
  renderAdminPasswordResetEmail,
  TransactionalEmailService,
} from '@deskatlas/domain';

describe('MF-69: Super Admin Forgot Password & Password Reset Flow', () => {
  let repository: InMemoryAdminPasswordResetRepository;
  let emailService: TransactionalEmailService;
  let sentEmails: any[] = [];
  let currentTime: Date;

  beforeEach(() => {
    currentTime = new Date('2026-09-11T12:00:00.000Z');
    sentEmails = [];

    // Mock fetcher for email service to capture outbound emails
    const mockFetcher = async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        sentEmails.push(JSON.parse(String(init.body)));
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'mock-email-123' }),
        json: async () => ({ id: 'mock-email-123' }),
      } as any;
    };

    emailService = new TransactionalEmailService({
      apiKey: 'test-resend-key',
      fromEmail: 'DeskAtlas <noreply@deskatlas.com>',
      fetcher: mockFetcher,
    });

    repository = new InMemoryAdminPasswordResetRepository([
      {
        userId: 'admin-user-001',
        email: 'admin@deskatlas.com',
        displayName: 'Super Admin',
        password: 'OldPassword123!',
      },
    ]);
  });

  function createService(time: Date = currentTime): AdminPasswordResetService {
    return new AdminPasswordResetService(repository, () => time, emailService);
  }

  describe('Password Recovery Request (Forgot Password)', () => {
    it('generates a secure reset token, creates pending record with 1-hour expiry, and sends reset email for active admin', async () => {
      const service = createService();
      const res = await service.requestPasswordReset({
        email: 'admin@deskatlas.com',
        resetBaseUrl: 'https://admin.deskatlas.com',
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('If an admin account is associated with this email address');
      expect(res.token).toBeDefined();
      expect(res.token?.startsWith('apr_')).toBe(true);
      expect(res.emailSent).toBe(true);

      // Verify repository record
      const record = await repository.findResetRecordByToken(res.token!);
      expect(record).not.toBeNull();
      expect(record?.userId).toBe('admin-user-001');
      expect(record?.email).toBe('admin@deskatlas.com');
      expect(record?.status).toBe('PENDING');
      expect(record?.expiresAt).toBe('2026-09-11T13:00:00.000Z'); // exactly 1 hour from 12:00

      // Verify email dispatch
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to).toEqual(['admin@deskatlas.com']);
      expect(sentEmails[0].subject).toBe('Reset Your DeskAtlas Admin Password');
      expect(sentEmails[0].html).toContain(res.token);
      expect(sentEmails[0].html).toContain('https://admin.deskatlas.com/manage/reset-password');
      expect(sentEmails[0].html).toContain('1-Hour Expiry');
    });

    it('enforces security anti-enumeration for unknown emails (returns generic success, creates no record, sends no email)', async () => {
      const service = createService();
      const res = await service.requestPasswordReset({
        email: 'nonexistent@deskatlas.com',
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('If an admin account is associated with this email address');
      expect(res.token).toBeUndefined();
      expect(res.emailSent).toBe(false);
      expect(sentEmails.length).toBe(0);
      expect(repository.resetRecords.size).toBe(0);
    });

    it('handles malformed emails gracefully without leaking info', async () => {
      const service = createService();
      const res = await service.requestPasswordReset({
        email: 'invalid-email-string',
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('If an admin account is associated with this email address');
      expect(res.token).toBeUndefined();
      expect(sentEmails.length).toBe(0);
    });
  });

  describe('Token Verification', () => {
    it('successfully validates a fresh, pending token', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      const verifyRes = await service.verifyPasswordResetToken(token);
      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.email).toBe('admin@deskatlas.com');
      expect(verifyRes.error).toBeUndefined();
    });

    it('rejects an unknown or empty token', async () => {
      const service = createService();
      const emptyRes = await service.verifyPasswordResetToken('');
      expect(emptyRes.valid).toBe(false);

      const unknownRes = await service.verifyPasswordResetToken('apr_invalid_token_123');
      expect(unknownRes.valid).toBe(false);
      expect(unknownRes.error).toContain('invalid or has expired');
    });

    it('rejects a token that has expired (> 1 hour)', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      // Advance time by 61 minutes
      const expiredTime = new Date('2026-09-11T13:01:00.000Z');
      const expiredService = createService(expiredTime);

      const verifyRes = await expiredService.verifyPasswordResetToken(token);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain('expired');
    });

    it('rejects a token that has already been used', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      // Complete reset once
      await service.completePasswordReset({
        token,
        newPassword: 'NewSecurePassword123!',
      });

      // Attempt to verify the same token again
      const verifyRes = await service.verifyPasswordResetToken(token);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain('already been used');
    });
  });

  describe('Password Reset Completion', () => {
    it('enforces MF-46 password policy and rejects weak passwords', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      // Short password
      await expect(
        service.completePasswordReset({
          token,
          newPassword: 'short',
        })
      ).rejects.toThrow(AdminPasswordResetError);

      // Missing uppercase / number / special
      await expect(
        service.completePasswordReset({
          token,
          newPassword: 'passwordonly',
        })
      ).rejects.toThrow(/Password does not meet security requirements/);
    });

    it('updates password, marks token USED, records audit log, and invalidates old credentials', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      const result = await service.completePasswordReset({
        token,
        newPassword: 'NewStrongPassword2026@#',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Password updated successfully');

      // Check record state
      const record = await repository.findResetRecordByToken(token);
      expect(record?.status).toBe('USED');
      expect(record?.usedAt).toBeDefined();

      // Check updated password in repository
      const account = await repository.findActiveAdminByEmail('admin@deskatlas.com');
      expect(account?.password).toBe('NewStrongPassword2026@#');

      // Check security audit log
      expect(repository.auditLogs.length).toBe(1);
      const audit = repository.auditLogs[0];
      expect(audit.actorUserId).toBe('admin-user-001');
      expect(audit.actorRole).toBe('ADMIN');
      expect(audit.action).toBe('ADMIN_PASSWORD_RESET');
      expect(audit.metadata.email).toBe('admin@deskatlas.com');
      expect(audit.metadata.method).toBe('password_reset_flow');
    });

    it('prevents resetting password with an expired token', async () => {
      const service = createService();
      const req = await service.requestPasswordReset({ email: 'admin@deskatlas.com' });
      const token = req.token!;

      const expiredTime = new Date('2026-09-11T13:05:00.000Z');
      const expiredService = createService(expiredTime);

      await expect(
        expiredService.completePasswordReset({
          token,
          newPassword: 'ValidNewPassword123!',
        })
      ).rejects.toThrow(/expired/);
    });
  });

  describe('Transactional Email Template Rendering', () => {
    it('renders clean HTML and plaintext email with 1-hour expiration and secure action URL', () => {
      const rendered = renderAdminPasswordResetEmail({
        to: 'admin@deskatlas.com',
        displayName: 'Super Administrator',
        resetUrl: 'https://admin.deskatlas.com/manage/reset-password?token=apr_test_123',
        expiresAt: '2026-09-11T13:00:00.000Z',
      });

      expect(rendered.subject).toBe('Reset Your DeskAtlas Admin Password');
      expect(rendered.html).toContain('Super Administrator');
      expect(rendered.html).toContain('https://admin.deskatlas.com/manage/reset-password?token=apr_test_123');
      expect(rendered.html).toContain('Reset Admin Password');
      expect(rendered.html).toContain('1-Hour Expiry');
      expect(rendered.text).toContain('https://admin.deskatlas.com/manage/reset-password?token=apr_test_123');
      expect(rendered.text).toContain('1 hour');
    });
  });
});
