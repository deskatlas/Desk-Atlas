export type StaffRole = 'ADMIN' | 'STAFF';

export type StaffInvitationStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';

export interface StaffInvitation {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  verificationCode: string;
  token: string;
  status: StaffInvitationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  createdByAdminId?: string | null;
}

export interface CreateStaffInvitationInput {
  email: string;
  displayName: string;
  role: StaffRole;
  password?: string;
  actorUserId?: string;
  actorRole?: StaffRole;
  actorIsSuperAdmin?: boolean;
  invitationBaseUrl?: string;
}

export interface ConfirmStaffInvitationInput {
  token: string;
  verificationCode: string;
  password?: string;
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: 'Admin' | 'Staff';
  rawRole: StaffRole;
  isActive: boolean;
  initials: string;
  status: 'Active' | 'Inactive';
  statusStyle: { background: string; color: string };
  mark: '✓' | '!';
  lastActive: string;
  createdAt: string;
  updatedAt: string;
  createdByAdminId?: string | null;
  isSuperAdmin?: boolean;
  canDelete?: boolean;
  deleteBlockReason?: string;
}

export interface StaffDeletionCheckResult {
  canDelete: boolean;
  reason?: string;
  references?: {
    auditLogs: number;
    reservations: number;
    payments: number;
    total: number;
  };
}

export interface CreateStaffInput {
  email: string;
  password?: string;
  displayName: string;
  role: StaffRole;
  actorUserId?: string;
  actorRole?: StaffRole;
  actorIsSuperAdmin?: boolean;
}

export interface UpdateStaffInput {
  staffUserId: string;
  displayName?: string;
  role?: StaffRole;
  isActive?: boolean;
  password?: string;
  actorUserId?: string;
  actorRole?: StaffRole;
  actorIsSuperAdmin?: boolean;
}

export interface StaffManagementActor {
  userId: string;
  role: StaffRole;
  isSuperAdmin?: boolean;
}

export class StaffManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffManagementError';
  }
}

export class StaffInvitationInvalidCodeError extends Error {
  constructor(message: string = 'Invalid or expired verification code.') {
    super(message);
    this.name = 'StaffInvitationInvalidCodeError';
  }
}

export class StaffManagementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffManagementConflictError';
  }
}

export class StaffManagementAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffManagementAuthorizationError';
  }
}

export function getInitials(name: string): string {
  if (!name || !name.trim()) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatRelativeTime(timestamp: string | null | undefined, now: Date = new Date()): string {
  if (!timestamp) return 'Never';
  const time = new Date(timestamp).getTime();
  if (isNaN(time)) return 'Never';
  const diffMs = Math.max(0, now.getTime() - time);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin === 1) return '1 min ago';
  if (diffMin < 60) return `${diffMin} mins ago`;
  if (diffHours === 1) return '1 hr ago';
  if (diffHours < 24) return `${diffHours} hrs ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
