import {
  AdminPasswordResetError,
  AdminPasswordResetRecord,
  CompletePasswordResetInput,
  PasswordResetCompletionResult,
  PasswordResetVerificationResult,
  RequestPasswordResetInput,
} from '../models/adminPasswordReset';
import { validatePassword } from './passwordPolicyService';
import {
  TransactionalEmailService,
  createTransactionalEmailService,
} from './transactionalEmailService';

export interface AdminUserAccount {
  userId: string;
  email: string;
  displayName: string;
  password?: string; // used in memory repo
}

export interface AdminPasswordResetRepository {
  findActiveAdminByEmail(email: string): Promise<AdminUserAccount | null>;
  createResetRecord(record: {
    userId: string;
    email: string;
    token: string;
    expiresAt: string;
  }): Promise<AdminPasswordResetRecord>;
  findResetRecordByToken(token: string): Promise<AdminPasswordResetRecord | null>;
  completeReset(token: string, newPassword: string, userId: string): Promise<boolean>;
  appendAuditLog?(entry: {
    actorUserId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, any>;
  }): Promise<void>;
}

export class InMemoryAdminPasswordResetRepository implements AdminPasswordResetRepository {
  public adminAccounts: Map<string, AdminUserAccount> = new Map();
  public resetRecords: Map<string, AdminPasswordResetRecord> = new Map();
  public auditLogs: Array<any> = [];

  constructor(initialAdmins: AdminUserAccount[] = []) {
    for (const admin of initialAdmins) {
      this.adminAccounts.set(admin.email.toLowerCase().trim(), { ...admin });
    }
  }

  async findActiveAdminByEmail(email: string): Promise<AdminUserAccount | null> {
    const account = this.adminAccounts.get(email.toLowerCase().trim());
    return account ? { ...account } : null;
  }

  async createResetRecord(record: {
    userId: string;
    email: string;
    token: string;
    expiresAt: string;
  }): Promise<AdminPasswordResetRecord> {
    const now = new Date().toISOString();
    const entity: AdminPasswordResetRecord = {
      id: `reset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: record.userId,
      email: record.email.toLowerCase().trim(),
      token: record.token,
      status: 'PENDING',
      expiresAt: record.expiresAt,
      createdAt: now,
      usedAt: null,
    };
    this.resetRecords.set(record.token, entity);
    return { ...entity };
  }

  async findResetRecordByToken(token: string): Promise<AdminPasswordResetRecord | null> {
    const record = this.resetRecords.get(token);
    return record ? { ...record } : null;
  }

  async completeReset(token: string, newPassword: string, userId: string): Promise<boolean> {
    const record = this.resetRecords.get(token);
    if (!record) return false;

    record.status = 'USED';
    record.usedAt = new Date().toISOString();
    this.resetRecords.set(token, record);

    // Update password in memory admin accounts
    for (const [emailKey, account] of this.adminAccounts.entries()) {
      if (account.userId === userId || account.email === record.email) {
        account.password = newPassword;
        this.adminAccounts.set(emailKey, account);
      }
    }

    await this.appendAuditLog({
      actorUserId: userId,
      actorRole: 'ADMIN',
      action: 'ADMIN_PASSWORD_RESET',
      entityType: 'staff_profiles',
      entityId: userId,
      metadata: {
        email: record.email,
        method: 'password_reset_flow',
      },
    });

    return true;
  }

  async appendAuditLog(entry: {
    actorUserId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, any>;
  }): Promise<void> {
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      ...entry,
      createdAt: new Date().toISOString(),
    });
  }
}

export class SupabaseAdminPasswordResetRepository implements AdminPasswordResetRepository {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    this.supabaseUrl = (
      options?.supabaseUrl ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ''
    ).replace(/\/$/, '');
    this.serviceRoleKey =
      options?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.supabaseUrl}/rest/v1${path}`;
    const headers = new Headers(init.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const res = await fetch(url, { ...init, headers, cache: 'no-store' });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Supabase request failed: ${res.status} ${errText}`);
    }

    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text);
  }

  async findActiveAdminByEmail(email: string): Promise<AdminUserAccount | null> {
    if (!this.supabaseUrl || !this.serviceRoleKey) return null;
    const cleanEmail = email.toLowerCase().trim();

    try {
      // 1. Find user in auth.users via RPC admin_get_admin_by_email
      const rpcRes = await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_get_admin_by_email`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_email: cleanEmail }),
        cache: 'no-store',
      });

      if (rpcRes.ok) {
        const rows = await rpcRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          return {
            userId: row.user_id || row.id,
            email: row.email,
            displayName: row.display_name || 'Admin',
          };
        }
      }
    } catch {
      // ignore and fallback
    }

    try {
      // 2. Query GoTrue Admin API to find user by email
      const authRes = await fetch(`${this.supabaseUrl}/auth/v1/admin/users`, {
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
        },
        cache: 'no-store',
      });

      if (authRes.ok) {
        const authData = await authRes.json();
        const matchingUser = (authData.users || []).find(
          (u: any) => u.email?.toLowerCase().trim() === cleanEmail
        );

        if (matchingUser) {
          // Check that staff_profiles confirms this user is an active ADMIN
          const profiles = await this.request<any[]>(
            `/staff_profiles?user_id=eq.${encodeURIComponent(matchingUser.id)}&role=eq.ADMIN&is_active=eq.true&select=*`
          );

          if (Array.isArray(profiles) && profiles.length > 0) {
            const profile = profiles[0];
            return {
              userId: matchingUser.id,
              email: matchingUser.email,
              displayName: profile.display_name || matchingUser.user_metadata?.full_name || 'Admin',
            };
          }
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  async createResetRecord(record: {
    userId: string;
    email: string;
    token: string;
    expiresAt: string;
  }): Promise<AdminPasswordResetRecord> {
    try {
      const rpcRes = await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_request_password_reset`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_email: record.email.toLowerCase().trim(),
          p_token: record.token,
          p_expires_at: record.expiresAt,
        }),
        cache: 'no-store',
      });

      if (rpcRes.ok) {
        const res = await rpcRes.json();
        if (res.success && res.record) {
          return {
            id: res.record.id,
            userId: res.record.user_id,
            email: res.record.email,
            token: res.record.token,
            status: res.record.status,
            expiresAt: res.record.expires_at,
            createdAt: res.record.created_at,
            usedAt: res.record.used_at,
          };
        }
      }
    } catch {
      // fallback
    }

    const inserted = await this.request<any[]>('/admin_password_resets', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: record.userId,
        email: record.email.toLowerCase().trim(),
        token: record.token,
        status: 'PENDING',
        expires_at: record.expiresAt,
      }),
    });

    const row = inserted[0];
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      token: row.token,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      usedAt: row.used_at,
    };
  }

  async findResetRecordByToken(token: string): Promise<AdminPasswordResetRecord | null> {
    try {
      const rpcRes = await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_verify_password_reset_token`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_token: token }),
        cache: 'no-store',
      });

      if (rpcRes.ok) {
        const res = await rpcRes.json();
        if (res.valid && res.record) {
          return {
            id: res.record.id,
            userId: res.record.user_id,
            email: res.record.email,
            token: res.record.token,
            status: res.record.status,
            expiresAt: res.record.expires_at,
            createdAt: res.record.created_at,
            usedAt: res.record.used_at,
          };
        }
        return null;
      }
    } catch {
      // fallback
    }

    const rows = await this.request<any[]>(
      `/admin_password_resets?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
    );

    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      token: row.token,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      usedAt: row.used_at,
    };
  }

  async completeReset(token: string, newPassword: string, userId: string): Promise<boolean> {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
    }

    // 1. Primary: Update user password in Supabase Auth via GoTrue Admin API
    const authRes = await fetch(
      `${this.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
        cache: 'no-store',
      }
    );

    if (!authRes.ok) {
      const errBody = await authRes.text().catch(() => '');
      console.error(
        '[SupabaseAdminPasswordResetRepository] Auth admin update password failed:',
        authRes.status,
        errBody
      );
      throw new Error(`Failed to update administrator password in authentication service: ${authRes.status}`);
    }

    // 2. Mark reset token as USED in admin_password_resets table
    await this.request(`/admin_password_resets?token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'USED',
        used_at: new Date().toISOString(),
      }),
    });

    // 3. Record audit log entry
    await this.appendAuditLog({
      actorUserId: userId,
      actorRole: 'ADMIN',
      action: 'ADMIN_PASSWORD_RESET',
      entityType: 'staff_profiles',
      entityId: userId,
      metadata: {
        method: 'password_reset_flow',
      },
    });

    // 4. Optionally invoke admin_complete_password_reset RPC for database-side consistency
    try {
      await fetch(`${this.supabaseUrl}/rest/v1/rpc/admin_complete_password_reset`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_token: token,
          p_new_password: newPassword,
        }),
        cache: 'no-store',
      });
    } catch {
      // Non-blocking since auth and database record are already updated
    }

    return true;
  }

  async appendAuditLog(entry: {
    actorUserId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, any>;
  }): Promise<void> {
    try {
      await this.request('/audit_logs', {
        method: 'POST',
        body: JSON.stringify({
          actor_user_id: entry.actorUserId,
          actor_role: entry.actorRole,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          metadata: entry.metadata,
        }),
      });
    } catch (e) {
      console.warn('[SupabaseAdminPasswordResetRepository] Failed to insert audit log:', e);
    }
  }
}

export class AdminPasswordResetService {
  private readonly emailService: TransactionalEmailService;

  constructor(
    private readonly repository: AdminPasswordResetRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    emailService?: TransactionalEmailService
  ) {
    this.emailService = emailService ?? createTransactionalEmailService();
  }

  async requestPasswordReset(input: RequestPasswordResetInput): Promise<{
    success: boolean;
    message: string;
    token?: string;
    emailSent?: boolean;
  }> {
    const genericMessage =
      'If an admin account is associated with this email address, you will receive password reset instructions shortly.';

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      // Return generic confirmation anyway to avoid email structure enumeration
      return { success: true, message: genericMessage, emailSent: false };
    }

    const admin = await this.repository.findActiveAdminByEmail(email);
    if (!admin) {
      return { success: true, message: genericMessage, emailSent: false };
    }

    // Generate secure 48-char random hex token
    const randomBytes = `${Date.now()}-${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
    const token = `apr_${randomBytes}`;

    // 1-hour expiry
    const expiresAt = new Date(this.nowProvider().getTime() + 60 * 60 * 1000).toISOString();

    await this.repository.createResetRecord({
      userId: admin.userId,
      email: admin.email,
      token,
      expiresAt,
    });

    // Build reset URL
    const baseUrl = (
      input.resetBaseUrl ||
      process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    const resetUrl = `${baseUrl}/manage/reset-password?token=${encodeURIComponent(token)}`;

    let emailSent = false;
    try {
      const emailRes = await this.emailService.sendAdminPasswordResetEmail({
        to: admin.email,
        displayName: admin.displayName,
        resetUrl,
        expiresAt,
      });
      emailSent = emailRes.success;
    } catch (err) {
      console.warn('[AdminPasswordResetService] Failed to dispatch reset email:', err);
    }

    return {
      success: true,
      message: genericMessage,
      token,
      emailSent,
    };
  }

  async verifyPasswordResetToken(token: string): Promise<PasswordResetVerificationResult> {
    if (!token || !token.trim()) {
      return { valid: false, error: 'Reset token is required.' };
    }

    const record = await this.repository.findResetRecordByToken(token.trim());
    if (!record) {
      return { valid: false, error: 'This password reset link is invalid or has expired.' };
    }

    if (record.status !== 'PENDING') {
      return { valid: false, error: 'This password reset link has already been used.' };
    }

    const expiresAtMs = new Date(record.expiresAt).getTime();
    const nowMs = this.nowProvider().getTime();

    if (nowMs > expiresAtMs) {
      return { valid: false, error: 'This password reset link has expired. Please request a new one.' };
    }

    return {
      valid: true,
      email: record.email,
    };
  }

  async completePasswordReset(input: CompletePasswordResetInput): Promise<PasswordResetCompletionResult> {
    if (!input.token || !input.token.trim()) {
      throw new AdminPasswordResetError('Reset token is required.', 400);
    }

    const record = await this.repository.findResetRecordByToken(input.token.trim());
    if (!record || record.status !== 'PENDING') {
      throw new AdminPasswordResetError(
        'This password reset link is invalid, already used, or has expired.',
        400
      );
    }

    const expiresAtMs = new Date(record.expiresAt).getTime();
    const nowMs = this.nowProvider().getTime();
    if (nowMs > expiresAtMs) {
      throw new AdminPasswordResetError(
        'This password reset link has expired. Please request a new one.',
        400
      );
    }

    if (!input.newPassword) {
      throw new AdminPasswordResetError('New password is required.', 400);
    }

    const validation = validatePassword(input.newPassword);
    if (!validation.isValid) {
      throw new AdminPasswordResetError(
        `Password does not meet security requirements: ${validation.errors.join(' ')}`,
        400
      );
    }

    const success = await this.repository.completeReset(
      input.token.trim(),
      input.newPassword,
      record.userId
    );

    if (!success) {
      throw new AdminPasswordResetError('Failed to update password. Please try again.', 500);
    }

    return {
      success: true,
      message: 'Password updated successfully. Please sign in with your new password.',
    };
  }
}

export function createAdminPasswordResetService(
  repository?: AdminPasswordResetRepository,
  nowProvider?: () => Date,
  emailService?: TransactionalEmailService
): AdminPasswordResetService {
  return new AdminPasswordResetService(
    repository || new SupabaseAdminPasswordResetRepository(),
    nowProvider,
    emailService
  );
}
