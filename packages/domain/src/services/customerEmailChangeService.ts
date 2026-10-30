/**
 * Customer Identity Email Change Domain Service
 * Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C1, SDD-C13, SDD-C15, ERD-E15, ERD-E23, QAD-TC22, QAD-TC36
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  normalizeEmail,
  requestEmailChangeOtpSchema,
  verifyEmailChangeOtpSchema,
  initiateEmailChangeSchema,
  confirmEmailChangeSchema,
} from '@deskatlas/validation';
import type { CustomerEmailChangeRepository } from './customerEmailChangeRepository';
import type { CustomerRepository } from './customerRepository';
import type { RateLimiterService } from './rateLimiterService';
import type { TransactionalEmailService } from './transactionalEmailService';
import { maskEmail } from './transactionalEmailService';

export class EmailChangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EmailChangeError';
  }
}

interface VerificationTokenPayload {
  customerId: string;
  customerCode: string;
  currentEmail: string;
  purpose: 'EMAIL_TRANSFER';
  exp: number;
}

export class CustomerEmailChangeService {
  constructor(
    private readonly repository: CustomerEmailChangeRepository,
    private readonly customerRepo: CustomerRepository,
    private readonly rateLimiterService: RateLimiterService,
    private readonly emailService: TransactionalEmailService,
    private readonly tokenSecret: string = process.env.CUSTOMER_EMAIL_CHANGE_SECRET ||
      process.env.REWARDS_RATE_LIMIT_SECRET ||
      'deskatlas_email_change_secret_key',
    private readonly nowProvider: () => Date = () => new Date()
  ) { }

  private signVerificationToken(payload: VerificationTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.tokenSecret).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  private verifyVerificationToken(token: string): VerificationTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new EmailChangeError('INVALID_TOKEN', 'Verification token is required.');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new EmailChangeError('INVALID_TOKEN', 'Verification token format is invalid.');
    }

    const [encodedPayload, signature] = parts;
    const expectedSignature = createHmac('sha256', this.tokenSecret).update(encodedPayload).digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedSigBuf.length || !timingSafeEqual(sigBuf, expectedSigBuf)) {
      throw new EmailChangeError('INVALID_TOKEN', 'Verification token signature is invalid.');
    }

    let payload: VerificationTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      throw new EmailChangeError('INVALID_TOKEN', 'Verification token payload cannot be parsed.');
    }

    if (payload.purpose !== 'EMAIL_TRANSFER') {
      throw new EmailChangeError('INVALID_TOKEN', 'Verification token purpose is invalid.');
    }

    if (!payload.exp || payload.exp <= this.nowProvider().getTime()) {
      throw new EmailChangeError('TOKEN_EXPIRED', 'Verification session has expired. Please verify your email again.');
    }

    return payload;
  }

  async requestOtp(params: {
    email: string;
    clientIp?: string;
  }): Promise<{ success: boolean; message: string }> {
    const validation = requestEmailChangeOtpSchema.safeParse({ email: params.email });
    if (!validation.success) {
      throw new EmailChangeError(
        'INVALID_INPUT',
        validation.error.errors[0]?.message || 'Please enter a valid email address.'
      );
    }

    const normalizedEmail = normalizeEmail(params.email);

    // Consume rate limit for OTP requests (3 per 10 minutes)
    await this.rateLimiterService.assertAllowed('EMAIL_CHANGE_OTP', normalizedEmail);

    // Check customer exists for email
    const customer = await this.customerRepo.findCustomerByEmail(normalizedEmail);
    if (!customer) {
      throw new EmailChangeError(
        'NO_CUSTOMER_FOUND',
        'No Customer ID is bound to this email address.'
      );
    }

    // Generate secure 6-digit numeric OTP (100000 to 999999)
    const otpBuffer = randomBytes(4);
    const numericCode = 100000 + (otpBuffer.readUInt32BE(0) % 900000);
    const otpCode = String(numericCode);

    // Hash OTP with server secret/pepper
    const otpHash = createHmac('sha256', this.tokenSecret).update(otpCode).digest('hex');

    // 5-minute lifespan (300 seconds)
    const expiresAt = new Date(this.nowProvider().getTime() + 5 * 60 * 1000).toISOString();

    await this.repository.createOtp({
      customerId: customer.id,
      currentEmail: normalizedEmail,
      otpHash,
      expiresAt,
      maxAttempts: 5,
    });

    // Enqueue/dispatch transactional email
    await this.emailService.sendEmailChangeOtpEmail({
      to: normalizedEmail,
      customerCode: customer.customerCode,
      otpCode,
    });

    return {
      success: true,
      message: 'A 6-digit verification code has been sent to your email.',
    };
  }

  async verifyOtp(params: {
    email: string;
    otp: string;
    clientIp?: string;
  }): Promise<{
    success: boolean;
    customerCode: string;
    verificationToken: string;
  }> {
    const validation = verifyEmailChangeOtpSchema.safeParse({
      email: params.email,
      otp: params.otp,
    });

    if (!validation.success) {
      throw new EmailChangeError(
        'INVALID_INPUT',
        validation.error.errors[0]?.message || 'Invalid email or verification code format.'
      );
    }

    const normalizedEmail = normalizeEmail(params.email);

    // Check rate limit on OTP verification (5 attempts per 5 minutes)
    await this.rateLimiterService.assertAllowed('EMAIL_CHANGE_VERIFY', normalizedEmail);

    const activeOtp = await this.repository.findActiveOtp(normalizedEmail);
    if (!activeOtp || new Date(activeOtp.expiresAt).getTime() <= this.nowProvider().getTime()) {
      throw new EmailChangeError('OTP_EXPIRED', 'Verification code has expired. Please request a new code.');
    }

    const submittedHash = createHmac('sha256', this.tokenSecret).update(params.otp.trim()).digest('hex');

    if (submittedHash !== activeOtp.otpHash) {
      const incrementResult = await this.repository.incrementOtpAttempts(activeOtp.id);
      const remainingAttempts = Math.max(0, incrementResult.maxAttempts - incrementResult.attempts);

      if (incrementResult.consumed) {
        throw new EmailChangeError(
          'OTP_LOCKED',
          'Too many failed verification attempts. This code is now invalid. Please request a new one.',
          { remainingAttempts: 0 }
        );
      }

      throw new EmailChangeError(
        'INVALID_OTP',
        `Invalid verification code. Please check and try again. (${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining)`,
        { remainingAttempts }
      );
    }

    // Code matches: mark consumed
    await this.repository.consumeOtp(activeOtp.id);

    // Look up verified customer
    const customer = await this.customerRepo.findCustomerById(activeOtp.customerId);
    if (!customer) {
      throw new EmailChangeError('CUSTOMER_NOT_FOUND', 'Customer profile could not be found.');
    }

    // Issue short-lived verification token (15 minutes validity)
    const exp = this.nowProvider().getTime() + 15 * 60 * 1000;
    const verificationToken = this.signVerificationToken({
      customerId: customer.id,
      customerCode: customer.customerCode,
      currentEmail: normalizedEmail,
      purpose: 'EMAIL_TRANSFER',
      exp,
    });

    return {
      success: true,
      customerCode: customer.customerCode,
      verificationToken,
    };
  }

  async initiateTransfer(params: {
    verificationToken: string;
    newEmail: string;
    rewardsPortalUrl?: string;
    clientIp?: string;
  }): Promise<{
    success: boolean;
    isCollision: boolean;
    message: string;
  }> {
    const validation = initiateEmailChangeSchema.safeParse({
      verificationToken: params.verificationToken,
      newEmail: params.newEmail,
    });

    if (!validation.success) {
      throw new EmailChangeError(
        'INVALID_INPUT',
        validation.error.errors[0]?.message || 'Please enter a valid new email address.'
      );
    }

    const payload = this.verifyVerificationToken(params.verificationToken);
    const normalizedNewEmail = normalizeEmail(params.newEmail);

    if (normalizedNewEmail === payload.currentEmail) {
      throw new EmailChangeError('SAME_EMAIL', 'New email must be different from your current email.');
    }

    // Rate limit check: 3 change requests per hour
    await this.rateLimiterService.assertAllowed('EMAIL_CHANGE_INITIATE', payload.currentEmail);

    // Collision Guard Check: check if proposed new email is already bound to another customer
    const existing = await this.customerRepo.findCustomerByEmail(normalizedNewEmail);
    if (existing) {
      throw new EmailChangeError(
        'EMAIL_ALREADY_BOUND',
        'This email address is already bound to another Customer ID.',
        { canProceedToForgotId: true }
      );
    }

    // Generate cryptographic 256-bit confirmation token (32 bytes hex)
    const confirmationToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(confirmationToken).digest('hex');

    // 24-hour expiration
    const expiresAt = new Date(this.nowProvider().getTime() + 24 * 60 * 60 * 1000).toISOString();

    await this.repository.createChangeRequest({
      customerId: payload.customerId,
      oldEmail: payload.currentEmail,
      newEmail: normalizedNewEmail,
      confirmationTokenHash: tokenHash,
      expiresAt,
    });

    // Enqueue transactional confirmation email to new email address
    const baseUrl = params.rewardsPortalUrl?.replace(/\/$/, '') || 'http://localhost:3000';
    const confirmationUrl = `${baseUrl}/track/confirm-email-change?token=${confirmationToken}`;

    await this.emailService.sendEmailChangeConfirmationEmail({
      to: normalizedNewEmail,
      customerCode: payload.customerCode,
      confirmationUrl,
      newEmail: normalizedNewEmail,
    });

    return {
      success: true,
      isCollision: false,
      message: 'Confirmation link sent to new email address.',
    };
  }

  async confirmTransfer(params: {
    token: string;
    rewardsPortalUrl?: string;
  }): Promise<{
    success: boolean;
    customerCode: string;
    newEmail: string;
    oldEmail: string;
  }> {
    const validation = confirmEmailChangeSchema.safeParse({ token: params.token });
    if (!validation.success) {
      throw new EmailChangeError('INVALID_INPUT', 'Confirmation token is required.');
    }

    const tokenHash = createHash('sha256').update(params.token.trim()).digest('hex');

    const result = await this.repository.confirmEmailChange(tokenHash);

    if (!result.success) {
      if (
        result.errorCode === 'TOKEN_NOT_FOUND' ||
        result.errorCode === 'ALREADY_PROCESSED' ||
        result.errorCode === 'TOKEN_EXPIRED'
      ) {
        throw new EmailChangeError(
          result.errorCode,
          'This confirmation link has expired or has already been used.'
        );
      }
      if (result.errorCode === 'EMAIL_COLLISION') {
        throw new EmailChangeError(
          'EMAIL_COLLISION',
          'The destination email was claimed by another customer before confirmation completed.'
        );
      }
      throw new EmailChangeError('CONFIRMATION_FAILED', 'Unable to confirm email change.');
    }

    const { customerCode, newEmail, oldEmail } = result;

    if (!customerCode || !newEmail || !oldEmail) {
      throw new EmailChangeError('CONFIRMATION_FAILED', 'Confirmation result data is incomplete.');
    }

    const baseUrl = params.rewardsPortalUrl?.replace(/\/$/, '') || 'http://localhost:3000';
    const portalUrl = `${baseUrl}/track/rewards`;

    // Dispatch dual transactional emails
    // 1. Security Alert to old email
    try {
      await this.emailService.sendEmailChangePastEmailNotice({
        to: oldEmail,
        customerCode,
        maskedNewEmail: maskEmail(newEmail),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[CustomerEmailChangeService] Failed to send old email notice:', msg);
    }

    // 2. Welcome Confirmation to new email
    try {
      await this.emailService.sendEmailChangeNewEmailNotice({
        to: newEmail,
        customerCode,
        portalUrl,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[CustomerEmailChangeService] Failed to send new email notice:', msg);
    }

    return {
      success: true,
      customerCode,
      newEmail,
      oldEmail,
    };
  }
}

