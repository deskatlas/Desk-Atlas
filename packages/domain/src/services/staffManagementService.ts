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
    return this.repository.listStaff(actor?.userId);
  }

  async getStaffById(id: string, actor?: StaffManagementActor): Promise<StaffMember | null> {
    if (!id || !id.trim()) {
      throw new StaffManagementError('Staff ID is required.');
    }
    const staff = await this.repository.getStaffById(id.trim());
    if (staff && actor && actor.role === 'ADMIN' && staff.createdByAdminId && staff.createdByAdminId !== actor.userId) {
      throw new StaffManagementAuthorizationError('Admin cannot view staff created by another admin');
    }
    return staff;
  }

  async createStaff(input: CreateStaffInput): Promise<StaffMember> {
    if (input.actorRole && input.actorRole !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may create staff accounts.');
    }

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new StaffManagementError('A valid email address is required.');
    }

    const displayName = input.displayName ? input.displayName.trim() : '';
    if (!displayName) {
      throw new StaffManagementError('Display name cannot be blank.');
    }

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

    return this.repository.createStaff({
      ...input,
      email,
      displayName,
    });
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

    if (
      input.actorUserId &&
      existing.createdByAdminId &&
      existing.createdByAdminId !== input.actorUserId
    ) {
      throw new StaffManagementAuthorizationError('Admin cannot manage staff created by another admin');
    }

    if (input.displayName !== undefined && !input.displayName.trim()) {
      throw new StaffManagementError('Display name cannot be blank.');
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

    return this.repository.updateStaff(input);
  }

  async deactivateStaff(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.updateStaff({
      staffUserId,
      isActive: false,
      actorUserId: actor.userId,
      actorRole: actor.role,
    });
  }

  async activateStaff(staffUserId: string, actor: StaffManagementActor): Promise<StaffMember> {
    return this.updateStaff({
      staffUserId,
      isActive: true,
      actorUserId: actor.userId,
      actorRole: actor.role,
    });
  }

  async listActiveStaff(actor?: StaffManagementActor): Promise<StaffMember[]> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    return this.repository.listActiveStaff(actor?.userId);
  }

  async checkStaffDeletionEligibility(staffUserId: string, actor?: StaffManagementActor): Promise<StaffDeletionCheckResult> {
    if (actor && actor.role !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may manage staff.');
    }
    if (!staffUserId || !staffUserId.trim()) {
      throw new StaffManagementError('Staff user ID is required.');
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
    return this.repository.deleteStaff(staffUserId.trim(), actor.userId);
  }

  // --------------------------------------------------------------------------
  // Staff Invitation & 2FA Confirmation Methods
  // --------------------------------------------------------------------------

  async inviteStaff(input: CreateStaffInvitationInput): Promise<{ invitation: StaffInvitation; emailSent: boolean }> {
    if (input.actorRole && input.actorRole !== 'ADMIN') {
      throw new StaffManagementAuthorizationError('Only ADMIN profiles may invite staff.');
    }

    const email = input.email ? input.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new StaffManagementError('A valid email address is required.');
    }

    const displayName = input.displayName ? input.displayName.trim() : '';
    if (!displayName) {
      throw new StaffManagementError('Display name cannot be blank.');
    }

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
        verificationCode,
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
    return this.repository.listPendingInvitations(actor?.userId);
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

    return this.repository.confirmStaffInvitation(input);
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
}

export function createStaffManagementService(
  repository: StaffManagementRepository,
  nowProvider?: () => Date,
  emailService?: TransactionalEmailService
): StaffManagementService {
  return new StaffManagementService(repository, nowProvider, emailService);
}
