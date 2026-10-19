// MS-69: Customer Advance Reservation Reminders, Attendance Reconfirmation, Admin Cancellation Receipts, and Multi-Trigger Push Alerts
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC50, MS69-TC01..14

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  calculateReminderAdvanceHours,
  evaluateReservationReminderEligibility,
  generateAttendanceReconfirmToken,
  verifyAttendanceReconfirmToken,
  buildAttendanceReconfirmUrl,
  scanAndDispatchAdvanceReminders,
  processAttendanceReconfirmation,
  renderAdvanceReservationReminderEmail,
  renderAdminCancellationReceiptEmail,
  createAdminNotificationService,
  formatTimelineDate,
  ReservationMemoryRepository,
  type BusinessSettings,
  type ReminderCandidateReservation,
  type TransactionalEmailService,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
} from "@deskatlas/domain";

function createMockReportsRepo(
  reservations: Partial<ReportReservationRecord>[] = [],
  payments: Partial<ReportPaymentAttemptRecord>[] = []
) {
  return {
    async listReportReservations() {
      return reservations as ReportReservationRecord[];
    },
    async listReportPaymentAttempts() {
      return payments as ReportPaymentAttemptRecord[];
    },
    async getAdminReportsSnapshot() {
      throw new Error("Not implemented in test mock");
    },
    async getCustomDateRangeSnapshot() {
      throw new Error("Not implemented in test mock");
    },
  };
}

function createMockStaffOpsRepo() {
  return {
    async listOperationalActivity() {
      return [];
    },
    async recordOperationalActivity() {},
  };
}

describe("MS-69: Customer Advance Reservation Reminders, Attendance Reconfirmation, Admin Cancellation Receipts, and Push Alerts (QAD-TC50)", () => {
  const fixedNow = new Date("2026-10-20T10:00:00.000Z");

  it("MS69-TC01: Advance Reminder Setting Validation persists valid settings and converts units", () => {
    // 24 Hours
    const settingsHours: BusinessSettings = {
      customerReminderAdvanceValue: 24,
      customerReminderAdvanceUnit: "HOURS",
    };
    expect(calculateReminderAdvanceHours(settingsHours)).toBe(24);

    // 3 Days
    const settingsDays: BusinessSettings = {
      customerReminderAdvanceValue: 3,
      customerReminderAdvanceUnit: "DAYS",
    };
    expect(calculateReminderAdvanceHours(settingsDays)).toBe(72);

    // Default fallback when unspecified or 0
    expect(calculateReminderAdvanceHours(null)).toBe(12);
    expect(calculateReminderAdvanceHours({})).toBe(12);
    expect(calculateReminderAdvanceHours({ customerReminderAdvanceValue: 0 })).toBe(12);

    // Verify Settings UI source code contains testids and boundaries
    const settingsComponentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/settings/components/Settings.tsx"
    );
    const settingsSource = fs.readFileSync(settingsComponentPath, "utf-8");

    expect(settingsSource).toContain('data-testid="customer-reminder-advance-value-input"');
    expect(settingsSource).toContain('data-testid="customer-reminder-advance-unit-select"');
    expect(settingsSource).toContain("Advance Reservation Reminder Timing");
  });

  it("MS69-TC02: Reminder Eligibility Scanner evaluates start times, advance window, and idempotency", () => {
    const settings: BusinessSettings = {
      customerReminderAdvanceValue: 12,
      customerReminderAdvanceUnit: "HOURS",
    };

    // Booking A: Starts in 10 hours (within 12h advance window), CONFIRMED, not yet reminded
    const bookingA: Partial<ReminderCandidateReservation> = {
      reservationId: "res-a",
      referenceCode: "REF-A",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-20T20:00:00.000Z", // 10h ahead of fixedNow
      reminderSentAt: null,
    };
    const evalA = evaluateReservationReminderEligibility(bookingA, settings, fixedNow);
    expect(evalA.isEligible).toBe(true);
    expect(evalA.reminderAdvanceHours).toBe(12);

    // Booking B: Starts in 48 hours (outside 12h window)
    const bookingB: Partial<ReminderCandidateReservation> = {
      reservationId: "res-b",
      referenceCode: "REF-B",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-22T10:00:00.000Z", // 48h ahead
      reminderSentAt: null,
    };
    const evalB = evaluateReservationReminderEligibility(bookingB, settings, fixedNow);
    expect(evalB.isEligible).toBe(false);
    expect(evalB.reason).toContain("not yet opened");

    // Booking C: Starts in 10 hours, but reminder already sent
    const bookingC: Partial<ReminderCandidateReservation> = {
      reservationId: "res-c",
      referenceCode: "REF-C",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-20T20:00:00.000Z",
      reminderSentAt: "2026-10-20T08:00:00.000Z",
    };
    const evalC = evaluateReservationReminderEligibility(bookingC, settings, fixedNow);
    expect(evalC.isEligible).toBe(false);
    expect(evalC.reason).toContain("already been dispatched");

    // Booking D: Starts in the past
    const bookingD: Partial<ReminderCandidateReservation> = {
      reservationId: "res-d",
      referenceCode: "REF-D",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-20T09:00:00.000Z", // 1h in the past
      reminderSentAt: null,
    };
    const evalD = evaluateReservationReminderEligibility(bookingD, settings, fixedNow);
    expect(evalD.isEligible).toBe(false);
    expect(evalD.reason).toContain("already arrived or passed");

    // Booking E: Status is CANCELLED
    const bookingE: Partial<ReminderCandidateReservation> = {
      reservationId: "res-e",
      referenceCode: "REF-E",
      reservationStatus: "CANCELLED",
      bookingStartAt: "2026-10-20T20:00:00.000Z",
      reminderSentAt: null,
    };
    const evalE = evaluateReservationReminderEligibility(bookingE, settings, fixedNow);
    expect(evalE.isEligible).toBe(false);
    expect(evalE.reason).toContain("CONFIRMED required");
  });

  it("MS69-TC03: Advance Reminder Email Dispatch renders airline-style CTA and invokes transactional service", async () => {
    const sendMock = vi.fn().mockResolvedValue({ success: true, messageId: "msg-reminder-001" });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    const candidate: ReminderCandidateReservation = {
      reservationId: "res-dispatch-1",
      referenceCode: "REF-DISPATCH-1",
      customerFirstName: "Reynard",
      customerLastName: "Rabanal",
      customerEmail: "reynard@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-20T20:00:00.000Z",
      bookingEndAt: "2026-10-20T22:00:00.000Z",
      workspaceDisplayName: "Dedicated Desk 04",
      workspaceTemplateName: "Dedicated Desk",
      venueAddress: "123 Innovation Way, Taguig, Metro Manila",
    };

    const results = await scanAndDispatchAdvanceReminders({
      reservations: [candidate],
      settings: { customerReminderAdvanceValue: 12, customerReminderAdvanceUnit: "HOURS" },
      emailService: mockEmailService,
      customerWebsiteUrl: "https://www.thedeskatlas.com",
      now: fixedNow,
    });

    expect(results).toHaveLength(1);
    expect(results[0].dispatched).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const callArgs = sendMock.mock.calls[0][0];
    expect(callArgs.to).toBe("reynard@example.com");
    expect(callArgs.customerFirstName).toBe("Reynard");
    expect(callArgs.referenceCode).toBe("REF-DISPATCH-1");
    expect(callArgs.reconfirmUrl).toContain("/reconfirm?ref=REF-DISPATCH-1&token=");

    // Test template rendering
    const rendered = renderAdvanceReservationReminderEmail(callArgs);
    expect(rendered.subject).toContain("Reminder: Your upcoming DeskAtlas reservation");
    expect(rendered.html).toContain("CONFIRM ATTENDANCE");
    expect(rendered.html).toContain("Reschedule Booking");
    expect(rendered.html).toContain("Cancel Reservation");
    expect(rendered.html).toContain("REF-DISPATCH-1");
    expect(rendered.html).toContain("Dedicated Desk 04");
  });

  it("MS69-TC04: Reminder Dispatch Idempotency ensures reminder is sent strictly once per booking", async () => {
    const sendMock = vi.fn().mockResolvedValue({ success: true, messageId: "msg-idemp-001" });
    const mockEmailService = {
      sendAdvanceReservationReminderEmail: sendMock,
    } as unknown as TransactionalEmailService;

    const candidate: ReminderCandidateReservation = {
      reservationId: "res-idemp-1",
      referenceCode: "REF-IDEMP-1",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      customerEmail: "juan@example.com",
      reservationStatus: "CONFIRMED",
      bookingStartAt: "2026-10-20T18:00:00.000Z",
    };

    // First scan: Should dispatch
    const firstRun = await scanAndDispatchAdvanceReminders({
      reservations: [candidate],
      settings: { customerReminderAdvanceValue: 12, customerReminderAdvanceUnit: "HOURS" },
      emailService: mockEmailService,
      now: fixedNow,
      onReminderSent: (_id, sentAt) => {
        candidate.reminderSentAt = sentAt;
      },
    });

    expect(firstRun[0].dispatched).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(candidate.reminderSentAt).toBeDefined();

    // Second scan on same reservation: Should skip idempotently
    const secondRun = await scanAndDispatchAdvanceReminders({
      reservations: [candidate],
      settings: { customerReminderAdvanceValue: 12, customerReminderAdvanceUnit: "HOURS" },
      emailService: mockEmailService,
      now: fixedNow,
    });

    expect(secondRun[0].dispatched).toBe(false);
    expect(secondRun[0].skippedReason).toContain("already been dispatched");
    expect(sendMock).toHaveBeenCalledTimes(1); // No second dispatch
  });

  it("MS69-TC05: Customer Attendance Reconfirmation Endpoint validates token and records timestamp", () => {
    const refCode = "REF-RECONFIRM-1";
    const resId = "res-reconfirm-1";
    const secret = "test-secret-key-123";

    const token = generateAttendanceReconfirmToken(refCode, resId, secret);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    // Verification
    expect(verifyAttendanceReconfirmToken(token, refCode, resId, secret)).toBe(true);
    expect(verifyAttendanceReconfirmToken("invalid-token", refCode, resId, secret)).toBe(false);
    expect(verifyAttendanceReconfirmToken(token, "REF-WRONG", resId, secret)).toBe(false);
    expect(verifyAttendanceReconfirmToken(token, refCode, "res-wrong", secret)).toBe(false);

    // Process attendance reconfirmation
    const resObj = {
      id: resId,
      referenceCode: refCode,
      customerFirstName: "Maria",
      customerLastName: "Clara",
      attendanceReconfirmedAt: null,
    };

    const result = processAttendanceReconfirmation({
      referenceCode: refCode,
      token,
      reservation: resObj,
      now: fixedNow,
      secret,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyReconfirmed).toBe(false);
    expect(result.attendanceReconfirmedAt).toBe(fixedNow.toISOString());
    expect(result.timelineEntry).toContain("Maria Clara reconfirmed attendance");
  });

  it("MS69-TC06: Reconfirmation Idempotency & Duplicate Guard returns graceful confirmation without mutating timestamp", () => {
    const refCode = "REF-RECONFIRM-2";
    const resId = "res-reconfirm-2";
    const secret = "test-secret-key-123";
    const token = generateAttendanceReconfirmToken(refCode, resId, secret);

    const initialTimestamp = "2026-10-20T08:15:00.000Z";
    const resObj = {
      id: resId,
      referenceCode: refCode,
      customerFirstName: "Juan",
      customerLastName: "Luna",
      attendanceReconfirmedAt: initialTimestamp, // already reconfirmed
    };

    const result = processAttendanceReconfirmation({
      referenceCode: refCode,
      token,
      reservation: resObj,
      now: fixedNow,
      secret,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyReconfirmed).toBe(true);
    expect(result.attendanceReconfirmedAt).toBe(initialTimestamp); // Preserves original timestamp
    expect(result.message).toContain("previously confirmed");
  });

  it("MS69-TC07: Reservation Activity Timeline Entry includes attendance reconfirmation", async () => {
    const memoryRepo = new ReservationMemoryRepository();
    const resId = "res-timeline-test-1";
    const reconfirmedTime = "2026-10-20T09:45:00.000Z";

    (memoryRepo as any).reservations.push({
      id: resId,
      referenceCode: "REF-TIMELINE-1",
      source: "WEB",
      customerFirstName: "Reynard",
      customerLastName: "Rabanal",
      customerEmail: "reynard@example.com",
      status: "CONFIRMED",
      rateSnapshot: 100,
      amountDue: 500,
      currency: "PHP",
      createdAt: "2026-10-18T10:00:00.000Z",
      updatedAt: "2026-10-20T09:45:00.000Z",
      confirmedAt: "2026-10-18T10:05:00.000Z",
      reminderSentAt: "2026-10-20T08:00:00.000Z",
      attendanceReconfirmedAt: reconfirmedTime,
      candidates: [
        {
          id: "cand-1",
          rank: 0,
          workspaceInstanceId: "ws-1",
          workspaceDisplayName: "Hot Desk 01",
          startAt: "2026-10-20T14:00:00.000Z",
          endAt: "2026-10-20T18:00:00.000Z",
          isAssigned: true,
        },
      ],
    });

    const detail = await memoryRepo.getAdminReservationDetail(resId);
    expect(detail).toBeDefined();
    expect(detail?.attendanceReconfirmedAt).toBe(reconfirmedTime);

    const expectedDateStr = formatTimelineDate(reconfirmedTime);
    const expectedEntry = `${expectedDateStr} - Reynard Rabanal reconfirmed attendance`;
    expect(detail?.timeline).toContain(expectedEntry);
  });

  it("MS69-TC08: Reconfirmation Public Landing Page Rendering includes verified badge and live pass CTA", () => {
    const pagePath = path.resolve(
      __dirname,
      "../apps/customer-website/src/app/reconfirm/page.tsx"
    );
    const pageSource = fs.readFileSync(pagePath, "utf-8");

    expect(pageSource).toContain('data-testid="reconfirm-success-card"');
    expect(pageSource).toContain('data-testid="view-live-pass-button"');
    expect(pageSource).toContain("Attendance Reconfirmed!");
    expect(pageSource).toContain("View Live Booking Pass");
  });

  it("MS69-TC09: Admin Cancellation Receipt Email Dispatch is wired into customer self-cancellation route", () => {
    const routePath = path.resolve(
      __dirname,
      "../apps/customer-website/src/app/api/track/cancel/route.ts"
    );
    const routeSource = fs.readFileSync(routePath, "utf-8");

    expect(routeSource).toContain("sendAdminCancellationReceiptEmail");
    expect(routeSource).toContain("businessSettings?.contactEmail?.trim()");
    expect(routeSource).toContain("noticeHours");
  });

  it("MS69-TC10: Admin Cancellation Email Content Verification contains refund status and triage link", () => {
    const emailParams = {
      to: "admin@deskatlas.com",
      referenceCode: "REF-CANCEL-RECEIPT",
      customerFirstName: "Jose",
      customerLastName: "Rizal",
      customerEmail: "jose@example.com",
      customerPhone: "+639171234567",
      workspaceName: "Dedicated Pod A",
      scheduledWindow: "Oct 22, 2026 10:00 AM - 12:00 PM",
      cancelledAt: "2026-10-20T10:00:00.000Z",
      noticeHours: 48,
      cutoffNoticeDisplay: "12 hours",
      amountDue: 850,
      paymentMethod: "GCASH",
      paymentAttemptId: "pay-attempt-99",
      reservationId: "res-cancel-99",
      adminPortalUrl: "https://manage.thedeskatlas.com",
    };

    const rendered = renderAdminCancellationReceiptEmail(emailParams);
    expect(rendered.subject).toContain("[CANCELLATION RECEIPT] Customer Self-Cancelled Reservation #REF-CANCEL-RECEIPT - DeskAtlas");
    expect(rendered.html).toContain("Jose Rizal");
    expect(rendered.html).toContain("REF-CANCEL-RECEIPT");
    expect(rendered.html).toContain("Dedicated Pod A");
    expect(rendered.html).toContain("48 hours prior to start");
    expect(rendered.html).toContain("ELIGIBLE (100% Refund of ₱850)");
    expect(rendered.text).toContain("https://manage.thedeskatlas.com/manage/reservations?filter=cancelled_refund_eligible&id=res-cancel-99");
    expect(rendered.html).toContain("https://manage.thedeskatlas.com/manage/reservations?filter=cancelled_refund_eligible&amp;id=res-cancel-99");
  });

  it("MS69-TC11: Admin Push Notification: Reminder Dispatched creates CUSTOMER_REMINDER_SENT alert", async () => {
    const reportsRepo = createMockReportsRepo([
      {
        reservationId: "res-rem-notif-1",
        referenceCode: "REF-REM-1",
        customerFirstName: "Andres",
        customerLastName: "Bonifacio",
        workspaceDisplayName: "Hot Desk 10",
        reservationStatus: "CONFIRMED",
        reminderSentAt: "2026-10-20T08:00:00.000Z",
        createdAt: "2026-10-18T10:00:00.000Z",
      },
    ]);

    const notifService = createAdminNotificationService({
      reportsRepo,
      staffOpsRepo: createMockStaffOpsRepo(),
    });

    const result = await notifService.listNotifications(50);
    const reminderAlert = result.notifications.find((n) => n.type === "CUSTOMER_REMINDER_SENT");

    expect(reminderAlert).toBeDefined();
    expect(reminderAlert?.title).toBe("Reservation Reminder Dispatched");
    expect(reminderAlert?.description).toContain("Advance reminder email sent to Andres Bonifacio for reservation #REF-REM-1 (Hot Desk 10)");
    expect(reminderAlert?.link).toBe("/manage/reservations?id=res-rem-notif-1");

    // Check NotificationCenter.tsx config
    const notifCenterPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/notifications/components/NotificationCenter.tsx"
    );
    const notifCenterSource = fs.readFileSync(notifCenterPath, "utf-8");
    expect(notifCenterSource).toContain('"CUSTOMER_REMINDER_SENT"');
    expect(notifCenterSource).toContain("#2563EB");
  });

  it("MS69-TC12: Admin Push Notification: Self-Cancellation Refund creates CUSTOMER_REFUND_ELIGIBLE alert", async () => {
    const reportsRepo = createMockReportsRepo([
      {
        reservationId: "res-cancel-refund-1",
        referenceCode: "REF-CANCEL-1",
        customerFirstName: "Gabriela",
        customerLastName: "Silang",
        reservationStatus: "CANCELLED",
        refundStatus: "REQUIRED",
        amountDue: 600,
        createdAt: "2026-10-18T10:00:00.000Z",
        updatedAt: "2026-10-20T09:00:00.000Z",
      },
    ]);

    const notifService = createAdminNotificationService({
      reportsRepo,
      staffOpsRepo: createMockStaffOpsRepo(),
    });

    const result = await notifService.listNotifications(50);
    const refundAlert = result.notifications.find(
      (n) => n.type === "CUSTOMER_REFUND_ELIGIBLE" && n.title === "Refund Due: Customer Cancellation"
    );

    expect(refundAlert).toBeDefined();
    expect(refundAlert?.description).toContain("Gabriela Silang cancelled reservation #REF-CANCEL-1 within policy notice.");
    expect(refundAlert?.description).toContain("Full refund of ₱600 is eligible for disbursement.");
    expect(refundAlert?.link).toBe("/manage/reservations?filter=cancelled_refund_eligible&id=res-cancel-refund-1");

    // Check NotificationCenter.tsx config
    const notifCenterPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/notifications/components/NotificationCenter.tsx"
    );
    const notifCenterSource = fs.readFileSync(notifCenterPath, "utf-8");
    expect(notifCenterSource).toContain('"CUSTOMER_REFUND_ELIGIBLE"');
    expect(notifCenterSource).toContain("#B45309");
  });

  it("MS69-TC13: Admin Push Notification: Overdue Review Refund creates alert for unreviewed payment", async () => {
    const reportsRepo = createMockReportsRepo(
      [
        {
          reservationId: "res-overdue-1",
          referenceCode: "REF-OVERDUE-1",
          customerFirstName: "Apolinario",
          customerLastName: "Mabini",
          createdAt: "2026-10-18T10:00:00.000Z",
        },
      ],
      [
        {
          paymentAttemptId: "pay-overdue-1",
          reservationId: "res-overdue-1",
          paymentStatus: "UNDER_REVIEW",
          refundStatus: "REQUIRED",
          amount: 1200,
          overdueNotifiedAt: "2026-10-20T09:30:00.000Z",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
      ]
    );

    const notifService = createAdminNotificationService({
      reportsRepo,
      staffOpsRepo: createMockStaffOpsRepo(),
    });

    const result = await notifService.listNotifications(50);
    const overdueAlert = result.notifications.find(
      (n) => n.type === "CUSTOMER_REFUND_ELIGIBLE" && n.title === "Refund Due: Overdue Payment Review"
    );

    expect(overdueAlert).toBeDefined();
    expect(overdueAlert?.description).toContain("Payment for reservation #REF-OVERDUE-1 (Apolinario Mabini) passed scheduled start time unreviewed.");
    expect(overdueAlert?.description).toContain("Eligible for 100% refund of ₱1,200.");
    expect(overdueAlert?.link).toBe("/manage/payments?tab=OVERDUE&id=pay-overdue-1");
  });

  it("MS69-TC14: Zero Em-Dashes & Design Token Conformance enforces strict repository quality bans", () => {
    const targetFiles = [
      "packages/domain/src/services/reservationReminderService.ts",
      "packages/domain/src/services/transactionalEmailService.ts",
      "apps/customer-website/src/app/reconfirm/page.tsx",
      "apps/customer-website/src/app/api/track/reconfirm/route.ts",
      "apps/customer-website/src/app/api/track/cancel/route.ts",
      "apps/admin-portal/src/features/notifications/components/NotificationCenter.tsx",
      "apps/admin-portal/src/app/manage/layout.tsx",
      "apps/admin-portal/src/features/settings/components/Settings.tsx",
      "tests/ms69-reservation-reminders-and-push-alerts.test.ts",
    ];

    for (const relPath of targetFiles) {
      const fullPath = path.resolve(__dirname, "..", relPath);
      const content = fs.readFileSync(fullPath, "utf-8");

      // BAN-PUNCT-01: Zero em-dashes
      expect(content).not.toContain("\u2014");

      // BAN-UI-09: Established palette tokens check
      if (relPath.endsWith("reconfirm/page.tsx")) {
        expect(content).toContain("#047857"); // Emerald palette
      }
      if (relPath.endsWith("NotificationCenter.tsx")) {
        expect(content).toContain("#2563EB"); // Blue reminder token
        expect(content).toContain("#B45309"); // Amber refund token
      }
    }
  });
});
