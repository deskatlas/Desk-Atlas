// MS-104: Real-Time Admin Push Notification Email Mirroring Pipeline
// Traceability: PRD-F9, PRD-F13, SDD-C4, SDD-C11, SDD-C13, MS104-TC05, MS104-TC06

import { TransactionalEmailService } from "./transactionalEmailService";

const mirroredNotificationIds = new Set<string>();

/**
 * Resets the in-memory deduplication set (used primarily during test cycles).
 */
export function clearMirrorDeduplicationCache(): void {
  mirroredNotificationIds.clear();
}

/**
 * Checks whether a given notification ID has already been mirrored to email.
 */
export function isNotificationMirrored(id: string): boolean {
  if (!id) return false;
  return mirroredNotificationIds.has(id.trim());
}

export interface MirrorAdminNotificationInput {
  notificationId?: string;
  id?: string;
  title: string;
  description: string;
  type?: string;
  link?: string;
  time?: string;
  timestamp?: string;
  to?: string;
  adminName?: string;
  emailService: TransactionalEmailService;
  defaultToEmail?: string;
  actionBaseUrl?: string;
}

export interface MirrorAdminNotificationResult {
  success: boolean;
  dispatched: boolean;
  duplicated: boolean;
  message?: string;
  error?: string;
}

/**
 * Mirrors a real-time admin push alert to transactional email.
 * Applies in-memory deduplication by notification ID to prevent redundant email spam.
 */
export async function mirrorAdminNotificationToEmail(
  input: MirrorAdminNotificationInput
): Promise<MirrorAdminNotificationResult> {
  const title = (input.title || "").trim();
  const description = (input.description || "").trim();

  if (!title || !description) {
    return {
      success: false,
      dispatched: false,
      duplicated: false,
      error: "Missing required notification title or description.",
    };
  }

  const notifId = (input.notificationId || input.id || "").trim();
  if (notifId && mirroredNotificationIds.has(notifId)) {
    return {
      success: true,
      dispatched: false,
      duplicated: true,
      message: "Duplicate notification already mirrored.",
    };
  }

  const recipient =
    input.to ||
    input.defaultToEmail ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    "admin@thedeskatlas.com";

  const occurredAt = input.time || input.timestamp || new Date().toISOString();
  const actionUrl = input.link || undefined;

  try {
    const emailResult = await input.emailService.sendAdminNotificationAlertEmail({
      to: recipient,
      adminName: input.adminName,
      notificationTitle: title,
      notificationDescription: description,
      notificationType: input.type || "ADMIN_ALERT",
      occurredAt,
      actionUrl,
      appUrl: input.actionBaseUrl,
    });

    if (!emailResult.success) {
      return {
        success: false,
        dispatched: false,
        duplicated: false,
        error: emailResult.error || "Email delivery failed.",
      };
    }

    if (notifId) {
      mirroredNotificationIds.add(notifId);
    }

    return {
      success: true,
      dispatched: true,
      duplicated: false,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      dispatched: false,
      duplicated: false,
      error: errorMsg,
    };
  }
}

