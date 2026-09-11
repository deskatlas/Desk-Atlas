export type PasswordResetStatus = 'PENDING' | 'USED' | 'EXPIRED';

export interface AdminPasswordResetRecord {
  id: string;
  userId: string;
  email: string;
  token: string;
  status: PasswordResetStatus;
  expiresAt: string;
  createdAt: string;
  usedAt?: string | null;
}

export interface RequestPasswordResetInput {
  email: string;
  resetBaseUrl?: string;
}

export interface PasswordResetVerificationResult {
  valid: boolean;
  email?: string;
  error?: string;
}

export interface CompletePasswordResetInput {
  token: string;
  newPassword: string;
}

export interface PasswordResetCompletionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export class AdminPasswordResetError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'AdminPasswordResetError';
  }
}
