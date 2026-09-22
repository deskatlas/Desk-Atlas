import {
  ConfirmStaffInvitationInput,
  CreateStaffInput,
  CreateStaffInvitationInput,
  StaffDeletionCheckResult,
  StaffInvitation,
  StaffInvitationInvalidCodeError,
  StaffManagementAuthorizationError,
  StaffManagementError,
  StaffManagementActor,
  StaffMember,
  UpdateStaffInput,
} from '../models/staffManagement';
import { StaffManagementRepository } from './staffManagementRepository';
import { validatePassword } from './passwordPolicyService';
import { validatePersonName } from './personNameValidationService';
import { TransactionalEmailService, createTransactionalEmailService } from './transactionalEmailService';

export class StaffManagementService {
  private readonly emailService: TransactionalEmailService;

  constructor(
    private readonly repository: StaffManagementRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    emailService?: TransactionalEmailService
  ) {
    this.emailService = emailService ?? createTransactionalEmailService();
  }

  async listStaff(actor?: StaffManagementActor): Promise<StaffMember[]> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    return this.repository.listStaff(actor?.userId, actor?.isSuperAdmin);
  }

  async getStaffById(id: string, actor?: StaffManagementActor): Promise<StaffMember | null> {
    if (!id || !id.trim()) {
      throw new StaffManagementError('Staff ID is required.');
    }
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    const staff = await this.repository.getStaffById(id.trim());
    return staff;
  }

  async createStaff(input: CreateStaffInput): Promise<StaffMember> {
    if (input.actorRole && input.actorRole !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may create staff accounts.');
    }

    if (input.role === 'ADMIN' && !input.actorIsSuperAdmin) {
      throw new StaffManagementAuthorizationError('Only the Superadmin can add administrator accounts.');
    }

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new StaffManagementError('A valid email address is required.');
    }

    const nameValidation = validatePersonName(input.displayName, 'Display name');
    if (!nameValidation.isValid) {
      throw new StaffManagementError(nameValidation.error!);
    }
    const displayName = input.displayName.trim();

    if (input.role !== 'ADMIN' && input.role !== 'STAFF') {
      throw new StaffManagementError('Role must be either ADMIN or STAFF.');
    }

    if (input.password !== undefined && input.password.length > 0) {
      const validation = validatePassword(input.password);
      if (!validation.isValid) {
        throw new StaffManagementError(
          `Password does not meet security requirements: ${validation.errors.join(' ')}`
        );
      }
    }

    const staff = await this.repository.createStaff({
      ...input,
      email,
      displayName,
    });

    try {
      let inviterNameOrEmail: string | undefined;
      if (input.actorUserId) {
        inviterNameOrEmail = await this.getActorNameOrEmail(input.actorUserId);
      }
      await this.notifyAdminsNewTeamMember({
        memberName: staff.name || displayName,
        memberEmail: staff.email || email,
        role: staff.rawRole || input.role,
        invitedBy: inviterNameOrEmail,
      });
    } catch (e) {
      console.warn('[StaffManagementService] Failed to notify admins of direct staff creation:', e);
    }

    return staff;
  }

  async updateStaff(input: UpdateStaffInput): Promise<StaffMember> {
    if (input.actorRole && input.actorRole !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may update staff accounts.');
    }

    if (!input.staffUserId || !input.staffUserId.trim()) {
      throw new StaffManagementError('Staff user ID is required.');
    }

    const existing = await this.repository.getStaffById(input.staffUserId.trim());
    if (!existing) {
      throw new StaffManagementError('Staff member not found');
    }

    let isSuperAdmin = Boolean(input.actorIsSuperAdmin);
    if (!isSuperAdmin && input.actorUserId) {
      const actorProfile = await this.repository.getStaffById(input.actorUserId);
      if (actorProfile) {
        isSuperAdmin = Boolean(actorProfile.isSuperAdmin);
      }
    }

    // Protection for Superadmin account
    if (existing.isSuperAdmin) {
      if (input.role !== undefined && input.role !== 'ADMIN') {
        throw new StaffManagementAuthorizationError('The superadmin account role cannot be changed or demoted.');
      }
      if (input.isActive === false) {
        throw new StaffManagementAuthorizationError('The superadmin account cannot be deactivated.');
      }
      if (!isSuperAdmin) {
        throw new StaffManagementAuthorizationError('Cannot modify the Superadmin account.');
      }
    }

    // Admin target validation: Only superadmin or self can update an admin account
    if (existing.rawRole === 'ADMIN' && !isSuperAdmin && input.actorUserId !== existing.id) {
      throw new StaffManagementAuthorizationError('Only the Superadmin can manage administrator accounts.');
    }

    // Promoting to Admin validation
    if (input.role === 'ADMIN' && existing.rawRole !== 'ADMIN' && !isSuperAdmin) {
      throw new StaffManagementAuthorizationError('Only the Superadmin can promote accounts to administrator.');
    }

    if (input.displayName !== undefined) {
      const nameValidation = validatePersonName(input.displayName, 'Display name');
      if (!nameValidation.isValid) {
        throw new StaffManagementError(nameValidation.error!);
      }
    }

    if (input.role !== undefined && input.role !== 'ADMIN' && input.role !== 'STAFF') {
      throw new StaffManagementError('Role must be either ADMIN or STAFF.');
    }

    if (input.password !== undefined && input.password.trim().length > 0) {
      const validation = validatePassword(input.password.trim());
      if (!validation.isValid) {
        throw new StaffManagementError(
          `Password does not meet security requirements: ${validation.errors.join(' ')}`
        );
      }
    }

    const updated = await this.repository.updateStaff({
      ...input,
      actorIsSuperAdmin: isSuperAdmin,
    });

    const targetEmail =
      updated.email && updated.email !== 'unknown@deskatlas.com'
        ? updated.email
        : existing.email && existing.email !== 'unknown@deskatlas.com'
        ? existing.email
        : updated.email;

    if ((!updated.email || updated.email === 'unknown@deskatlas.com') && targetEmail && targetEmail !== 'unknown@deskatlas.com') {
      updated.email = targetEmail;
    }

    if (existing.isActive !== updated.isActive) {
      let actorNameOrEmail: string | undefined;
      if (input.actorUserId) {
        actorNameOrEmail = await this.getActorNameOrEmail(input.actorUserId);
      }

      if (existing.isActive && !updated.isActive) {
        try {
          await this.emailService.sendAccountDeactivatedEmail({
            to: targetEmail,
            memberName: updated.name || updated.email,
            role: updated.rawRole || updated.role,
            effectiveAt: this.nowProvider().toISOString(),
            changedBy: actorNameOrEmail,
          });
        } catch (e) {
          console.warn('[StaffManagementService] Failed to send account deactivated email:', e);
        }
      } else if (!existing.isActive && updated.isActive) {
        try {
          const adminBaseUrl = (process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL || process.env.ADMIN_PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '');
          const loginUrl = `${adminBaseUrl}/manage/login`;
          await this.emailService.sendAccountReactivatedEmail({
            to: targetEmail,
            memberName: updated.name || updated.email,
            role: updated.rawRole || updated.role,
            effectiveAt: this.nowProvider().toISOString(),
            loginUrl,
            changedBy: actorNameOrEmail,
          });
        } catch (e) {
          console.warn('[StaffManagementService] Failed to send account reactivated email:', e);
        }
      }
    }

    const prevRole = existing.rawRole || (existing.role?.toUpperCase() as 'ADMIN' | 'STAFF');
    const newRole = updated.rawRole || (updated.role?.toUpperCase() as 'ADMIN' | 'STAFF');

    if (prevRole && newRole && prevRole !== newRole) {
      try {
        let actorNameOrEmail: string | undefined;
        if (input.actorUserId) {
          actorNameOrEmail = await this.getActorNameOrEmail(input.actorUserId);
        }

        const isNewAdmin = newRole === 'ADMIN';
        const adminBaseUrl = (process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL || process.env.ADMIN_PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '');
        const staffBaseUrl = (process.env.NEXT_PUBLIC_STAFF_PORTAL_URL || process.env.STAFF_PORTAL_URL || 'http://localhost:3002').replace(/\/$/, '');

        const loginUrl = isNewAdmin ? `${adminBaseUrl}/manage/login` : `${staffBaseUrl}/manage/login`;
        const portalName = isNewAdmin ? 'Admin Portal' : 'Staff Dashboard';

        await this.emailService.sendRoleChangeNotificationEmail({
          to: targetEmail,
          displayName: updated.name || updated.email,
          previousRole: prevRole,
          newRole: newRole,
          updatedByAdminName: actorNameOrEmail,
          updatedAt: this.nowProvider().toISOString(),
          loginUrl,
          portalName,
        });
      } catch (e) {
        console.warn('[StaffManagementService] Failed to send role change email:', e);
      }
    }

    return updated;
  }

  async deactivateStaff(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.updateStaff({
      staffUserId,
      isActive: false,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorIsSuperAdmin: actor.isSuperAdmin,
    });
  }

  async deactivateStaffAccount(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.deactivateStaff(staffUserId, actor);
  }

  async activateStaff(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.updateStaff({
      staffUserId,
      isActive: true,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorIsSuperAdmin: actor.isSuperAdmin,
    });
  }

  async reactivateStaffAccount(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.activateStaff(staffUserId, actor);
  }

  async listActiveStaff(actor?: StaffManagementActor): Promise<StaffMember[]> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    return this.repository.listActiveStaff(actor?.userId, actor?.isSuperAdmin);
  }

  async checkStaffDeletionEligibility(staffUserId: string, actor?: StaffManagementActor): Promise<StaffDeletionCheckResult> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    if (!staffUserId || !staffUserId.trim()) {
      throw new StaffManagementError('Staff user ID is required.');
    }
    const existing = await this.repository.getStaffById(staffUserId.trim());
    if (existing?.isSuperAdmin) {
      return { canDelete: false, reason: 'Superadmin account cannot be deleted.' };
    }
    if (existing?.rawRole === 'ADMIN' && !actor?.isSuperAdmin) {
      return { canDelete: false, reason: 'Only the Superadmin can delete administrator accounts.' };
    }
    return this.repository.checkStaffDeletionEligibility(staffUserId.trim());
  }

  async deleteStaff(staffUserId: string, actor: StaffManagementActor): Promise<{ success: boolean }> {
    if (actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may delete staff accounts.');
    }
    if (!staffUserId || !staffUserId.trim()) {
      throw new StaffManagementError('Staff user ID is required.');
    }
    const existing = await this.repository.getStaffById(staffUserId.trim());
    if (existing?.isSuperAdmin) {
      throw new StaffManagementAuthorizationError('Superadmin account cannot be deleted.');
    }
    if (existing?.rawRole === 'ADMIN' && !actor.isSuperAdmin) {
      throw new StaffManagementAuthorizationError('Only the Superadmin can delete administrator accounts.');
    }
    return this.repository.deleteStaff(staffUserId.trim(), actor.userId, actor.isSuperAdmin);
  }

  // --------------------------------------------------------------------------
  // Staff Invitation & 2FA Confirmation Methods
  // --------------------------------------------------------------------------

  async inviteStaff(input: CreateStaffInvitationInput): Promise<{ invitation: StaffInvitation; emailSent: boolean }> {
    if (input.actorRole && input.actorRole !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may invite staff.');
    }

    if (input.role === 'ADMIN' && !input.actorIsSuperAdmin) {
      throw new StaffManagementAuthorizationError('Only the Superadmin can invite administrator accounts.');
    }

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new StaffManagementError('A valid email address is required.');
    }

    const nameValidation = validatePersonName(input.displayName, 'Display name');
    if (!nameValidation.isValid) {
      throw new StaffManagementError(nameValidation.error!);
    }
    const displayName = input.displayName.trim();

    if (input.role !== 'ADMIN' && input.role !== 'STAFF') {
      throw new StaffManagementError('Role must be either ADMIN or STAFF.');
    }

    if (input.password !== undefined && input.password.length > 0) {
      const validation = validatePassword(input.password);
      if (!validation.isValid) {
        throw new StaffManagementError(
          `Password does not meet security requirements: ${validation.errors.join(' ')}`
        );
      }
    }

    // Generate 6-digit random code
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    // Generate secure random token
    const token = `${Date.now()}-${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
    // Expiry: 24 hours
    const expiresAt = new Date(this.nowProvider().getTime() + 24 * 60 * 60 * 1000);

    const invitation = await this.repository.createStaffInvitation(
      {
        ...input,
        email,
        displayName,
      },
      verificationCode,
      token,
      expiresAt
    );

    // Build verification URL for email
    const baseUrl = (input.invitationBaseUrl || process.env.NEXT_PUBLIC_STAFF_PORTAL_URL || 'http://localhost:3003').replace(/\/$/, '');
    const invitationUrl = `${baseUrl}/verify-invitation?token=${encodeURIComponent(token)}`;

    // Dispatch invitation email
    let emailSent = false;
    try {
      const emailResult = await this.emailService.sendStaffInvitationEmail({
        to: email,
        displayName,
        role: input.role,
        invitationUrl,
        expiresAt: expiresAt.toISOString(),
      });
      emailSent = emailResult.success;
    } catch (e) {
      console.warn('[StaffManagementService] Failed to send staff invitation email:', e);
    }

    return { invitation, emailSent };
  }

  async getStaffInvitationByToken(token: string): Promise<StaffInvitation | null> {
    if (!token || !token.trim()) {
      throw new StaffManagementError('Invitation token is required.');
    }
    return this.repository.getStaffInvitationByToken(token.trim());
  }

  async listPendingInvitations(actor?: StaffManagementActor): Promise<StaffInvitation[]> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may view staff invitations.');
    }
    return this.repository.listPendingInvitations(actor?.userId, actor?.isSuperAdmin);
  }

  async confirmStaffInvitation(input: ConfirmStaffInvitationInput): Promise<{ staff: StaffMember; invitation: StaffInvitation }> {
    if (!input.token || !input.token.trim()) {
      throw new StaffManagementError('Invitation token is required.');
    }
    if (!input.verificationCode || !input.verificationCode.trim()) {
      throw new StaffInvitationInvalidCodeError('Verification code is required.');
    }

    if (input.password !== undefined && input.password.length > 0) {
      const validation = validatePassword(input.password);
      if (!validation.isValid) {
        throw new StaffManagementError(
          `Password does not meet security requirements: ${validation.errors.join(' ')}`
        );
      }
    }

    const result = await this.repository.confirmStaffInvitation(input);

    try {
      let inviterNameOrEmail: string | undefined;
      if (result.invitation.createdByAdminId) {
        inviterNameOrEmail = await this.getActorNameOrEmail(result.invitation.createdByAdminId);
      }
      await this.notifyAdminsNewTeamMember({
        memberName: result.staff.name || result.invitation.displayName,
        memberEmail: result.staff.email || result.invitation.email,
        role: result.staff.rawRole || result.invitation.role,
        invitedBy: inviterNameOrEmail,
      });
    } catch (e) {
      console.warn('[StaffManagementService] Failed to notify admins on confirmed invitation:', e);
    }

    return result;
  }

  async cancelStaffInvitation(id: string, actor: StaffManagementActor): Promise<boolean> {
    if (actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may cancel staff invitations.');
    }
    if (!id || !id.trim()) {
      throw new StaffManagementError('Invitation ID is required.');
    }
    return this.repository.cancelStaffInvitation(id.trim(), actor.userId);
  }

  private async getActorNameOrEmail(actorUserId: string): Promise<string | undefined> {
    try {
      const actor = await this.repository.getStaffById(actorUserId);
      if (actor) {
        return actor.name || actor.email;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private async notifyAdminsNewTeamMember(details: {
    memberName: string;
    memberEmail: string;
    role: string;
    invitedBy?: string;
  }): Promise<void> {
    try {
      const activeStaff = await this.repository.listActiveStaff();
      const activeAdmins = activeStaff.filter(
        (s) => s.isActive && (s.rawRole === 'ADMIN' || s.isSuperAdmin)
      );
      const normalizedMemberEmail = details.memberEmail.trim().toLowerCase();
      const recipientEmails = Array.from(
        new Set(
          activeAdmins
            .map((a) => a.email?.trim().toLowerCase())
            .filter((email): email is string => Boolean(email) && email !== normalizedMemberEmail)
        )
      );

      const nowIso = this.nowProvider().toISOString();
      const adminBaseUrl = (process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL || process.env.ADMIN_PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '');
      const rosterUrl = `${adminBaseUrl}/manage/staff`;

      for (const to of recipientEmails) {
        try {
          await this.emailService.sendTeamMemberJoinedEmail({
            to,
            memberName: details.memberName,
            memberEmail: details.memberEmail,
            role: details.role,
            joinedAt: nowIso,
            invitedBy: details.invitedBy,
            rosterUrl,
          });
        } catch (err) {
          console.warn(`[StaffManagementService] Failed to send team member joined email to ${to}:`, err);
        }
      }
    } catch (err) {
      console.warn('[StaffManagementService] Failed to notify admins of new team member:', err);
    }
  }
}

export function createStaffManagementService(
  repository: StaffManagementRepository,
  nowProvider?: () => Date,
  emailService?: TransactionalEmailService
): StaffManagementService {
  return new StaffManagementService(repository, nowProvider, emailService);
}
