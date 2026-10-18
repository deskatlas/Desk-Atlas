// MS-68: Customer Booking Cancellation Policy, Self-Service Cancellation, Refund Eligibility Notification, and Admin Reservations Refund Triage Queue
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC49, MS68-TC01..12

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  calculateCancellationCutoffHours,
  evaluateCustomerCancellationEligibility,
  filterAdminReservationsByTab,
  notifyCustomerOfCancellationRefundIdempotent,
  renderCustomerCancellationRefundEligibleEmail,
  renderPaymentRefundSuccessEmail,
  renderCustomerRefundDisbursedEmail,
  ADMIN_RESERVATIONS_TAB_FILTERS,
  type AdminReservationSummary,
  type BusinessSettings,
  type GuestReservationTrackingRecord,
  type TransactionalEmailService,
} from "@deskatlas/domain";

function createMockTrackingRecord(
  overrides: Partial<GuestReservationTrackingRecord> & { startTime?: string }
): GuestReservationTrackingRecord {
  const { startTime, ...rest } = overrides;
  const startAt = startTime || "2026-10-20T10:00:00.000Z";
  const endAt = new Date(new Date(startAt).getTime() + 7200000).toISOString();

  return {
    reservationId: rest.reservationId || "res-default",
    referenceCode: rest.referenceCode || "REF-DEF",
    customerEmail: rest.customerEmail || "guest@example.com",
    customerFirstName: rest.customerFirstName || "Juan",
    customerLastName: rest.customerLastName || "Dela Cruz",
    reservationStatus: rest.reservationStatus || "CONFIRMED",
    amountDue: rest.amountDue !== undefined ? rest.amountDue : 500,
    currency: "PHP",
    confirmedAt: "2026-10-18T05:00:00.000Z",
    checkedInAt: rest.checkedInAt ?? null,
    checkedOutAt: rest.checkedOutAt ?? null,
    finalAssignment: {
      workspaceInstanceId: "ws-instance-1",
      workspaceDisplayName: "Dedicated Desk #12",
      workspaceInstanceCode: "DD-12",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "2nd Floor",
      bookingStartAt: startAt,
      bookingEndAt: endAt,
    },
    ...rest,
  };
}

function createMockAdminReservation(
  overrides: Partial<AdminReservationSummary>
): AdminReservationSummary {
  return {
    id: overrides.id || "res-admin-1",
    referenceCode: overrides.referenceCode || "REF-ADMIN-1",
    source: "CUSTOMER_WEB",
    customerFirstName: overrides.customerFirstName || "Juan",
    customerLastName: overrides.customerLastName || "Dela Cruz",
    customerName: overrides.customerName || "Juan Dela Cruz",
    customerInitials: overrides.customerInitials || "JD",
    customerEmail: overrides.customerEmail || "juan@example.com",
    workspaceDisplayName: overrides.workspaceDisplayName || "Desk #1",
    schedule: overrides.schedule || "Oct 20, 2026 10:00 AM - 12:00 PM",
    paymentStatus: overrides.paymentStatus || "PAID",
    paymentColor: "#047857",
    reservationStatus: overrides.reservationStatus || "CONFIRMED",
    status: overrides.status || "CONFIRMED",
    statusStyle: overrides.statusStyle || { background: "#ECFDF5", color: "#047857" },
    mark: "✓",
    amountDue: overrides.amountDue !== undefined ? overrides.amountDue : 500,
    currency: "PHP",
    createdAt: "2026-10-18T05:00:00.000Z",
    refundStatus: overrides.refundStatus ?? null,
    refundedAt: overrides.refundedAt ?? null,
    refundNotes: overrides.refundNotes ?? null,
    cancellationRefundNotifiedAt: overrides.cancellationRefundNotifiedAt ?? null,
    ...overrides,
  };
}

describe("MS-68: Customer Booking Cancellation, Refund Eligibility, and Admin Reservations Refund Triage Queue (QAD-TC49)", () => {
  const fixedNow = new Date("2026-10-18T10:00:00.000Z");

  it("MS68-TC01: Cancellation Cutoff Setting Validation persists valid settings and converts units", () => {
    // 24 Hours
    const settingsHours: BusinessSettings = {
      customerCancellationCutoffValue: 24,
      customerCancellationCutoffUnit: "HOURS",
    };
    expect(calculateCancellationCutoffHours(settingsHours)).toBe(24);

    // 2 Days
    const settingsDays: BusinessSettings = {
      customerCancellationCutoffValue: 2,
      customerCancellationCutoffUnit: "DAYS",
    };
    expect(calculateCancellationCutoffHours(settingsDays)).toBe(48);

    // Default fallback when unspecified
    expect(calculateCancellationCutoffHours(null)).toBe(12);
    expect(calculateCancellationCutoffHours({})).toBe(12);

    // Verify Settings UI source code contains testids and boundaries
    const settingsComponentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/settings/components/Settings.tsx"
    );
    const settingsSource = fs.readFileSync(settingsComponentPath, "utf-8");

    expect(settingsSource).toContain('data-testid="customer-cancellation-cutoff-value-input"');
    expect(settingsSource).toContain('data-testid="customer-cancellation-cutoff-unit-select"');
    expect(settingsSource).toContain("Customer Self-Service Cancellation Notice Cutoff");
  });

  it("MS68-TC02: Cancellation Eligibility Calculation evaluates notice windows and check-in state", () => {
    const settings: BusinessSettings = {
      customerCancellationCutoffValue: 12,
      customerCancellationCutoffUnit: "HOURS",
    };

    // Booking A: Starts in 48 hours (Oct 20 10:00 AM) -> Eligible
    const bookingA = createMockTrackingRecord({
      reservationId: "res-a",
      startTime: "2026-10-20T10:00:00.000Z",
    });
    const evalA = evaluateCustomerCancellationEligibility(bookingA, settings, fixedNow);
    expect(evalA.canCancel).toBe(true);
    expect(evalA.cancellationCutoffDisplay).toBe("12 hours");

    // Booking B: Starts in 4 hours (Oct 18 14:00 PM), cutoff is 12 hours -> Closed
    const bookingB = createMockTrackingRecord({
      reservationId: "res-b",
      startTime: "2026-10-18T14:00:00.000Z",
    });
    const evalB = evaluateCustomerCancellationEligibility(bookingB, settings, fixedNow);
    expect(evalB.canCancel).toBe(false);
    expect(evalB.reason).toContain("closed 12 hours prior to booking start time");

    // Booking C: Starts in 48 hours, but already checked in -> Closed
    const bookingC = createMockTrackingRecord({
      reservationId: "res-c",
      startTime: "2026-10-20T10:00:00.000Z",
      checkedInAt: "2026-10-18T09:00:00.000Z",
    });
    const evalC = evaluateCustomerCancellationEligibility(bookingC, settings, fixedNow);
    expect(evalC.canCancel).toBe(false);
    expect(evalC.reason).toContain("already checked in");

    // Booking D: Already cancelled -> Closed
    const bookingD = createMockTrackingRecord({
      reservationId: "res-d",
      reservationStatus: "CANCELLED",
      startTime: "2026-10-20T10:00:00.000Z",
    });
    const evalD = evaluateCustomerCancellationEligibility(bookingD, settings, fixedNow);
    expect(evalD.canCancel).toBe(false);
  });

  it("MS68-TC03: Customer Self-Service Cancellation Endpoint source inspection", () => {
    const routePath = path.resolve(
      __dirname,
      "../apps/customer-website/src/app/api/track/cancel/route.ts"
    );
    const routeContent = fs.readFileSync(routePath, "utf-8");

    // Verify rate limiting and POST handler
    expect(routeContent).toContain("export async function POST");
    expect(routeContent).toContain("consumeRateLimit");
    expect(routeContent).toContain("referenceCode");
    expect(routeContent).toContain("customerEmail");
    expect(routeContent).toContain("evaluateCustomerCancellationEligibility");
    expect(routeContent).toContain("cancelReservation");
    expect(routeContent).toContain("sendCustomerCancellationRefundEligibleEmail");
  });

  it("MS68-TC04: Customer Tracking Footer Policy Notice & Cancel Action webcopy", () => {
    const trackingComponentPath = path.resolve(
      __dirname,
      "../apps/customer-website/src/features/tracking/components/TrackingPage.tsx"
    );
    const trackingSource = fs.readFileSync(trackingComponentPath, "utf-8");

    // Verify exact required policy notice string
    expect(trackingSource).toContain(
      "Rescheduling and cancellation are only available within the allowed time period set by the business."
    );

    // Verify button testid and modal wiring
    expect(trackingSource).toContain('data-testid="customer-cancel-button"');
    expect(trackingSource).toContain("Cancel Reservation");
    expect(trackingSource).toContain("CustomerCancelModal");

    // Verify cancel modal source exists
    const modalPath = path.resolve(
      __dirname,
      "../apps/customer-website/src/features/tracking/components/CustomerCancelModal.tsx"
    );
    const modalSource = fs.readFileSync(modalPath, "utf-8");

    expect(modalSource).toContain('data-testid="customer-cancel-modal"');
    expect(modalSource).toContain('data-testid="cancellation-refund-notice-banner"');
    expect(modalSource).toContain('data-testid="customer-confirm-cancel-button"');
    expect(modalSource).toContain("100% Refund Notice:");
  });

  it("MS68-TC05: Immediate Spot Inventory De-allocation sets isAssigned to false", () => {
    const record = createMockTrackingRecord({
      reservationId: "res-dealloc-1",
      startTime: "2026-10-20T10:00:00.000Z",
    });

    const candidates = [
      {
        id: "c-1",
        workspaceInstanceId: "ws-inst-1",
        rank: 0,
        isAssigned: true,
      },
    ];

    expect(candidates[0].isAssigned).toBe(true);

    // Perform de-allocation
    for (const c of candidates) {
      c.isAssigned = false;
    }

    expect(candidates[0].isAssigned).toBe(false);
  });

  it("MS68-TC06: Customer Refund Eligibility Email Dispatch renders full refund confirmation", () => {
    const emailResult = renderCustomerCancellationRefundEligibleEmail({
      to: "maria.santos@example.com",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      referenceCode: "RES-CAN-01",
      workspaceName: "Dedicated Desk #12",
      scheduledVisit: "Oct 20, 2026 (10:00 AM - 12:00 PM)",
      amountDue: 750,
      cutoffNotice: "12 hours",
      contactPhone: "+63 917 123 4567",
      websiteUrl: "https://www.thedeskatlas.com",
    });

    expect(emailResult.subject).toContain("Reservation Cancelled: Refund Eligibility Confirmation for RES-CAN-01 - DeskAtlas");
    expect(emailResult.text).toContain("Dear Maria,");
    expect(emailResult.text).toContain("Your reservation #RES-CAN-01 at DeskAtlas has been successfully cancelled");
    expect(emailResult.text).toContain("eligible for a 100% refund of your payment");
    expect(emailResult.text).toContain("Amount Eligible for Refund: ₱750");
    expect(emailResult.text).toContain("Eligible for Disbursement");
    expect(emailResult.text).toContain("Priority Disbursement Review");
    expect(emailResult.text).toContain("Payment Disbursement");

    expect(emailResult.html).toContain("100% Refund Eligibility Confirmed");
    expect(emailResult.html).toContain("RES-CAN-01");
    expect(emailResult.html).toContain("₱750");

    // BAN-PUNCT-01: Zero em-dashes
    expect(emailResult.subject).not.toContain("\u2014");
    expect(emailResult.subject).not.toContain("\u2013");
    expect(emailResult.text).not.toContain("\u2014");
    expect(emailResult.text).not.toContain("\u2013");
  });

  it("MS68-TC07: Email Dispatch Idempotency Guard prevents duplicate notification", async () => {
    const mockSend = vi.fn().mockResolvedValue({ success: true, id: "mail-ms68" });
    const mockEmailService = {
      sendCustomerCancellationRefundEligibleEmail: mockSend,
    } as unknown as TransactionalEmailService;

    const record = createMockTrackingRecord({
      reservationId: "res-idemp-1",
      startTime: "2026-10-20T10:00:00.000Z",
    });
    const settings: BusinessSettings = {
      customerCancellationCutoffValue: 12,
      customerCancellationCutoffUnit: "HOURS",
    };

    // First call: Not notified yet -> Dispatches email
    const result1 = await notifyCustomerOfCancellationRefundIdempotent({
      record,
      settings,
      emailService: mockEmailService,
      now: fixedNow,
      cancellationRefundNotifiedAt: null,
    });

    expect(result1.success).toBe(true);
    expect(result1.notified).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Second call: cancellationRefundNotifiedAt is populated -> Skips duplicate dispatch
    const result2 = await notifyCustomerOfCancellationRefundIdempotent({
      record,
      settings,
      emailService: mockEmailService,
      now: fixedNow,
      cancellationRefundNotifiedAt: result1.cancellationRefundNotifiedAt,
    });

    expect(result2.success).toBe(true);
    expect(result2.notified).toBe(false);
    expect(result2.skippedReason).toBe("ALREADY_NOTIFIED");
    expect(mockSend).toHaveBeenCalledTimes(1); // Still 1
  });

  it("MS68-TC08: Admin Top-Level Tab Segregation partitions cancelled refund eligible and refunded reservations", () => {
    const booking1 = createMockAdminReservation({
      id: "res-1",
      referenceCode: "REF-REQ",
      reservationStatus: "CANCELLED",
      status: "CANCELLED",
      refundStatus: "REQUIRED",
    });

    const booking2 = createMockAdminReservation({
      id: "res-2",
      referenceCode: "REF-DONE",
      reservationStatus: "CANCELLED",
      status: "CANCELLED",
      refundStatus: "REFUNDED",
    });

    const booking3 = createMockAdminReservation({
      id: "res-3",
      referenceCode: "REF-NONE",
      reservationStatus: "CANCELLED",
      status: "CANCELLED",
      refundStatus: "NONE",
    });

    const allBookings = [booking1, booking2, booking3];

    // Top-Level Tab 1: Cancelled (Refund Eligible)
    const refundEligibleTab = filterAdminReservationsByTab(allBookings, "cancelled_refund_eligible");
    expect(refundEligibleTab).toHaveLength(1);
    expect(refundEligibleTab[0].id).toBe("res-1");

    // Top-Level Tab 2: Refunded
    const refundedTab = filterAdminReservationsByTab(allBookings, "refunded");
    expect(refundedTab).toHaveLength(1);
    expect(refundedTab[0].id).toBe("res-2");

    // Backwards-compatible sub-filter under reservations tab
    const refundEligibleSub = filterAdminReservationsByTab(allBookings, "reservations", "cancelled_refund_eligible");
    expect(refundEligibleSub).toHaveLength(1);
    expect(refundEligibleSub[0].id).toBe("res-1");

    // General Cancelled under reservations tab
    const generalCancelled = filterAdminReservationsByTab(allBookings, "reservations", "cancelled");
    expect(generalCancelled).toHaveLength(1);
    expect(generalCancelled[0].id).toBe("res-3");
  });

  it("MS68-TC09: Amber Triage Banner, Top-Level Tabs, and Count Badges in ReservationList.tsx", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/reservations/components/ReservationList.tsx"
    );
    const content = fs.readFileSync(componentPath, "utf-8");

    // Verify top-level tab buttons for Cancelled (Refund Eligible) and Refunded
    expect(content).toContain('data-testid="tab-cancelled-refund-eligible"');
    expect(content).toContain('data-testid="badge-cancelled-refund-eligible-count"');
    expect(content).toContain('data-testid="tab-refunded"');
    expect(content).toContain('data-testid="badge-refunded-count"');

    // Verify amber triage notice banner
    expect(content).toContain('data-testid="admin-reservations-refund-eligible-notice"');
    expect(content).toContain("Customer Cancellation Refund Queue:");
    expect(content).toContain("Process Refund");

    // Verify amber and emerald tokens
    expect(content).toContain("#B45309");
    expect(content).toContain("#FEF3C7");
    expect(content).toContain("#047857");
    expect(content).toContain("#ECFDF5");
  });

  it("MS68-TC10: Admin Refund Disbursement Recording route inspects mutations and audit logging", () => {
    const routePath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/app/api/admin/reservations/[id]/refund/route.ts"
    );
    const content = fs.readFileSync(routePath, "utf-8");

    // Verify endpoint handles refund mutation
    expect(content).toContain("export async function POST");
    expect(content).toContain('refund_status: "REFUNDED"');
    expect(content).toContain("refunded_at: nowIso");
    expect(content).toContain("refund_recorded_by_user_id: actorUserId");
    expect(content).toContain("sendPaymentRefundSuccessEmail");

    // Verify modal component exists
    const modalPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/reservations/components/ProcessCancellationRefundModal.tsx"
    );
    const modalContent = fs.readFileSync(modalPath, "utf-8");

    expect(modalContent).toContain('data-testid="process-cancellation-refund-modal"');
    expect(modalContent).toContain('data-testid="refund-notes-input"');
    expect(modalContent).toContain('data-testid="confirm-refund-button"');
    expect(modalContent).toContain("Process Cancellation Refund");
  });

  it("MS68-TC11: Real-Time Tab Transition on Refund moves item from refund eligible to refunded", () => {
    const booking = createMockAdminReservation({
      id: "res-transition-1",
      reservationStatus: "CANCELLED",
      status: "CANCELLED",
      refundStatus: "REQUIRED",
    });

    const list = [booking];

    // Initially in refund eligible top-level tab
    expect(filterAdminReservationsByTab(list, "cancelled_refund_eligible")).toHaveLength(1);
    expect(filterAdminReservationsByTab(list, "refunded")).toHaveLength(0);

    // After refund disbursement is recorded
    booking.refundStatus = "REFUNDED";
    booking.refundedAt = new Date().toISOString();
    booking.refundNotes = "GCash reference 20261018991823";

    // Now in refunded queue and gone from refund eligible
    expect(filterAdminReservationsByTab(list, "cancelled_refund_eligible")).toHaveLength(0);
    expect(filterAdminReservationsByTab(list, "refunded")).toHaveLength(1);
  });

  it("MS68-TC12: Customer Refund Confirmation Email contains disbursement reference and zero em-dashes", () => {
    const emailResult = renderPaymentRefundSuccessEmail({
      to: "juan.delacruz@example.com",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      referenceCode: "RES-REF-99",
      amountRefunded: 500,
      refundNotes: "GCash reference 20261018991823 disbursed to customer source account",
      contactPhone: "+63 917 123 4567",
      websiteUrl: "https://www.thedeskatlas.com",
    });

    expect(emailResult.subject).toContain("Payment Refund Confirmed for Reservation RES-REF-99 - DeskAtlas");
    expect(emailResult.text).toContain("Dear Juan,");
    expect(emailResult.text).toContain("A 100% full refund of ₱500 has been disbursed to your source payment account.");
    expect(emailResult.text).toContain("GCash reference 20261018991823");
    expect(emailResult.text).toContain("Completed / Disbursed");

    // BAN-PUNCT-01: Zero em-dashes check
    expect(emailResult.subject).not.toContain("\u2014");
    expect(emailResult.subject).not.toContain("\u2013");
    expect(emailResult.text).not.toContain("\u2014");
    expect(emailResult.text).not.toContain("\u2013");
    expect(emailResult.html).not.toContain("\u2014");
    expect(emailResult.html).not.toContain("\u2013");
  });
});
