import {
  ConfirmStaffInvitationInput,
  CreateStaffInput,
  CreateStaffInvitationInput,
  formatRelativeTime,
  getInitials,
  StaffDeletionCheckResult,
  StaffInvitation,
  StaffManagementAuthorizationError,
  StaffManagementConflictError,
  StaffManagementError,
  StaffMember,
  UpdateStaffInput,
} from '../models/staffManagement';
import { StaffManagementRepository } from './staffManagementRepository';

export class StaffManagementSupabaseRepository implements StaffManagementRepository {
  private readonly restUrl: string;
  private readonly authAdminUrl: string;
  private readonly serviceRoleKey: string;

  constructor(
    options?: { supabaseUrl?: string; serviceRoleKey?: string },
    private readonly nowProvider: () => Date = () => new Date()
  ) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for staff routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for staff routes');
    }

    const cleanBase = supabaseUrl.replace(/\/$/, '');
    this.restUrl = `${cleanBase}/rest/v1`;
    this.authAdminUrl = `${cleanBase}/auth/v1/admin`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      let errorMsg = `Supabase request failed (${response.status}): ${detail}`;
      try {
        const parsed = JSON.parse(detail);
        if (parsed.message) errorMsg = parsed.message;
        if (parsed.error) errorMsg = parsed.error;
      } catch {
        // ignore
      }

      if (response.status === 409 || errorMsg.toLowerCase().includes('already exists')) {
        throw new StaffManagementConflictError(errorMsg);
      }
      throw new StaffManagementError(errorMsg);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private mapRowToStaffMember(row: any): StaffMember {
    const now = this.nowProvider();
    const isActive = Boolean(row.is_active);
    const displayName = row.display_name ?? 'Unnamed Staff';
    const roleUpper = (row.role ?? 'STAFF').toUpperCase();
    const isRoleAdmin = roleUpper === 'ADMIN';
    const isSuperAdmin = Boolean(row.is_super_admin ?? (row.created_by_admin_id === null && isRoleAdmin));

    return {
      id: row.id ?? row.user_id,
      email: row.email ?? 'unknown@deskatlas.com',
      name: displayName,
      role: isRoleAdmin ? 'Admin' : 'Staff',
      rawRole: isRoleAdmin ? 'ADMIN' : 'STAFF',
      isActive,
      initials: getInitials(displayName),
      status: isActive ? 'Active' : 'Inactive',
      statusStyle: isActive
        ? { background: 'var(--da-info)', color: 'var(--da-brand-dark)' }
        : { background: 'var(--da-soft)', color: 'var(--da-brand-dark)' },
      mark: isActive ? '✓' : '!',
      lastActive: formatRelativeTime(row.last_sign_in_at ?? row.updated_at ?? row.created_at, now),
      createdAt: row.created_at ?? now.toISOString(),
      updatedAt: row.updated_at ?? now.toISOString(),
      createdByAdminId: row.created_by_admin_id ?? null,
      isSuperAdmin,
    };
  }

  async listStaff(actorUserId?: string, actorIsSuperAdmin?: boolean): Promise<StaffMember[]> {
    let isSuperAdmin = actorIsSuperAdmin;
    if (actorUserId && isSuperAdmin !== true) {
      try {
        const actorRows = await this.request<any[]>(
          `/staff_profiles?user_id=eq.${encodeURIComponent(actorUserId)}&select=role,created_by_admin_id,is_active&limit=1`
        );
        if (actorRows && actorRows.length > 0) {
          const ap = actorRows[0];
          if (ap.role?.toUpperCase() === 'ADMIN' && (ap.created_by_admin_id === null || ap.is_super_admin === true)) {
            isSuperAdmin = true;
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      // 1. Try RPC first
      const rows = await this.request<any[]>('/rpc/admin_list_staff', {
        method: 'POST',
        body: JSON.stringify({
          p_actor_user_id: actorUserId ?? null,
        }),
      });

      return rows
        .map((r) => this.mapRowToStaffMember(r))
        .sort((a, b) => {
          if (a.isSuperAdmin && !b.isSuperAdmin) return -1;
          if (!a.isSuperAdmin && b.isSuperAdmin) return 1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
    } catch (rpcErr) {
      if (rpcErr instanceof Error && rpcErr.message.includes('Only active ADMIN profiles')) {
        throw new StaffManagementAuthorizationError(rpcErr.message);
      }
      // 2. Fallback to direct REST table queries
      const endpoint = (isSuperAdmin || !actorUserId)
        ? '/staff_profiles?select=*&order=created_at.asc'
        : `/staff_profiles?or=(user_id.eq.${encodeURIComponent(actorUserId)},created_by_admin_id.eq.${encodeURIComponent(actorUserId)})&select=*&order=created_at.asc`;
      const profiles = await this.request<any[]>(endpoint);

      // Fetch users from auth admin if available
      let usersMap = new Map<string, { email?: string; last_sign_in_at?: string }>();
      try {
        const authRes = await fetch(`${this.authAdminUrl}/users?page=1&per_page=1000`, {
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
          },
          cache: 'no-store',
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          const users = authData.users ?? [];
          for (const u of users) {
            usersMap.set(u.id, { email: u.email, last_sign_in_at: u.last_sign_in_at });
          }
        }
      } catch {
        // auth admin fallback ignore
      }

      return profiles.map((p) => {
        const authUser = usersMap.get(p.user_id);
        return this.mapRowToStaffMember({
          id: p.user_id,
          email: authUser?.email,
          role: p.role,
          display_name: p.display_name,
          is_active: p.is_active,
          created_at: p.created_at,
          updated_at: p.updated_at,
          last_sign_in_at: authUser?.last_sign_in_at,
          created_by_admin_id: p.created_by_admin_id,
        });
      });
    }
  }

  async createStaff(input: CreateStaffInput): Promise<StaffMember> {
    try {
      // 1. Try RPC first
      const rows = await this.request<any[]>('/rpc/admin_create_staff', {
        method: 'POST',
        body: JSON.stringify({
          p_actor_user_id: input.actorUserId ?? null,
          p_email: input.email,
          p_password: input.password || 'DeskAtlas123!',
          p_display_name: input.displayName,
          p_role: input.role,
        }),
      });

      if (!rows || rows.length === 0) {
        throw new StaffManagementError('Failed to create staff account');
      }

      return this.mapRowToStaffMember(rows[0]);
    } catch (err: any) {
      if (err instanceof StaffManagementConflictError) {
        throw err;
      }

      // 2. Fallback to Supabase GoTrue admin API + staff_profiles insert
      const trimmedEmail = input.email.toLowerCase().trim();
      const authRes = await fetch(`${this.authAdminUrl}/users`, {
        method: 'POST',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmedEmail,
          password: input.password || 'DeskAtlas123!',
          email_confirm: true,
          user_metadata: {
            display_name: input.displayName.trim(),
            role: input.role,
          },
        }),
      });

      if (!authRes.ok) {
        const authErr = await authRes.json().catch(() => ({}));
        const msg = authErr.msg || authErr.message || authErr.error_description || 'Failed to create user in auth';
        if (authRes.status === 422 || msg.toLowerCase().includes('already exists')) {
          throw new StaffManagementConflictError(`A user with email ${trimmedEmail} already exists`);
        }
        throw new StaffManagementError(msg);
      }

      const createdAuthUser = await authRes.json();
      const userId = createdAuthUser.id;

      let effectiveAdminId = input.actorUserId ?? null;
      if (!effectiveAdminId) {
        try {
          const admins = await this.request<any[]>('/staff_profiles?role=eq.ADMIN&is_active=eq.true&select=user_id&limit=1');
          if (admins && admins.length > 0) {
            effectiveAdminId = admins[0].user_id;
          }
        } catch {
          // ignore
        }
      }

      // Insert staff profile
      const profiles = await this.request<any[]>('/staff_profiles', {
        method: 'POST',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          user_id: userId,
          created_by_admin_id: effectiveAdminId,
          role: input.role,
          display_name: input.displayName.trim(),
          is_active: true,
        }),
      });

      // Insert audit log
      if (input.actorUserId) {
        await this.request('/audit_logs', {
          method: 'POST',
          body: JSON.stringify({
            actor_user_id: input.actorUserId,
            actor_role: input.actorRole ?? 'ADMIN',
            action: 'CREATE_STAFF_ACCOUNT',
            entity_type: 'staff_profiles',
            entity_id: userId,
            metadata: {
              email: trimmedEmail,
              role: input.role,
              display_name: input.displayName.trim(),
              created_by_admin_id: input.actorUserId,
            },
          }),
        }).catch(() => {});
      }

      return this.mapRowToStaffMember({
        ...profiles[0],
        email: trimmedEmail,
      });
    }
  }

  async updateStaff(input: UpdateStaffInput): Promise<StaffMember> {
    try {
      // 1. Try RPC first
      const rows = await this.request<any[]>('/rpc/admin_update_staff', {
        method: 'POST',
        body: JSON.stringify({
          p_actor_user_id: input.actorUserId ?? null,
          p_target_user_id: input.staffUserId,
          p_display_name: input.displayName ?? null,
          p_role: input.role ?? null,
          p_is_active: input.isActive ?? null,
          p_new_password: input.password ?? null,
        }),
      });

      if (!rows || rows.length === 0) {
        throw new StaffManagementError('Failed to update staff account');
      }

      return this.mapRowToStaffMember(rows[0]);
    } catch (err: any) {
      if (err instanceof Error) {
        if (
          err.message.includes('Admin cannot manage staff created by another admin') ||
          err.message.includes('Only active ADMIN profiles')
        ) {
          throw new StaffManagementAuthorizationError(err.message);
        }
      }
      // 2. Fallback
      if (input.actorUserId) {
        const existing = await this.request<any[]>(`/staff_profiles?user_id=eq.${encodeURIComponent(input.staffUserId)}&select=*`);
        if (!existing || existing.length === 0) {
          throw new StaffManagementError('Staff profile not found for update');
        }
        if (existing[0].created_by_admin_id && existing[0].created_by_admin_id !== input.actorUserId) {
          throw new StaffManagementAuthorizationError('Admin cannot manage staff created by another admin');
        }
      }

      const patchBody: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (input.displayName !== undefined) patchBody.display_name = input.displayName.trim();
      if (input.role !== undefined) patchBody.role = input.role;
      if (input.isActive !== undefined) patchBody.is_active = input.isActive;

      const profiles = await this.request<any[]>(`/staff_profiles?user_id=eq.${encodeURIComponent(input.staffUserId)}`, {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(patchBody),
      });

      if (!profiles || profiles.length === 0) {
        throw new StaffManagementError('Staff profile not found for update');
      }

      // If password is provided, update via auth admin
      if (input.password && input.password.trim().length >= 6) {
        await fetch(`${this.authAdminUrl}/users/${encodeURIComponent(input.staffUserId)}`, {
          method: 'PUT',
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            password: input.password,
          }),
        }).catch(() => {});
      }

      // Log audit
      if (input.actorUserId) {
        const action = input.isActive === false ? 'DEACTIVATE_STAFF_ACCOUNT' : input.isActive === true ? 'REACTIVATE_STAFF_ACCOUNT' : 'UPDATE_STAFF_ACCOUNT';
        await this.request('/audit_logs', {
          method: 'POST',
          body: JSON.stringify({
            actor_user_id: input.actorUserId,
            actor_role: input.actorRole ?? 'ADMIN',
            action,
            entity_type: 'staff_profiles',
            entity_id: input.staffUserId,
            metadata: {
              role: input.role,
              display_name: input.displayName,
              is_active: input.isActive,
            },
          }),
        }).catch(() => {});
      }

      return this.mapRowToStaffMember(profiles[0]);
    }
  }

  async getStaffById(id: string): Promise<StaffMember | null> {
    const list = await this.listStaff();
    const found = list.find((s) => s.id === id);
    return found ?? null;
  }

  async listActiveStaff(actorUserId?: string, actorIsSuperAdmin?: boolean): Promise<StaffMember[]> {
    const list = await this.listStaff(actorUserId, actorIsSuperAdmin);
    return list.filter((s) => s.isActive);
  }

  async checkStaffDeletionEligibility(staffUserId: string): Promise<StaffDeletionCheckResult> {
    try {
      // 1. Try RPC first if available
      const rows = await this.request<any[]>('/rpc/admin_check_staff_deletion', {
        method: 'POST',
        body: JSON.stringify({ p_target_user_id: staffUserId }),
      });
      if (rows && rows.length > 0) {
        const row = rows[0];
        return {
          canDelete: Boolean(row.can_delete),
          reason: row.reason || undefined,
          references: row.references,
        };
      }
    } catch {
      // Fallback to direct REST queries
    }

    try {
      // Check audit logs
      const audits = await this.request<any[]>(
        `/audit_logs?actor_user_id=eq.${encodeURIComponent(staffUserId)}&select=id&limit=1`
      ).catch(() => []);
      const auditCount = audits.length;

      // Check reservations
      const reservations = await this.request<any[]>(
        `/reservations?or=(resolved_by_user_id.eq.${encodeURIComponent(staffUserId)},cancelled_by_user_id.eq.${encodeURIComponent(staffUserId)})&select=id&limit=1`
      ).catch(() => []);
      const resCount = reservations.length;

      // Check payment attempts
      const payments = await this.request<any[]>(
        `/payment_attempts?or=(processed_by_user_id.eq.${encodeURIComponent(staffUserId)},refund_recorded_by_user_id.eq.${encodeURIComponent(staffUserId)})&select=id&limit=1`
      ).catch(() => []);
      const payCount = payments.length;

      const total = auditCount + resCount + payCount;
      if (total > 0) {
        const reasons: string[] = [];
        if (auditCount > 0) reasons.push('audit logs');
        if (resCount > 0) reasons.push('reservation records');
        if (payCount > 0) reasons.push('payment confirmations');
        return {
          canDelete: false,
          reason: `Cannot delete: Staff has historical ${reasons.join(', ')}. Deactivate instead.`,
          references: {
            auditLogs: auditCount,
            reservations: resCount,
            payments: payCount,
            total,
          },
        };
      }

      return {
        canDelete: true,
        references: {
          auditLogs: 0,
          reservations: 0,
          payments: 0,
          total: 0,
        },
      };
    } catch (err: any) {
      return {
        canDelete: false,
        reason: 'Failed to verify deletion eligibility. Deactivate instead.',
      };
    }
  }

  async deleteStaff(staffUserId: string, actorUserId?: string, actorIsSuperAdmin?: boolean): Promise<{ success: boolean }> {
    try {
      // 1. Try RPC first
      await this.request('/rpc/admin_delete_staff', {
        method: 'POST',
        body: JSON.stringify({
          p_actor_user_id: actorUserId ?? null,
          p_target_user_id: staffUserId,
        }),
      });
      return { success: true };
    } catch (rpcErr) {
      if (rpcErr instanceof Error) {
        if (
          rpcErr.message.includes('Admin cannot manage staff created by another admin') ||
          rpcErr.message.includes('Only active ADMIN profiles') ||
          rpcErr.message.includes('Only the Superadmin')
        ) {
          throw new StaffManagementAuthorizationError(rpcErr.message);
        }
        if (
          rpcErr.message.includes('Cannot delete') ||
          rpcErr.message.includes('historical records')
        ) {
          throw new StaffManagementConflictError(rpcErr.message);
        }
      }

      // 2. Fallback: Check eligibility first
      const check = await this.checkStaffDeletionEligibility(staffUserId);
      if (!check.canDelete) {
        throw new StaffManagementConflictError(
          check.reason || 'Cannot delete staff account with historical audit, reservation, or payment records. Deactivate instead.'
        );
      }

      // Fetch profile to verify exists and for audit metadata
      const existingProfiles = await this.request<any[]>(
        `/staff_profiles?user_id=eq.${encodeURIComponent(staffUserId)}&select=*&limit=1`
      );
      if (!existingProfiles || existingProfiles.length === 0) {
        throw new StaffManagementError('Staff profile not found');
      }
      const profile = existingProfiles[0];

      if (profile.is_super_admin) {
        throw new StaffManagementError('Cannot delete the Superadmin account.');
      }

      if (profile.role === 'ADMIN' && !actorIsSuperAdmin) {
        throw new StaffManagementAuthorizationError('Only the Superadmin can delete administrator accounts.');
      }

      if (
        !actorIsSuperAdmin &&
        actorUserId &&
        profile.created_by_admin_id &&
        profile.created_by_admin_id !== actorUserId
      ) {
        throw new StaffManagementAuthorizationError('Admin cannot manage staff created by another admin');
      }

      // Delete staff profile
      await this.request(`/staff_profiles?user_id=eq.${encodeURIComponent(staffUserId)}`, {
        method: 'DELETE',
      });

      // Delete auth user
      await fetch(`${this.authAdminUrl}/users/${encodeURIComponent(staffUserId)}`, {
        method: 'DELETE',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
        },
      }).catch(() => {});

      // Audit log
      if (actorUserId) {
        await this.request('/audit_logs', {
          method: 'POST',
          body: JSON.stringify({
            actor_user_id: actorUserId,
            actor_role: 'ADMIN',
            action: 'DELETE_STAFF_ACCOUNT',
            entity_type: 'staff_profiles',
            entity_id: staffUserId,
            metadata: {
              display_name: profile.display_name,
              role: profile.role,
            },
          }),
        }).catch(() => {});
      }

      return { success: true };
    }
  }

  // Invitations / 2FA flow
  private mapRowToStaffInvitation(row: any): StaffInvitation {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: (row.role ?? 'STAFF').toUpperCase() as any,
      verificationCode: row.verification_code,
      token: row.token,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdByAdminId: row.created_by_admin_id ?? null,
    };
  }

  async createStaffInvitation(
    input: CreateStaffInvitationInput,
    verificationCode: string,
    token: string,
    expiresAt: Date
  ): Promise<StaffInvitation> {
    const trimmedEmail = input.email.toLowerCase().trim();

    // Check if user already exists
    try {
      const existing = await this.request<any[]>(
        `/staff_profiles?select=user_id&limit=1`
      );
      // Also check auth users
      const authRes = await fetch(
        `${this.authAdminUrl}/users?page=1&per_page=1000`,
        {
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
          },
          cache: 'no-store',
        }
      );
      if (authRes.ok) {
        const authData = await authRes.json();
        const exists = (authData.users ?? []).some(
          (u: any) => u.email?.toLowerCase().trim() === trimmedEmail
        );
        if (exists) {
          throw new StaffManagementConflictError(
            `A user with email ${trimmedEmail} already exists`
          );
        }
      }
    } catch (checkErr) {
      if (checkErr instanceof StaffManagementConflictError) {
        throw checkErr;
      }
    }

    let effectiveAdminId = input.actorUserId ?? null;
    if (!effectiveAdminId) {
      try {
        const admins = await this.request<any[]>('/staff_profiles?role=eq.ADMIN&is_active=eq.true&select=user_id&limit=1');
        if (admins && admins.length > 0) {
          effectiveAdminId = admins[0].user_id;
        }
      } catch {
        // ignore
      }
    }

    const rows = await this.request<any[]>('/staff_invitations', {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        email: trimmedEmail,
        display_name: input.displayName.trim(),
        role: input.role,
        temporary_password: input.password || null,
        verification_code: verificationCode.trim(),
        token: token.trim(),
        status: 'PENDING',
        expires_at: expiresAt.toISOString(),
        created_by_admin_id: effectiveAdminId,
      }),
    });

    if (!rows || rows.length === 0) {
      throw new StaffManagementError('Failed to record staff invitation');
    }

    return this.mapRowToStaffInvitation(rows[0]);
  }

  async getStaffInvitationByToken(token: string): Promise<StaffInvitation | null> {
    const rows = await this.request<any[]>(
      `/staff_invitations?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.mapRowToStaffInvitation(rows[0]);
  }

  async listPendingInvitations(actorUserId?: string, actorIsSuperAdmin?: boolean): Promise<StaffInvitation[]> {
    const endpoint = (actorIsSuperAdmin || !actorUserId)
      ? '/staff_invitations?select=*&order=created_at.desc'
      : `/staff_invitations?created_by_admin_id=eq.${encodeURIComponent(
          actorUserId
        )}&role=eq.STAFF&select=*&order=created_at.desc`;

    const rows = await this.request<any[]>(endpoint);
    const now = this.nowProvider().getTime();

    return rows.map((r) => {
      const isExpired = new Date(r.expires_at).getTime() < now;
      const status = isExpired && r.status === 'PENDING' ? 'EXPIRED' : r.status;
      return {
        ...this.mapRowToStaffInvitation(r),
        status,
      };
    });
  }

  async confirmStaffInvitation(
    input: ConfirmStaffInvitationInput
  ): Promise<{ staff: StaffMember; invitation: StaffInvitation }> {
    const rows = await this.request<any[]>(
      `/staff_invitations?token=eq.${encodeURIComponent(input.token)}&select=*&limit=1`
    );
    if (!rows || rows.length === 0) {
      throw new StaffManagementError('Invitation not found');
    }

    const row = rows[0];
    if (row.status !== 'PENDING') {
      throw new StaffManagementError(`Invitation is ${row.status.toLowerCase()}`);
    }

    const now = this.nowProvider();
    if (new Date(row.expires_at).getTime() < now.getTime()) {
      await this.request(`/staff_invitations?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'EXPIRED' }),
      });
      throw new StaffManagementError('Invitation has expired');
    }

    if (row.verification_code.trim() !== input.verificationCode.trim()) {
      throw new StaffManagementError('Invalid verification code');
    }

    // Create staff account
    const password = input.password || row.temporary_password || 'DeskAtlas123!';
    const staff = await this.createStaff({
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      password,
      actorUserId: row.created_by_admin_id ?? undefined,
      actorRole: 'ADMIN',
      actorIsSuperAdmin: true,
    });

    // Mark invitation confirmed
    await this.request(`/staff_invitations?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CONFIRMED', updated_at: now.toISOString() }),
    });

    return {
      staff,
      invitation: {
        ...this.mapRowToStaffInvitation(row),
        status: 'CONFIRMED',
        updatedAt: now.toISOString(),
      },
    };
  }

  async cancelStaffInvitation(id: string, actorUserId?: string, actorIsSuperAdmin?: boolean): Promise<boolean> {
    const rows = await this.request<any[]>(
      `/staff_invitations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
    );
    if (!rows || rows.length === 0) return false;

    const row = rows[0];
    if (!actorIsSuperAdmin && actorUserId && row.created_by_admin_id && row.created_by_admin_id !== actorUserId) {
      throw new StaffManagementAuthorizationError(
        'Admin cannot cancel invitation created by another admin'
      );
    }

    await this.request(`/staff_invitations?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CANCELLED', updated_at: this.nowProvider().toISOString() }),
    });
    return true;
  }
}
