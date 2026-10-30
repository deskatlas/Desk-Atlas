/**
 * Supabase PostgreSQL Customer Email Change Repository
 * Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C13, SDD-C15, ERD-E15, ERD-E23, QAD-TC22, QAD-TC36
 */

import { normalizeEmail } from '@deskatlas/validation';
import type {
  CustomerEmailChangeRepository,
  CustomerEmailOtpRecord,
  CustomerEmailChangeRequestRecord,
  ConfirmEmailChangeResult,
} from './customerEmailChangeRepository';

export interface CustomerEmailChangeSupabaseConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
}

interface RawOtpRow {
  id: string;
  customer_id: string;
  current_email: string;
  otp_hash: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  consumed_at: string | null;
  created_at: string;
}

interface RawRequestRow {
  id: string;
  customer_id: string;
  old_email: string;
  new_email: string;
  confirmation_token_hash: string;
  expires_at: string;
  confirmed_at: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  created_at: string;
}

interface RawConfirmRpcResult {
  success: boolean;
  customer_id: string | null;
  customer_code: string | null;
  old_email: string | null;
  new_email: string | null;
  error_code: string | null;
}

export class CustomerEmailChangeSupabaseRepository implements CustomerEmailChangeRepository {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetcher: typeof fetch;

  constructor(config: CustomerEmailChangeSupabaseConfig) {
    this.supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
    this.fetcher = config.fetcher || fetch;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.supabaseUrl}/rest/v1${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const headers: Record<string, string> = {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const response = await this.fetcher(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  async createOtp(data: {
    customerId: string;
    currentEmail: string;
    otpHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<CustomerEmailOtpRecord> {
    const payload = {
      customer_id: data.customerId,
      current_email: normalizeEmail(data.currentEmail),
      otp_hash: data.otpHash,
      expires_at: data.expiresAt,
      max_attempts: data.maxAttempts ?? 5,
    };

    const rows = await this.request<RawOtpRow[]>('/customer_email_change_otps', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    const row = rows[0];
    return {
      id: row.id,
      customerId: row.customer_id,
      currentEmail: row.current_email,
      otpHash: row.otp_hash,
      expiresAt: row.expires_at,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
    };
  }

  async findActiveOtp(email: string): Promise<CustomerEmailOtpRecord | null> {
    const normalized = normalizeEmail(email);
    const rows = await this.request<RawOtpRow[]>(
      `/customer_email_change_otps?current_email=eq.${encodeURIComponent(normalized)}&consumed_at=is.null&order=created_at.desc&limit=1`
    );

    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      customerId: row.customer_id,
      currentEmail: row.current_email,
      otpHash: row.otp_hash,
      expiresAt: row.expires_at,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
    };
  }

  async incrementOtpAttempts(id: string): Promise<{ attempts: number; maxAttempts: number; consumed: boolean }> {
    const rows = await this.request<RawOtpRow[]>(`/customer_email_change_otps?id=eq.${id}&limit=1`);
    if (!rows || rows.length === 0) {
      throw new Error(`OTP record ${id} not found`);
    }

    const row = rows[0];
    const newAttempts = row.attempts + 1;
    const consumed = newAttempts >= row.max_attempts;

    await this.request(`/customer_email_change_otps?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        attempts: newAttempts,
        consumed_at: consumed ? new Date().toISOString() : null,
      }),
    });

    return {
      attempts: newAttempts,
      maxAttempts: row.max_attempts,
      consumed,
    };
  }

  async consumeOtp(id: string): Promise<void> {
    await this.request(`/customer_email_change_otps?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        consumed_at: new Date().toISOString(),
      }),
    });
  }

  async createChangeRequest(data: {
    customerId: string;
    oldEmail: string;
    newEmail: string;
    confirmationTokenHash: string;
    expiresAt: string;
  }): Promise<CustomerEmailChangeRequestRecord> {
    const payload = {
      customer_id: data.customerId,
      old_email: normalizeEmail(data.oldEmail),
      new_email: normalizeEmail(data.newEmail),
      confirmation_token_hash: data.confirmationTokenHash,
      expires_at: data.expiresAt,
    };

    const rows = await this.request<RawRequestRow[]>('/customer_email_change_requests', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    const row = rows[0];
    return {
      id: row.id,
      customerId: row.customer_id,
      oldEmail: row.old_email,
      newEmail: row.new_email,
      confirmationTokenHash: row.confirmation_token_hash,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  async findChangeRequestByTokenHash(tokenHash: string): Promise<CustomerEmailChangeRequestRecord | null> {
    const rows = await this.request<RawRequestRow[]>(
      `/customer_email_change_requests?confirmation_token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`
    );

    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      customerId: row.customer_id,
      oldEmail: row.old_email,
      newEmail: row.new_email,
      confirmationTokenHash: row.confirmation_token_hash,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  async confirmEmailChange(tokenHash: string): Promise<ConfirmEmailChangeResult> {
    const rows = await this.request<RawConfirmRpcResult[]>('/rpc/confirm_customer_email_change', {
      method: 'POST',
      body: JSON.stringify({ p_token_hash: tokenHash }),
    });

    if (!rows || rows.length === 0) {
      return { success: false, errorCode: 'RPC_FAILED' };
    }

    const res = rows[0];
    if (!res.success) {
      return { success: false, errorCode: res.error_code || 'CONFIRMATION_FAILED' };
    }

    return {
      success: true,
      customerId: res.customer_id || undefined,
      customerCode: res.customer_code || undefined,
      oldEmail: res.old_email || undefined,
      newEmail: res.new_email || undefined,
    };
  }
}

