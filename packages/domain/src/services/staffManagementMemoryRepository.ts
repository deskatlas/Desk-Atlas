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
  StaffRole,
  UpdateStaffInput,
} from '../models/staffManagement';
import { StaffManagementRepository } from './staffManagementRepository';

export interface MemoryAuditLog {
  id: string;
  actorUserId: string | null;
  actorRole: 'ADMIN' | 'STAFF' | 'SYSTEM';
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface MemoryStaffRecord {
  id: string;
  email: string;
  password?: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt?: string;
  createdByAdminId?: string | null;
}

export class StaffManagementMemoryRepository implements StaffManagementRepository {
  private records: Map<string, MemoryStaffRecord> = new Map();
  public auditLogs: MemoryAuditLog[] = [];
  public reservationReferences: Map<string, number> = new Map();
  public paymentReferences: Map<string, number> = new Map();

  constructor(
    initialRecords?: Array<{
      id: string;
      email: string;
      password?: string;
      displayName: string;
      role: StaffRole;
      isActive: boolean;
      createdAt?: string;
      updatedAt?: string;
      lastSignInAt?: string;
      createdByAdminId?: string | null;
    }>,
    private readonly nowProvider: () => Date = () => new Date()
  ) {
    if (initialRecords) {
      for (const rec of initialRecords) {
        const nowIso = this.nowProvider().toISOString();
        this.records.set(rec.id, {
          id: rec.id,
          email: rec.email.toLowerCase().trim(),
          password: rec.password,
          displayName: rec.displayName.trim(),
          role: rec.role,
          isActive: rec.isActive,
          createdAt: rec.createdAt ?? nowIso,
          updatedAt: rec.updatedAt ?? nowIso,
          lastSignInAt: rec.lastSignInAt,
          createdByAdminId: rec.createdByAdminId ?? null,
        });
      }
    }
  }

  setStaffReservationReferences(staffUserId: string, count: number) {
    this.reservationReferences.set(staffUserId, count);
  }

  setStaffPaymentReferences(staffUserId: string, count: number) {
    this.paymentReferences.set(staffUserId, count);
  }

  checkStaffDeletionEligibilitySync(staffUserId: string): StaffDeletionCheckResult {
    const auditCount = this.auditLogs.filter((a) => a.actorUserId === staffUserId).length;
    const resCount = this.reservationReferences.get(staffUserId) ?? 0;
    const payCount = this.paymentReferences.get(staffUserId) ?? 0;
    const total = auditCount + resCount + payCount;

    if (total > 0) {
      const parts: string[] = [];
      if (auditCount > 0) parts.push(`${auditCount} audit log${auditCount > 1 ? 's' : ''}`);
      if (resCount > 0) parts.push(`${resCount} reservation${resCount > 1 ? 's' : ''}`);
      if (payCount > 0) parts.push(`${payCount} payment confirmation${payCount > 1 ? 's' : ''}`);
      return {
        canDelete: false,
        reason: `Cannot delete: Staff has historical records (${parts.join(', ')}). Deactivate instead.`,
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
  }

  private mapToStaffMember(rec: MemoryStaffRecord): StaffMember {
    const now = this.nowProvider();
    const deletionCheck = this.checkStaffDeletionEligibilitySync(rec.id);
    return {
      id: rec.id,
      email: rec.email,
      name: rec.displayName,
      role: rec.role === 'ADMIN' ? 'Admin' : 'Staff',
      rawRole: rec.role,
      isActive: rec.isActive,
      initials: getInitials(rec.displayName),
      status: rec.isActive ? 'Active' : 'Inactive',
      statusStyle: rec.isActive
        ? { background: 'var(--da-info)', color: 'var(--da-brand-dark)' }
        : { background: 'var(--da-soft)', color: 'var(--da-brand-dark)' },
      mark: rec.isActive ? '✓' : '!',
      lastActive: formatRelativeTime(rec.lastSignInAt ?? rec.updatedAt, now),
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      createdByAdminId: rec.createdByAdminId ?? null,
      canDelete: deletionCheck.canDelete,
      deleteBlockReason: deletionCheck.reason,
    };
  }

  async listStaff(actorUserId?: string): Promise<StaffMember[]> {
    if (actorUserId && this.records.has(actorUserId)) {
      const actor = this.records.get(actorUserId)!;
      if (actor.role !== 'ADMIN' || !actor.isActive) {
        throw new StaffManagementError('Only active ADMIN profiles may view staff management');
      }
    }

    const records = actorUserId
      ? Array.from(this.records.values()).filter((r) => r.createdByAdminId === actorUserId)
      : Array.from(this.records.values());

    return records
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((rec) => this.mapToStaffMember(rec));
  }

  async getStaffById(id: string): Promise<StaffMember | null> {
    const rec = this.records.get(id);
    return rec ? this.mapToStaffMember(rec) : null;
  }

  async createStaff(input: CreateStaffInput): Promise<StaffMember> {
    const trimmedEmail = input.email.toLowerCase().trim();
    const trimmedName = input.displayName.trim();
    const nowIso = this.nowProvider().toISOString();

    for (const rec of this.records.values()) {
      if (rec.email === trimmedEmail) {
        throw new StaffManagementConflictError(`A user with email ${trimmedEmail} already exists`);
      }
    }

    const newId = `staff-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const record: MemoryStaffRecord = {
      id: newId,
      email: trimmedEmail,
      password: input.password,
      displayName: trimmedName,
      role: input.role,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdByAdminId: input.actorUserId ?? null,
    };

    this.records.set(newId, record);

    if (input.actorUserId) {
      this.auditLogs.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? 'ADMIN',
        action: 'CREATE_STAFF_ACCOUNT',
        entityType: 'staff_profiles',
        entityId: newId,
        metadata: {
          email: trimmedEmail,
          role: input.role,
          displayName: trimmedName,
          created_by_admin_id: input.actorUserId,
        },
        createdAt: nowIso,
      });
    }

    return this.mapToStaffMember(record);
  }

  async updateStaff(input: UpdateStaffInput): Promise<StaffMember> {
    const current = this.records.get(input.staffUserId);
    if (!current) {
      throw new StaffManagementError('Staff member not found');
    }

    if (
      input.actorUserId &&
      current.createdByAdminId &&
      current.createdByAdminId !== input.actorUserId
    ) {
      throw new StaffManagementAuthorizationError('Admin cannot manage staff created by another admin');
    }

    const nowIso = this.nowProvider().toISOString();
    let action = 'UPDATE_STAFF_ACCOUNT';

    if (input.isActive !== undefined && input.isActive !== current.isActive) {
      action = input.isActive ? 'REACTIVATE_STAFF_ACCOUNT' : 'DEACTIVATE_STAFF_ACCOUNT';
    }

    const updated: MemoryStaffRecord = {
      ...current,
      displayName: input.displayName ? input.displayName.trim() : current.displayName,
      role: input.role ?? current.role,
      isActive: input.isActive !== undefined ? input.isActive : current.isActive,
      password: input.password ? input.password : current.password,
      updatedAt: nowIso,
      createdByAdminId: current.createdByAdminId, // immutable
    };

    this.records.set(input.staffUserId, updated);

    if (input.actorUserId) {
      this.auditLogs.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? 'ADMIN',
        action,
        entityType: 'staff_profiles',
        entityId: input.staffUserId,
        metadata: {
          previousRole: current.role,
          newRole: updated.role,
          previousDisplayName: current.displayName,
          newDisplayName: updated.displayName,
          previousIsActive: current.isActive,
          newIsActive: updated.isActive,
          passwordChanged: !!input.password,
          created_by_admin_id: current.createdByAdminId,
        },
        createdAt: nowIso,
      });
    }

    return this.mapToStaffMember(updated);
  }

  async listActiveStaff(actorUserId?: string): Promise<StaffMember[]> {
    const list = await this.listStaff(actorUserId);
    return list.filter((s) => s.isActive);
  }

  async checkStaffDeletionEligibility(staffUserId: string): Promise<StaffDeletionCheckResult> {
    return this.checkStaffDeletionEligibilitySync(staffUserId);
  }

  async deleteStaff(staffUserId: string, actorUserId?: string): Promise<{ success: boolean }> {
    const current = this.records.get(staffUserId);
    if (!current) {
      throw new StaffManagementError('Staff member not found');
    }

    if (
      actorUserId &&
      current.createdByAdminId &&
      current.createdByAdminId !== actorUserId
    ) {
      throw new StaffManagementAuthorizationError('Admin cannot manage staff created by another admin');
    }

    const check = this.checkStaffDeletionEligibilitySync(staffUserId);
    if (!check.canDelete) {
      throw new StaffManagementConflictError(
        check.reason || 'Cannot delete staff account with historical audit, reservation, or payment records. Deactivate instead.'
      );
    }

    this.records.delete(staffUserId);

    if (actorUserId) {
      const nowIso = this.nowProvider().toISOString();
      this.auditLogs.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        actorUserId,
        actorRole: 'ADMIN',
        action: 'DELETE_STAFF_ACCOUNT',
        entityType: 'staff_profiles',
        entityId: staffUserId,
        metadata: {
          email: current.email,
          displayName: current.displayName,
          role: current.role,
        },
        createdAt: nowIso,
      });
    }

    return { success: true };
  }

  // Invitations / 2FA flow
  private invitations: Map<string, {
    id: string;
    email: string;
    displayName: string;
    role: StaffRole;
    password?: string;
    verificationCode: string;
    token: string;
    status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    createdByAdminId?: string | null;
  }> = new Map();

  async createStaffInvitation(input: CreateStaffInvitationInput, verificationCode: string, token: string, expiresAt: Date): Promise<StaffInvitation> {
    const trimmedEmail = input.email.toLowerCase().trim();
    for (const rec of this.records.values()) {
      if (rec.email === trimmedEmail) {
        throw new StaffManagementConflictError(`A user with email ${trimmedEmail} already exists`);
      }
    }

    const id = `inv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = this.nowProvider().toISOString();
    const inv = {
      id,
      email: trimmedEmail,
      displayName: input.displayName.trim(),
      role: input.role,
      password: input.password,
      verificationCode,
      token,
      status: 'PENDING' as const,
      expiresAt: expiresAt.toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
      createdByAdminId: input.actorUserId ?? null,
    };

    this.invitations.set(id, inv);
    return {
      id: inv.id,
      email: inv.email,
      displayName: inv.displayName,
      role: inv.role,
      verificationCode: inv.verificationCode,
      token: inv.token,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
      createdByAdminId: inv.createdByAdminId,
    };
  }

  async getStaffInvitationByToken(token: string): Promise<StaffInvitation | null> {
    for (const inv of this.invitations.values()) {
      if (inv.token === token) {
        return {
          id: inv.id,
          email: inv.email,
          displayName: inv.displayName,
          role: inv.role,
          verificationCode: inv.verificationCode,
          token: inv.token,
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt,
          createdByAdminId: inv.createdByAdminId,
        };
      }
    }
    return null;
  }

  async listPendingInvitations(actorUserId?: string): Promise<StaffInvitation[]> {
    const list: StaffInvitation[] = [];
    const now = this.nowProvider().getTime();
    for (const inv of this.invitations.values()) {
      if (actorUserId && inv.createdByAdminId && inv.createdByAdminId !== actorUserId) {
        continue;
      }
      const isExpired = new Date(inv.expiresAt).getTime() < now;
      const status = isExpired && inv.status === 'PENDING' ? 'EXPIRED' : inv.status;
      list.push({
        id: inv.id,
        email: inv.email,
        displayName: inv.displayName,
        role: inv.role,
        verificationCode: inv.verificationCode,
        token: inv.token,
        status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
        createdByAdminId: inv.createdByAdminId,
      });
    }
    return list;
  }

  async confirmStaffInvitation(input: ConfirmStaffInvitationInput): Promise<{ staff: StaffMember; invitation: StaffInvitation }> {
    let targetInv: any = null;
    for (const inv of this.invitations.values()) {
      if (inv.token === input.token) {
        targetInv = inv;
        break;
      }
    }

    if (!targetInv) {
      throw new StaffManagementError('Invitation not found');
    }

    if (targetInv.status !== 'PENDING') {
      throw new StaffManagementError(`Invitation is ${targetInv.status.toLowerCase()}`);
    }

    const now = this.nowProvider();
    if (new Date(targetInv.expiresAt).getTime() < now.getTime()) {
      targetInv.status = 'EXPIRED';
      throw new StaffManagementError('Invitation has expired');
    }

    if (targetInv.verificationCode.trim() !== input.verificationCode.trim()) {
      throw new StaffManagementError('Invalid verification code');
    }

    // Create staff account
    const password = input.password || targetInv.password || 'DeskAtlas123!';
    const staff = await this.createStaff({
      email: targetInv.email,
      displayName: targetInv.displayName,
      role: targetInv.role,
      password,
      actorUserId: targetInv.createdByAdminId ?? undefined,
      actorRole: 'ADMIN',
    });

    targetInv.status = 'CONFIRMED';
    targetInv.updatedAt = now.toISOString();

    return {
      staff,
      invitation: {
        id: targetInv.id,
        email: targetInv.email,
        displayName: targetInv.displayName,
        role: targetInv.role,
        verificationCode: targetInv.verificationCode,
        token: targetInv.token,
        status: targetInv.status,
        expiresAt: targetInv.expiresAt,
        createdAt: targetInv.createdAt,
        updatedAt: targetInv.updatedAt,
        createdByAdminId: targetInv.createdByAdminId,
      },
    };
  }

  async cancelStaffInvitation(id: string, actorUserId?: string): Promise<boolean> {
    const inv = this.invitations.get(id);
    if (!inv) return false;
    if (actorUserId && inv.createdByAdminId && inv.createdByAdminId !== actorUserId) {
      throw new StaffManagementAuthorizationError('Admin cannot cancel invitation created by another admin');
    }
    inv.status = 'CANCELLED';
    inv.updatedAt = this.nowProvider().toISOString();
    return true;
  }
}

