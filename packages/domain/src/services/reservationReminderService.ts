// MS-69: Customer Advance Reservation Reminders, Attendance Reconfirmation, Admin Cancellation Receipts, and Multi-Trigger Push Alerts
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC50, MS69-TC01..14

import { createHmac, timingSafeEqual } from "crypto";
import { BusinessSettings, calculateReminderAdvanceHours } from "../models/settings";
import { AdminNotificationItem } from "../models/adminNotification";
import { TransactionalEmailService } from "./transactionalEmailService";

const DEFAULT_SECRET = process.env.RECONFIRM_SECRET || "deskatlas-attendance-reconfirm-secret";

export interface ReminderCandidateReservation {
  id?: string;
  reservationId: string;
  referenceCode: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail: string;
  customerPhone?: string | null;
  reservationStatus: string;
  status?: string;
  amountDue?: number;
  bookingStartAt?: string | null;
  bookingEndAt?: string | null;
  workspaceDisplayName?: string | null;
  workspaceTemplateName?: string | null;
  venueAddress?: string | null;
  reminderSentAt?: string | null;
  attendanceReconfirmedAt?: string | null;
}

export interface ReservationReminderEligibility {
  isEligible: boolean;
  reason?: string;
  reminderAdvanceHours: number;
  reminderAdvanceDisplay: string;
}

/**
 * Evaluates whether a reservation qualifies for an advance reminder email.
 * Eligible if:
 * 1. Status is CONFIRMED
 * 2. reminderSentAt is null/undefined (idempotency guard)
 * 3. Scheduled start time is in the future
 * 4. now >= bookingStartAt - reminderAdvanceHours
 */
export function evaluateReservationReminderEligibility(
  reservation: Partial<ReminderCandidateReservation>,
  settings?: BusinessSettings | null,
  now: Date | number = new Date()
): ReservationReminderEligibility {
  const reminderAdvanceHours = calculateReminderAdvanceHours(settings);
  const val = settings?.customerReminderAdvanceValue ?? 12;
  const unit = settings?.customerReminderAdvanceUnit ?? "HOURS";
  const reminderAdvanceDisplay =
    unit === "DAYS" ? `${val} ${val === 1 ? "day" : "days"}` : `${val} ${val === 1 ? "hour" : "hours"}`;

  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  const currentStatus = reservation.reservationStatus || reservation.status;
  if (currentStatus !== "CONFIRMED") {
    return {
      isEligible: false,
      reason: `Reservation is in ${currentStatus || "unknown"} status (CONFIRMED required).`,
      reminderAdvanceHours,
      reminderAdvanceDisplay,
    };
  }

  if (reservation.reminderSentAt) {
    return {
      isEligible: false,
      reason: "Advance reminder email has already been dispatched.",
      reminderAdvanceHours,
      reminderAdvanceDisplay,
    };
  }

  const startStr = reservation.bookingStartAt;
  if (!startStr) {
    return {
      isEligible: false,
      reason: "Reservation does not have a scheduled start time.",
      reminderAdvanceHours,
      reminderAdvanceDisplay,
    };
  }

  const startMs = new Date(startStr).getTime();
  if (isNaN(startMs) || startMs <= nowMs) {
    return {
      isEligible: false,
      reason: "Booking start time has already arrived or passed.",
      reminderAdvanceHours,
      reminderAdvanceDisplay,
    };
  }

  const reminderThresholdMs = startMs - reminderAdvanceHours * 3600 * 1000;
  if (nowMs < reminderThresholdMs) {
    return {
      isEligible: false,
      reason: `Advance reminder window (${reminderAdvanceDisplay}) has not yet opened.`,
      reminderAdvanceHours,
      reminderAdvanceDisplay,
    };
  }

  return {
    isEligible: true,
    reminderAdvanceHours,
    reminderAdvanceDisplay,
  };
}

/**
 * Generates a tamper-proof attendance reconfirmation token using HMAC-SHA256.
 */
export function generateAttendanceReconfirmToken(
  referenceCode: string,
  reservationId: string,
  secret: string = DEFAULT_SECRET
): string {
  const payload = `${referenceCode.trim().toUpperCase()}:${reservationId.trim()}`;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Validates an attendance reconfirmation token.
 */
export function verifyAttendanceReconfirmToken(
  token: string,
  referenceCode: string,
  reservationId: string,
  secret: string = DEFAULT_SECRET
): boolean {
  if (!token || !referenceCode || !reservationId) {
    return false;
  }
  const expected = generateAttendanceReconfirmToken(referenceCode, reservationId, secret);
  if (token === expected) {
    return true;
  }
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  } catch {
    // Length mismatch or buffer error
  }
  return false;
}

/**
 * Constructs a secure reconfirmation link for transactional emails.
 */
export function buildAttendanceReconfirmUrl(
  customerWebsiteUrl: string,
  referenceCode: string,
  reservationId: string,
  secret?: string
): string {
  const token = generateAttendanceReconfirmToken(referenceCode, reservationId, secret);
  const base = customerWebsiteUrl.replace(/\/$/, "");
  return `${base}/reconfirm?ref=${encodeURIComponent(referenceCode)}&token=${encodeURIComponent(token)}`;
}

export interface ReminderScanItemResult {
  reservationId: string;
  referenceCode: string;
  dispatched: boolean;
  skippedReason?: string;
  reminderSentAt?: string;
  error?: string;
  notification?: AdminNotificationItem;
}

export interface ScanAndDispatchRemindersInput {
  reservations: ReminderCandidateReservation[];
  settings?: BusinessSettings | null;
  emailService?: TransactionalEmailService;
  customerWebsiteUrl?: string;
  now?: Date | number;
  onReminderSent?: (reservationId: string, sentAt: string) => Promise<void> | void;
  onNotificationTriggered?: (notification: AdminNotificationItem) => Promise<void> | void;
}

/**
 * Scans candidate reservations and dispatches advance reminder emails idempotently.
 */
export async function scanAndDispatchAdvanceReminders(
  input: ScanAndDispatchRemindersInput
): Promise<ReminderScanItemResult[]> {
  const now = input.now ? (input.now instanceof Date ? input.now : new Date(input.now)) : new Date();
  const nowIso = now.toISOString();
  const baseUrl = input.customerWebsiteUrl || process.env.NEXT_PUBLIC_CUSTOMER_URL || "https://www.thedeskatlas.com";

  const results: ReminderScanItemResult[] = [];

  for (const res of input.reservations) {
    const resId = res.reservationId || res.id || "";
    const refCode = res.referenceCode;

    const evalResult = evaluateReservationReminderEligibility(res, input.settings, now);
    if (!evalResult.isEligible) {
      results.push({
        reservationId: resId,
        referenceCode: refCode,
        dispatched: false,
        skippedReason: evalResult.reason,
      });
      continue;
    }

    if (!input.emailService) {
      results.push({
        reservationId: resId,
        referenceCode: refCode,
        dispatched: false,
        skippedReason: "NO_EMAIL_SERVICE",
      });
      continue;
    }

    const reconfirmUrl = buildAttendanceReconfirmUrl(baseUrl, refCode, resId);
    const trackUrl = `${baseUrl}/track?ref=${encodeURIComponent(refCode)}`;

    const startDate = res.bookingStartAt ? new Date(res.bookingStartAt) : now;
    const endDate = res.bookingEndAt ? new Date(res.bookingEndAt) : new Date(startDate.getTime() + 7200000);

    const formattedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: input.settings?.timezone || "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(startDate);

    const startTime = new Intl.DateTimeFormat("en-US", {
      timeZone: input.settings?.timezone || "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(startDate);

    const endTime = new Intl.DateTimeFormat("en-US", {
      timeZone: input.settings?.timezone || "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(endDate);

    const durationHours = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 3600000));
    const customerFullName = [res.customerFirstName, res.customerLastName].filter(Boolean).join(" ") || res.customerFirstName || "Guest";
    const workspaceName = res.workspaceDisplayName || "Workspace Spot";

    try {
      const emailResult = await input.emailService.sendAdvanceReservationReminderEmail({
        to: res.customerEmail,
        customerFirstName: res.customerFirstName || "Valued Guest",
        customerLastName: res.customerLastName,
        referenceCode: refCode,
        workspaceName,
        workspaceType: res.workspaceTemplateName || undefined,
        formattedDate,
        startTime,
        endTime,
        durationHours,
        venueAddress: res.venueAddress || undefined,
        reconfirmUrl,
        trackUrl,
      });

      if (!emailResult.success) {
        results.push({
          reservationId: resId,
          referenceCode: refCode,
          dispatched: false,
          error: emailResult.error || "Email delivery failed",
        });
        continue;
      }

      if (typeof input.onReminderSent === "function") {
        await input.onReminderSent(resId, nowIso);
      }

      const pushAlert: AdminNotificationItem = {
        id: `customer-reminder-${resId}`,
        type: "CUSTOMER_REMINDER_SENT",
        title: "Reservation Reminder Dispatched",
        description: `Advance reminder email sent to ${customerFullName} for reservation #${refCode} (${workspaceName})`,
        link: `/manage/reservations?id=${resId}`,
        timestamp: nowIso,
        metadata: {
          reservationId: resId,
          referenceCode: refCode,
          customerName: customerFullName,
          workspaceName,
        },
      };

      if (typeof input.onNotificationTriggered === "function") {
        await input.onNotificationTriggered(pushAlert);
      }

      results.push({
        reservationId: resId,
        referenceCode: refCode,
        dispatched: true,
        reminderSentAt: nowIso,
        notification: pushAlert,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        reservationId: resId,
        referenceCode: refCode,
        dispatched: false,
        error: errorMsg,
      });
    }
  }

  return results;
}

export interface ProcessAttendanceReconfirmationInput {
  referenceCode: string;
  token?: string;
  reservation: {
    reservationId?: string;
    id?: string;
    referenceCode: string;
    attendanceReconfirmedAt?: string | null;
    customerFirstName?: string;
    customerLastName?: string;
    [key: string]: unknown;
  };
  now?: Date | number;
  secret?: string;
  skipTokenVerification?: boolean;
}

export interface AttendanceReconfirmResult {
  success: boolean;
  alreadyReconfirmed: boolean;
  attendanceReconfirmedAt: string;
  message: string;
  timelineEntry?: string;
  error?: string;
}

/**
 * Processes attendance reconfirmation idempotently.
 * Subsequent calls return success without altering timestamp.
 */
export function processAttendanceReconfirmation(
  input: ProcessAttendanceReconfirmationInput
): AttendanceReconfirmResult {
  const resId = (input.reservation.reservationId || input.reservation.id || "").trim();
  const refCode = input.reservation.referenceCode || input.referenceCode;

  if (!input.skipTokenVerification && input.token) {
    const isValid = verifyAttendanceReconfirmToken(input.token, refCode, resId, input.secret);
    if (!isValid) {
      return {
        success: false,
        alreadyReconfirmed: false,
        attendanceReconfirmedAt: "",
        message: "Invalid or expired reconfirmation token.",
        error: "INVALID_TOKEN",
      };
    }
  }

  if (input.reservation.attendanceReconfirmedAt) {
    return {
      success: true,
      alreadyReconfirmed: true,
      attendanceReconfirmedAt: input.reservation.attendanceReconfirmedAt,
      message: "Attendance was previously confirmed.",
    };
  }

  const now = input.now ? (input.now instanceof Date ? input.now : new Date(input.now)) : new Date();
  const nowIso = now.toISOString();

  const customerName = [input.reservation.customerFirstName, input.reservation.customerLastName]
    .filter(Boolean)
    .join(" ") || input.reservation.customerFirstName || "Customer";

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);

  const formattedTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now).toLowerCase();

  const timelineEntry = `${formattedDate} ${formattedTime} - ${customerName} reconfirmed attendance`;

  return {
    success: true,
    alreadyReconfirmed: false,
    attendanceReconfirmedAt: nowIso,
    message: "Attendance reconfirmed successfully.",
    timelineEntry,
  };
}
