/**
 * Customer Identity Email Change Repository Interface
 * Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C13, SDD-C15, ERD-E15, ERD-E23, QAD-TC22, QAD-TC36
 */

export interface CustomerEmailOtpRecord {
  id: string;
  customerId: string;
  currentEmail: string;
  otpHash: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  createdAt: string;
}

export interface CustomerEmailChangeRequestRecord {
  id: string;
  customerId: string;
  oldEmail: string;
  newEmail: string;
  confirmationTokenHash: string;
  expiresAt: string;
  confirmedAt: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
}

export interface ConfirmEmailChangeResult {
  success: boolean;
  customerId?: string;
  customerCode?: string;
  oldEmail?: string;
  newEmail?: string;
  errorCode?: string;
}

export interface CustomerEmailChangeRepository {
  createOtp(data: {
    customerId: string;
    currentEmail: string;
    otpHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<CustomerEmailOtpRecord>;

  findActiveOtp(email: string): Promise<CustomerEmailOtpRecord | null>;

  incrementOtpAttempts(id: string): Promise<{ attempts: number; maxAttempts: number; consumed: boolean }>;

  consumeOtp(id: string): Promise<void>;

  createChangeRequest(data: {
    customerId: string;
    oldEmail: string;
    newEmail: string;
    confirmationTokenHash: string;
    expiresAt: string;
  }): Promise<CustomerEmailChangeRequestRecord>;

  findChangeRequestByTokenHash(tokenHash: string): Promise<CustomerEmailChangeRequestRecord | null>;

  confirmEmailChange(tokenHash: string): Promise<ConfirmEmailChangeResult>;
}

