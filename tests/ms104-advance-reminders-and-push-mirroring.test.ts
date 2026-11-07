// MS-104: Advance Reservation Reminder Automated Scheduling and Real-Time Admin Push Notification Email Mirroring
// Traceability: BRD-M1, BRD-M3, BRD-M6, PRD-F5, PRD-F6, PRD-F9, PRD-F13, SDD-C1, SDD-C4, SDD-C11, SDD-C13, DSD-UI4, DSD-UI11, ERD-E2, ERD-E10, ERD-E13, QAD-TC50, MS104-TC01..09

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReservationMemoryRepository,
  clearMirrorDeduplicationCache,
  mirrorAdminNotificationToEmail,
  processAdvanceReservationReminders,
  renderAdminNotificationAlertEmail,
  renderAdvanceReservationReminderEmail,
  validateAttendanceReconfirmToken,
  verifyAttendanceReconfirmToken,
  type AdminNotificationAlertEmailInput,
  type AdvanceReservationReminderEmailInput,
  type BusinessSettings,
  type ReminderCandidateReservation,
  type TransactionalEmailService,
} from "@deskatlas/domain";
import { POST as customerCronPost, GET as customerCronGet } from "../apps/customer-website/src/app/api/cron/reminders/route";
import { POST as adminCronPost } from "../apps/admin-portal/src/app/api/cron/reminders/route";
import { POST as mirrorEmailPost } from "../apps/admin-portal/src/app/api/admin/notifications/mirror-email/route";

describe("MS-104: Advance Reservation Reminder Scheduling and Admin Push Notification Email Mirroring (QAD-TC50)", () => {
  const originalEnv = { ...process.env };
  const fixedNow = new Date("2026-11-07T10:00:00.000Z");

  beforeEach(() => {
    vi.restoreAllMocks();
    clearMirrorDeduplicationCache();
    process.env.CRON_SECRET = "test-secret-ms104";
    process.env.ADMIN_NOTIFICATION_EMAIL = "admin@thedeskatlas.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // MS104-TC01: Advance Reminder Cron Rejects Unauthorized Access
  it("MS104-TC01: Advance Reminder Cron Rejects Unauthorized Access", async () => {
    // 1. Without authorization header
    const reqNoAuth = new Request("http://localhost:3000/api/cron/reminders", {
      method: "POST",
    });
    const resNoAuth = await customerCronPost(reqNoAuth);
    expect(resNoAuth.status).toBe(401);
    const dataNoAuth = await resNoAuth.json();
    expect(dataNoAuth.error).toBe("Unauthorized");

    // 2. With wrong secret
    const reqWrongAuth = new Request("http://localhost:3000/api/cron/reminders", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-secret-token",
      },
    });
    const resWrongAuth = await customerCronPost(reqWrongAuth);
    expect(resWrongAuth.status).toBe(401);

    // 3. Admin portal cron endpoint also rejects unauthorized access
    const adminResNoAuth = await adminCronPost(reqNoAuth);
    expect(adminResNoAuth.status).toBe(401);

    // 4. GET requests also require authorization
    const reqGetNoAuth = new Request("http://localhost:3000/api/cron/reminders", {
      method: "GET",
    });
    const resGetNoAuth = await customerCronGet(reqGetNoAuth);
    expect(resGetNoAuth.status).toBe(401);
  });

  // MS104-TC02: Advance Reminder Dispatches for Eligible Reservation
  it("MS104-TC02: Advance Reminder Dispatches for Eligible Reservation", async () => {
    const memoryRepo = new ReservationMemoryRepository();
    const sendMock = vi.fn().mockResolvedValue({ success: true, id: "msg-reminder-eligible-1" });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    // Reservation starting in exactly 12 hours from fixedNow (2026-11-07T22:00:00.000Z)
    const eligibleReservation: ReminderCandidateReservation = {
      reservationId: "res-ms104-tc02",
      referenceCode: "REF-TC02",
      customerFirstName: "Reynard",
      customerLastName: "Rabanal",
      customerEmail: "reynard@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-11-07T22:00:00.000Z",
      bookingEndAt: "2026-11-08T02:00:00.000Z",
      workspaceDisplayName: "Dedicated Desk 12",
      workspaceTemplateName: "Dedicated Desk",
      venueAddress: "DeskAtlas Main Venue",
    };

    const settings: BusinessSettings = {
      customerReminderAdvanceValue: 12,
      customerReminderAdvanceUnit: "HOURS",
      timezone: "Asia/Manila",
    };

    const workerResult = await processAdvanceReservationReminders({
      reservationRepo: memoryRepo,
      emailService: mockEmailService,
      settings,
      candidates: [eligibleReservation],
      now: fixedNow,
    });

    expect(workerResult.processed).toBe(1);
    expect(workerResult.dispatched).toBe(1);
    expect(workerResult.errors).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const callArgs = sendMock.mock.calls[0][0];
    expect(callArgs.to).toBe("reynard@example.com");
    expect(callArgs.referenceCode).toBe("REF-TC02");
    expect(callArgs.customerFirstName).toBe("Reynard");
    expect(callArgs.reconfirmUrl).toContain("/reconfirm?ref=REF-TC02&token=");

    // Verify reminderSentAt was updated on repo result
    expect(workerResult.results[0].dispatched).toBe(true);
    expect(workerResult.results[0].reminderSentAt).toBeDefined();
  });

  // MS104-TC03: Advance Reminder Skips Ineligible or Out-of-Window Bookings
  it("MS104-TC03: Advance Reminder Skips Ineligible or Out-of-Window Bookings", async () => {
    const memoryRepo = new ReservationMemoryRepository();
    const sendMock = vi.fn().mockResolvedValue({ success: true });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    // Booking starts in 48 hours (out-of-window for 12h advance timing)
    const farFutureBooking: ReminderCandidateReservation = {
      reservationId: "res-ms104-far",
      referenceCode: "REF-FAR",
      customerFirstName: "Future",
      customerLastName: "Guest",
      customerEmail: "future@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-11-09T10:00:00.000Z",
      bookingEndAt: "2026-11-09T14:00:00.000Z",
    };

    // Booking already completed/cancelled
    const cancelledBooking: ReminderCandidateReservation = {
      reservationId: "res-ms104-cancelled",
      referenceCode: "REF-CANC",
      customerFirstName: "Cancelled",
      customerEmail: "cancelled@example.com",
      reservationStatus: "CANCELLED",
      bookingStartAt: "2026-11-07T21:00:00.000Z",
    };

    const settings: BusinessSettings = {
      customerReminderAdvanceValue: 12,
      customerReminderAdvanceUnit: "HOURS",
    };

    const workerResult = await processAdvanceReservationReminders({
      reservationRepo: memoryRepo,
      emailService: mockEmailService,
      settings,
      candidates: [farFutureBooking, cancelledBooking],
      now: fixedNow,
    });

    expect(workerResult.processed).toBe(2);
    expect(workerResult.dispatched).toBe(0);
    expect(workerResult.skipped).toBe(2);
    expect(sendMock).not.toHaveBeenCalled();
  });

  // MS104-TC04: Idempotency of Advance Reminder Cron
  it("MS104-TC04: Idempotency of Advance Reminder Cron", async () => {
    const memoryRepo = new ReservationMemoryRepository();
    const sendMock = vi.fn().mockResolvedValue({ success: true, id: "msg-1" });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    const booking: ReminderCandidateReservation = {
      reservationId: "res-idempotency",
      referenceCode: "REF-IDEM",
      customerFirstName: "Idempotent",
      customerLastName: "User",
      customerEmail: "idem@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-11-07T20:00:00.000Z",
    };

    const settings: BusinessSettings = {
      customerReminderAdvanceValue: 12,
      customerReminderAdvanceUnit: "HOURS",
    };

    // First execution: dispatches reminder
    const firstRun = await processAdvanceReservationReminders({
      reservationRepo: memoryRepo,
      emailService: mockEmailService,
      settings,
      candidates: [booking],
      now: fixedNow,
    });
    expect(firstRun.dispatched).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Simulate database update where reminderSentAt is persisted
    booking.reminderSentAt = firstRun.results[0].reminderSentAt;

    // Second execution immediately following first: skips already dispatched booking
    const secondRun = await processAdvanceReservationReminders({
      reservationRepo: memoryRepo,
      emailService: mockEmailService,
      settings,
      candidates: [booking],
      now: fixedNow,
    });

    expect(secondRun.dispatched).toBe(0);
    expect(secondRun.skipped).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1); // zero additional calls
    expect(secondRun.results[0].skippedReason).toContain("already been dispatched");
  });

  // MS104-TC05: Admin Notification Alert Email Dispatches on Mirror Request
  it("MS104-TC05: Admin Notification Alert Email Dispatches on Mirror Request", async () => {
    const sendAlertMock = vi.fn().mockResolvedValue({ success: true, id: "alert-msg-101" });
    const mockEmailService = {
      sendAdminNotificationAlertEmail: sendAlertMock,
    } as unknown as TransactionalEmailService;

    const payload = {
      notificationId: "notif-proof-99",
      title: "Payment Proof Submitted",
      description: "Guest uploaded payment proof for reservation #REF-7890",
      type: "PAYMENT_PROOF_SUBMITTED",
      link: "/manage/payments",
      time: "2026-11-07T10:15:00.000Z",
      to: "admin@thedeskatlas.com",
      emailService: mockEmailService,
    };

    const mirrorResult = await mirrorAdminNotificationToEmail(payload);

    expect(mirrorResult.success).toBe(true);
    expect(mirrorResult.dispatched).toBe(true);
    expect(mirrorResult.duplicated).toBe(false);
    expect(sendAlertMock).toHaveBeenCalledTimes(1);

    const callArgs = sendAlertMock.mock.calls[0][0];
    expect(callArgs.to).toBe("admin@thedeskatlas.com");
    expect(callArgs.notificationTitle).toBe("Payment Proof Submitted");
    expect(callArgs.notificationDescription).toBe("Guest uploaded payment proof for reservation #REF-7890");
    expect(callArgs.actionUrl).toBe("/manage/payments");

    // Also test the route handler POST endpoint validation
    const badRequest = new Request("http://localhost:3000/api/admin/notifications/mirror-email", {
      method: "POST",
      body: JSON.stringify({ title: "" }),
    });
    const badResponse = await mirrorEmailPost(badRequest);
    expect(badResponse.status).toBe(400);
  });

  // MS104-TC06: Admin Push-to-Email Mirroring Deduplication
  it("MS104-TC06: Admin Push-to-Email Mirroring Deduplication", async () => {
    const sendAlertMock = vi.fn().mockResolvedValue({ success: true, id: "alert-msg-dedup" });
    const mockEmailService = {
      sendAdminNotificationAlertEmail: sendAlertMock,
    } as unknown as TransactionalEmailService;

    const alertItem = {
      notificationId: "notif-overdue-123",
      title: "Overdue Rental Alert",
      description: "Rental #RENT-001 has exceeded scheduled drop-off by 15 minutes.",
      type: "OVERDUE_RENTAL",
      link: "/manage/rentals",
      emailService: mockEmailService,
    };

    // First mirror call: dispatches email
    const firstResult = await mirrorAdminNotificationToEmail(alertItem);
    expect(firstResult.success).toBe(true);
    expect(firstResult.dispatched).toBe(true);
    expect(firstResult.duplicated).toBe(false);
    expect(sendAlertMock).toHaveBeenCalledTimes(1);

    // Duplicate mirror call for the exact same notification ID
    const duplicateResult = await mirrorAdminNotificationToEmail(alertItem);
    expect(duplicateResult.success).toBe(true);
    expect(duplicateResult.dispatched).toBe(false);
    expect(duplicateResult.duplicated).toBe(true);
    expect(duplicateResult.message).toContain("Duplicate notification already mirrored");
    expect(sendAlertMock).toHaveBeenCalledTimes(1); // zero additional calls
  });

  // MS104-TC07: Attendance Reconfirmation URL Security
  it("MS104-TC07: Attendance Reconfirmation URL Security", async () => {
    const sendMock = vi.fn().mockResolvedValue({ success: true });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    const reservation: ReminderCandidateReservation = {
      reservationId: "res-token-sec-1",
      referenceCode: "REF-SEC1",
      customerFirstName: "Alice",
      customerEmail: "alice@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-11-07T21:00:00.000Z",
    };

    const workerResult = await processAdvanceReservationReminders({
      reservationRepo: new ReservationMemoryRepository(),
      emailService: mockEmailService,
      candidates: [reservation],
      now: fixedNow,
    });

    expect(workerResult.dispatched).toBe(1);
    const dispatchedInput = sendMock.mock.calls[0][0] as AdvanceReservationReminderEmailInput;
    const reconfirmUrl = dispatchedInput.reconfirmUrl;

    // Extract ref and token from query parameters
    const url = new URL(reconfirmUrl);
    const ref = url.searchParams.get("ref");
    const token = url.searchParams.get("token");

    expect(ref).toBe("REF-SEC1");
    expect(token).toBeDefined();

    // Verify token validates with both verifyAttendanceReconfirmToken and validateAttendanceReconfirmToken
    expect(verifyAttendanceReconfirmToken(token!, ref!, "res-token-sec-1")).toBe(true);
    expect(validateAttendanceReconfirmToken(token!, ref!, "res-token-sec-1")).toBe(true);

    // Verify forged token or mismatched reservationId fails
    expect(validateAttendanceReconfirmToken("forged-token-value", ref!, "res-token-sec-1")).toBe(false);
    expect(validateAttendanceReconfirmToken(token!, ref!, "different-reservation-id")).toBe(false);
  });

  // MS104-TC08: Zero Em-Dash Documentation and Notification Copy Invariant
  it("MS104-TC08: Zero Em-Dash Documentation and Notification Copy Invariant (BAN-PUNCT-01)", () => {
    const reminderRender = renderAdvanceReservationReminderEmail({
      to: "guest@example.com",
      customerFirstName: "Guest",
      referenceCode: "REF-DASH",
      workspaceName: "Hot Desk 1",
      formattedDate: "Nov 7, 2026",
      startTime: "10:00 AM",
      endTime: "2:00 PM",
      reconfirmUrl: "https://www.thedeskatlas.com/reconfirm?ref=REF-DASH&token=xyz",
      trackUrl: "https://www.thedeskatlas.com/track?ref=REF-DASH",
    });

    const alertRender = renderAdminNotificationAlertEmail({
      to: "admin@thedeskatlas.com",
      notificationTitle: "System Security Alert",
      notificationDescription: "Failed login attempt detected on admin console.",
      notificationType: "SECURITY_ALERT",
      occurredAt: "2026-11-07T10:00:00.000Z",
      actionUrl: "/manage/activity",
    });

    const textToInspect = [
      reminderRender.subject,
      reminderRender.html,
      reminderRender.text,
      alertRender.subject,
      alertRender.html,
      alertRender.text,
    ];

    for (const text of textToInspect) {
      expect(text.includes("\u2014")).toBe(false);
    }
  });

  // MS104-TC09: Admin Mirror Email Template Content Parity
  it("MS104-TC09: Admin Mirror Email Template Content Parity", () => {
    const alertInput: AdminNotificationAlertEmailInput = {
      to: "supervisor@deskatlas.com",
      adminName: "Chief Operations Officer",
      notificationTitle: "Urgent Payment Expiring Soon",
      notificationDescription: "Reservation #REF-9912 expires in 5 minutes unless payment proof is submitted.",
      notificationType: "PAYMENT_EXPIRY_WARNING",
      occurredAt: "2026-11-07T10:30:00.000Z",
      actionUrl: "/manage/reservations?id=res-9912",
      actionLabel: "Review Urgent Reservation",
    };

    const rendered = renderAdminNotificationAlertEmail(alertInput);

    expect(rendered.subject).toBe("[DeskAtlas Alert] Urgent Payment Expiring Soon");
    expect(rendered.html).toContain("Chief Operations Officer");
    expect(rendered.html).toContain("Urgent Payment Expiring Soon");
    expect(rendered.html).toContain("Reservation #REF-9912 expires in 5 minutes");
    expect(rendered.html).toContain("PAYMENT_EXPIRY_WARNING");
    expect(rendered.html).toContain("Review Urgent Reservation");
    expect(rendered.html).toContain("https://admin.thedeskatlas.com/manage/reservations?id=res-9912");

    expect(rendered.text).toContain("Urgent Payment Expiring Soon");
    expect(rendered.text).toContain("https://admin.thedeskatlas.com/manage/reservations?id=res-9912");
  });
});
