export type AdminNotificationType =
  | "RESERVATION_CREATED"
  | "PAYMENT_PROOF_SUBMITTED"
  | "PAYMENT_APPROVED"
  | "PAYMENT_REJECTED"
  | "WORKSPACE_STATUS_CHANGED"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "PAYMENT_EXPIRED"
  | "MANUAL_RESOLUTION_REQUIRED"
  | "ADMIN_INVITATION_ACCEPTED"
  | "STAFF_INVITATION_ACCEPTED";

export interface AdminNotificationItem {
  id: string;
  type: AdminNotificationType;
  title: string;
  description: string;
  link: string;
  timestamp: string; // ISO 8601 string
  read?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AdminNotificationListResult {
  notifications: AdminNotificationItem[];
  total: number;
}
