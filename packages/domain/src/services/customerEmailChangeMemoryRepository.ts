/**
 * In-Memory Customer Email Change Repository
 * Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C13, SDD-C15, ERD-E15, ERD-E23, QAD-TC22, QAD-TC36
 */

import { randomUUID } from 'crypto';
import { normalizeEmail } from '@deskatlas/validation';
import type {
  CustomerEmailChangeRepository,
  CustomerEmailOtpRecord,
  CustomerEmailChangeRequestRecord,
  ConfirmEmailChangeResult,
} from './customerEmailChangeRepository';
import type { CustomerRepository } from './customerRepository';

export class CustomerEmailChangeMemoryRepository implements CustomerEmailChangeRepository {
  private otps: Map<string, CustomerEmailOtpRecord> = new Map();
  private requests: Map<string, CustomerEmailChangeRequestRecord> = new Map();

  constructor(
    private readonly customerRepo?: CustomerRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async createOtp(data: {
    customerId: string;
    currentEmail: string;
    otpHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<CustomerEmailOtpRecord> {
    const record: CustomerEmailOtpRecord = {
      id: randomUUID(),
      customerId: data.customerId,
      currentEmail: normalizeEmail(data.currentEmail),
      otpHash: data.otpHash,
      expiresAt: data.expiresAt,
      attempts: 0,
      maxAttempts: data.maxAttempts ?? 5,
      consumedAt: null,
      createdAt: this.nowProvider().toISOString(),
    };

    this.otps.set(record.id, record);
    return { ...record };
  }

  async findActiveOtp(email: string): Promise<CustomerEmailOtpRecord | null> {
    const normalized = normalizeEmail(email);
    const now = this.nowProvider().getTime();

    // Find latest active OTP for normalized email
    const candidates = Array.from(this.otps.values())
      .filter((o) => o.currentEmail === normalized && o.consumedAt === null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (candidates.length === 0) return null;
    const latest = candidates[0];
    if (new Date(latest.expiresAt).getTime() <= now) {
      return null;
    }
    return { ...latest };
  }

  async incrementOtpAttempts(id: string): Promise<{ attempts: number; maxAttempts: number; consumed: boolean }> {
    const otp = this.otps.get(id);
    if (!otp) {
      throw new Error(`OTP record ${id} not found`);
    }

    otp.attempts += 1;
    let consumed = false;
    if (otp.attempts >= otp.maxAttempts) {
      otp.consumedAt = this.nowProvider().toISOString();
      consumed = true;
    }

    return {
      attempts: otp.attempts,
      maxAttempts: otp.maxAttempts,
      consumed,
    };
  }

  async consumeOtp(id: string): Promise<void> {
    const otp = this.otps.get(id);
    if (otp) {
      otp.consumedAt = this.nowProvider().toISOString();
    }
  }

  async createChangeRequest(data: {
    customerId: string;
    oldEmail: string;
    newEmail: string;
    confirmationTokenHash: string;
    expiresAt: string;
  }): Promise<CustomerEmailChangeRequestRecord> {
    const record: CustomerEmailChangeRequestRecord = {
      id: randomUUID(),
      customerId: data.customerId,
      oldEmail: normalizeEmail(data.oldEmail),
      newEmail: normalizeEmail(data.newEmail),
      confirmationTokenHash: data.confirmationTokenHash,
      expiresAt: data.expiresAt,
      confirmedAt: null,
      status: 'PENDING',
      createdAt: this.nowProvider().toISOString(),
    };

    this.requests.set(record.id, record);
    return { ...record };
  }

  async findChangeRequestByTokenHash(tokenHash: string): Promise<CustomerEmailChangeRequestRecord | null> {
    for (const req of this.requests.values()) {
      if (req.confirmationTokenHash === tokenHash) {
        return { ...req };
      }
    }
    return null;
  }

  async confirmEmailChange(tokenHash: string): Promise<ConfirmEmailChangeResult> {
    const now = this.nowProvider().getTime();
    let targetReq: CustomerEmailChangeRequestRecord | null = null;

    for (const req of this.requests.values()) {
      if (req.confirmationTokenHash === tokenHash) {
        targetReq = req;
        break;
      }
    }

    if (!targetReq) {
      return { success: false, errorCode: 'TOKEN_NOT_FOUND' };
    }

    if (targetReq.status !== 'PENDING') {
      return { success: false, errorCode: 'ALREADY_PROCESSED' };
    }

    if (new Date(targetReq.expiresAt).getTime() <= now) {
      targetReq.status = 'EXPIRED';
      return { success: false, errorCode: 'TOKEN_EXPIRED' };
    }

    if (this.customerRepo) {
      // Check collision
      const existing = await this.customerRepo.findCustomerByEmail(targetReq.newEmail);
      if (existing && existing.id !== targetReq.customerId) {
        return { success: false, errorCode: 'EMAIL_COLLISION' };
      }

      const customer = await this.customerRepo.findCustomerById(targetReq.customerId);
      if (!customer) {
        return { success: false, errorCode: 'CUSTOMER_NOT_FOUND' };
      }

      if (this.customerRepo.updateCustomerEmail) {
        await this.customerRepo.updateCustomerEmail(targetReq.customerId, targetReq.newEmail);
      }

      targetReq.status = 'CONFIRMED';
      targetReq.confirmedAt = this.nowProvider().toISOString();

      return {
        success: true,
        customerId: customer.id,
        customerCode: customer.customerCode,
        oldEmail: targetReq.oldEmail,
        newEmail: targetReq.newEmail,
      };
    }

    targetReq.status = 'CONFIRMED';
    targetReq.confirmedAt = this.nowProvider().toISOString();

    return {
      success: true,
      customerId: targetReq.customerId,
      oldEmail: targetReq.oldEmail,
      newEmail: targetReq.newEmail,
    };
  }
}

