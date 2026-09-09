import {
  ConfirmStaffInvitationInput,
  CreateStaffInput,
  CreateStaffInvitationInput,
  StaffDeletionCheckResult,
  StaffInvitation,
  StaffMember,
  UpdateStaffInput,
} from '../models/staffManagement';

export interface StaffManagementRepository {
  listStaff(actorUserId?: string): Promise<StaffMember[]>;
  listActiveStaff(actorUserId?: string): Promise<StaffMember[]>;
  createStaff(input: CreateStaffInput): Promise<StaffMember>;
  updateStaff(input: UpdateStaffInput): Promise<StaffMember>;
  getStaffById(id: string): Promise<StaffMember | null>;
  checkStaffDeletionEligibility(staffUserId: string): Promise<StaffDeletionCheckResult>;
  deleteStaff(staffUserId: string, actorUserId?: string): Promise<{ success: boolean }>;

  // Invitations / 2FA flow
  createStaffInvitation(input: CreateStaffInvitationInput, verificationCode: string, token: string, expiresAt: Date): Promise<StaffInvitation>;
  getStaffInvitationByToken(token: string): Promise<StaffInvitation | null>;
  listPendingInvitations(actorUserId?: string): Promise<StaffInvitation[]>;
  confirmStaffInvitation(input: ConfirmStaffInvitationInput): Promise<{ staff: StaffMember; invitation: StaffInvitation }>;
  cancelStaffInvitation(id: string, actorUserId?: string): Promise<boolean>;
}

