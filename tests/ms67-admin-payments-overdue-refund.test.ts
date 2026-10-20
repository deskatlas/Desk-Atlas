// MS-67: Admin Payment Review Overdue Detection, Customer Refund Notification, and Segregated Triage Queue
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E10, ERD-E11, ERD-E13, QAD-TC48, MS67-TC01..08

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assignCanonicalQueueRanks,
  evaluateAndSegregatePaymentReviews,
  formatOverdueElapsedDuration,
  formatOverdueElapsedApproxHours,
  isPaymentReviewOverdue,
  notifyCustomerOfOverdueReviewIdempotent,
  renderPaymentReviewOverdueRefundEmail,
  renderPaymentRefundSuccessEmail,
  sortPaymentReviewQueue,
  type PaymentReviewQueueItem,
  type RankedPaymentReviewQueueItem,
  type TransactionalEmailService,
} from "@deskatlas/domain";

function createMockItem(overrides: Partial<PaymentReviewQueueItem> & { startTime?: string }): PaymentReviewQueueItem {
  const { startTime, ...rest } = overrides;
  return {
    paymentAttemptId: rest.paymentAttemptId || "pay-default",
    reservationId: rest.reservationId || "res-default",
    reservationReferenceCode: rest.reservationReferenceCode || "REF-DEF",
    reservationStatus: "AWAITING_PAYMENT_PROOF",
    paymentStatus: rest.paymentStatus || "UNDER_REVIEW",
    customerFirstName: rest.customerFirstName || "Test",
    customerLastName: rest.customerLastName || "Customer",
    customerEmail: rest.customerEmail || "customer@example.com",
    amountDue: rest.amountDue !== undefined ? rest.amountDue : 500,
    currency: "PHP",
    paymentMethodId: "pm-online",
    proofSubmittedAt: rest.proofSubmittedAt !== undefined ? rest.proofSubmittedAt : "2026-10-18T06:30:00.000Z",
    submittedCandidates: startTime
      ? [
        {
          rank: 0,
          workspaceInstanceId: "ws-1",
          startAt: startTime,
          endAt: new Date(new Date(startTime).getTime() + 7200000).toISOString(),
          isAssigned: false,
        },
      ]
      : rest.submittedCandidates || [],
    overdueNotifiedAt: rest.overdueNotifiedAt ?? null,
    refundStatus: rest.refundStatus || "NONE",
    ...rest,
  };
}

describe("MS-67: Admin Payment Review Overdue Detection, Customer Refund Notification, and Segregated Triage Queue (QAD-TC48)", () => {
  const fixedNow = new Date("2026-10-18T09:30:00.000Z");

  it("MS67-TC01: Overdue Review Segregation partitions expired start times into overdue queue and future start times into active queue", () => {
    // Item A: Start in +2 hours (11:30 AM) -> Active
    const itemA = createMockItem({
      paymentAttemptId: "pay-a",
      reservationReferenceCode: "RES-A",
      startTime: "2026-10-18T11:30:00.000Z",
      proofSubmittedAt: "2026-10-18T06:00:00.000Z",
    });

    // Item B: Start was 30 mins ago (09:00 AM) -> Overdue
    const itemB = createMockItem({
      paymentAttemptId: "pay-b",
      reservationReferenceCode: "RES-B",
      startTime: "2026-10-18T09:00:00.000Z",
      proofSubmittedAt: "2026-10-18T06:15:00.000Z",
    });

    // Item C: Start was 3 hours ago (06:30 AM) -> Overdue
    const itemC = createMockItem({
      paymentAttemptId: "pay-c",
      reservationReferenceCode: "RES-C",
      startTime: "2026-10-18T06:30:00.000Z",
      proofSubmittedAt: "2026-10-18T06:20:00.000Z",
    });

    const result = evaluateAndSegregatePaymentReviews([itemA, itemB, itemC], fixedNow);

    expect(result.activeQueue).toHaveLength(1);
    expect(result.activeQueue[0].paymentAttemptId).toBe("pay-a");
    expect(result.activeQueue[0].isOverdue).toBe(false);

    expect(result.overdueQueue).toHaveLength(2);
    expect(result.overdueQueue.map((i) => i.paymentAttemptId)).toEqual(["pay-b", "pay-c"]);
    expect(result.overdueQueue[0].isOverdue).toBe(true);
    expect(result.overdueQueue[1].isOverdue).toBe(true);
  });

  it("MS67-TC02: Three-Way Filter Pill Rendering webcopy and count badges in PaymentQueue.tsx", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Verify 3 tabs present with exact data-testid attributes
    expect(fileContent).toContain('data-testid="tab-awaiting-review"');
    expect(fileContent).toContain('data-testid="tab-overdue-reviews"');
    expect(fileContent).toContain('data-testid="tab-rejected-payments"');

    // Verify approved webcopy for tabs
    expect(fileContent).toContain("<span>Awaiting Review</span>");
    expect(fileContent).toContain("<span>Overdue (Refund Eligible)</span>");
    expect(fileContent).toContain("<span>Rejected Payments</span>");

    // Verify count badges testids and values
    expect(fileContent).toContain('data-testid="badge-awaiting-review-count"');
    expect(fileContent).toContain('data-testid="badge-overdue-count"');
    expect(fileContent).toContain('data-testid="badge-rejected-count"');

    // Verify styling tokens: amber alert colors for overdue tab
    expect(fileContent).toContain("#B45309");
    expect(fileContent).toContain("#FEF3C7");
  });

  it("MS67-TC03: Pill Selection and Overdue Notice Webcopy in PaymentQueue.tsx", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Verify notice banner and webcopy
    expect(fileContent).toContain('data-testid="admin-payments-overdue-notice"');
    expect(fileContent).toContain("Missed Review Notice:");
    expect(fileContent).toContain(
      "These bookings passed their scheduled start time prior to administrative review. Customers have been automatically notified that they are eligible for a refund."
    );
    expect(fileContent).toContain("OVERDUE (REFUND ELIGIBLE)");
  });

  it("MS67-TC04: Overdue Card Badge & Elapsed Time formatting", () => {
    // 7:00 AM booking when current time is 9:30 AM (2 hours 30 mins overdue)
    const startTimeIso = "2026-10-18T07:00:00.000Z";
    const detailedElapsed = formatOverdueElapsedDuration(startTimeIso, fixedNow);
    const approxHours = formatOverdueElapsedApproxHours(startTimeIso, fixedNow);

    expect(detailedElapsed).toBe("Overdue by 2h 30m");
    expect(approxHours).toBe("Overdue by 2 hours");

    // Exact 2 hours overdue (7:30 AM to 9:30 AM)
    const exactTwoHours = formatOverdueElapsedDuration("2026-10-18T07:30:00.000Z", fixedNow);
    expect(exactTwoHours).toBe("Overdue by 2 hours");

    // Component source check
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    expect(fileContent).toContain('data-testid="overdue-refund-badge"');
    expect(fileContent).toContain("MISSED REVIEW - ELIGIBLE FOR REFUND");
    expect(fileContent).toContain('data-testid="overdue-elapsed-text"');
    expect(fileContent).toContain('data-testid="review-refund-button"');
    expect(fileContent).toContain("Review & Refund");
  });

  it("MS67-TC05: Transactional Refund Email Rendering with apology, full refund guarantee, and reference code", () => {
    const emailResult = renderPaymentReviewOverdueRefundEmail({
      to: "maria.santos@example.com",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      referenceCode: "RES-98214A",
      bookingStartTime: "2026-10-18T07:00:00.000Z",
      amountDue: 600,
      contactPhone: "+63 917 555 0199",
      websiteUrl: "https://www.thedeskatlas.com",
    });

    expect(emailResult.subject).toContain("Action Required: Refund Eligibility for Reservation RES-98214A - DeskAtlas");
    expect(emailResult.text).toContain("Dear Maria,");
    expect(emailResult.text).toContain("We sincerely apologize.");
    expect(emailResult.text).toContain("eligible for a full refund of your payment (₱600)");
    expect(emailResult.text).toContain("Priority Refund Processing");
    expect(emailResult.text).toContain("Disbursement");
    expect(emailResult.text).toContain("Rescheduling Alternative");
    expect(emailResult.text).toContain("RES-98214A");
    expect(emailResult.text).toContain("+63 917 555 0199");

    expect(emailResult.html).toContain("Full Refund Entitlement");
    expect(emailResult.html).toContain("RES-98214A");
    expect(emailResult.html).toContain("₱600");
  });

  it("MS67-TC06: Notification Idempotency Guard prevents duplicate emails when overdueNotifiedAt is set", async () => {
    const mockSendEmail = vi.fn().mockResolvedValue({ success: true, id: "msg-123" });
    const mockEmailService = {
      sendPaymentReviewOverdueRefundEmail: mockSendEmail,
    } as unknown as TransactionalEmailService;

    // Item already notified
    const item = createMockItem({
      paymentAttemptId: "pay-already-notified",
      startTime: "2026-10-18T07:00:00.000Z",
      overdueNotifiedAt: "2026-10-18T07:05:00.000Z",
    });

    const result = await notifyCustomerOfOverdueReviewIdempotent({
      item,
      emailService: mockEmailService,
      now: fixedNow,
    });

    expect(result.notified).toBe(false);
    expect(result.skippedReason).toBe("ALREADY_NOTIFIED");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("MS67-TC07: Refund Status Transition from NONE to REQUIRED on newly overdue payment attempt", async () => {
    const mockSendEmail = vi.fn().mockResolvedValue({ success: true, id: "msg-999" });
    const mockEmailService = {
      sendPaymentReviewOverdueRefundEmail: mockSendEmail,
    } as unknown as TransactionalEmailService;

    const onRecordedMock = vi.fn();

    const item = createMockItem({
      paymentAttemptId: "pay-new-overdue",
      reservationReferenceCode: "RES-NEW",
      startTime: "2026-10-18T07:00:00.000Z",
      overdueNotifiedAt: null,
      refundStatus: "NONE",
    });

    const result = await notifyCustomerOfOverdueReviewIdempotent({
      item,
      emailService: mockEmailService,
      now: fixedNow,
      onNotificationRecorded: onRecordedMock,
    });

    expect(result.notified).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(item.refundStatus).toBe("REQUIRED");
    expect(item.overdueNotifiedAt).toBe(fixedNow.toISOString());
    expect(onRecordedMock).toHaveBeenCalledWith("pay-new-overdue", fixedNow.toISOString());
  });

  it("MS67-TC08: MS-66 Sorting Compatibility within the Overdue queue preserves canonical rank badges", () => {
    // 3 overdue items with different amounts and submission times
    const overdueA = createMockItem({
      paymentAttemptId: "overdue-a",
      amountDue: 250,
      startTime: "2026-10-18T06:00:00.000Z",
      proofSubmittedAt: "2026-10-18T05:00:00.000Z", // Rank 1
    });

    const overdueB = createMockItem({
      paymentAttemptId: "overdue-b",
      amountDue: 1500,
      startTime: "2026-10-18T06:30:00.000Z",
      proofSubmittedAt: "2026-10-18T05:15:00.000Z", // Rank 2
    });

    const overdueC = createMockItem({
      paymentAttemptId: "overdue-c",
      amountDue: 800,
      startTime: "2026-10-18T07:00:00.000Z",
      proofSubmittedAt: "2026-10-18T05:30:00.000Z", // Rank 3
    });

    const canonicalRanks: RankedPaymentReviewQueueItem[] = assignCanonicalQueueRanks([
      overdueC,
      overdueA,
      overdueB,
    ]);

    expect(canonicalRanks.map((i) => i.queueRank)).toEqual([1, 2, 3]);
    expect(canonicalRanks.map((i) => i.paymentAttemptId)).toEqual([
      "overdue-a",
      "overdue-b",
      "overdue-c",
    ]);

    // Sorting by AMOUNT_DESC: highest amount first (overdue-b @ 1500, overdue-c @ 800, overdue-a @ 250)
    const sortedAmountDesc = sortPaymentReviewQueue(canonicalRanks, "AMOUNT_DESC");
    expect(sortedAmountDesc.map((i) => i.paymentAttemptId)).toEqual([
      "overdue-b",
      "overdue-c",
      "overdue-a",
    ]);
    // Canonical ranks are strictly preserved!
    expect(sortedAmountDesc.map((i) => i.queueRank)).toEqual([2, 3, 1]);

    // Sorting by RANK_ASC: reverse queue rank (#3, #2, #1)
    const sortedRankAsc = sortPaymentReviewQueue(canonicalRanks, "RANK_ASC");
    expect(sortedRankAsc.map((i) => i.paymentAttemptId)).toEqual([
      "overdue-c",
      "overdue-b",
      "overdue-a",
    ]);
    expect(sortedRankAsc.map((i) => i.queueRank)).toEqual([3, 2, 1]);
  });

  it("MS67-TC09: Refunded Review Segregation & Immediate Disappearance from Overdue Queue", () => {
    // Item 1: Overdue item that is NOT refunded -> should be in overdueQueue
    const overdueItem = createMockItem({
      paymentAttemptId: "pay-overdue",
      reservationReferenceCode: "RES-OVERDUE",
      startTime: "2026-10-18T07:00:00.000Z",
      proofSubmittedAt: "2026-10-18T05:00:00.000Z",
      refundStatus: "REQUIRED",
    });

    // Item 2: Overdue item that had Refund Disbursed and Recorded -> should NOT be in overdueQueue
    const refundedItem = createMockItem({
      paymentAttemptId: "pay-refunded",
      reservationReferenceCode: "RES-REFUNDED",
      startTime: "2026-10-18T06:00:00.000Z",
      proofSubmittedAt: "2026-10-18T04:30:00.000Z",
      refundStatus: "REFUNDED",
      refundNotes: "Disbursed via GCash ref #123456",
    });

    // Item 3: Active future item -> should be in activeQueue
    const activeItem = createMockItem({
      paymentAttemptId: "pay-active",
      reservationReferenceCode: "RES-ACTIVE",
      startTime: "2026-10-18T12:00:00.000Z",
      proofSubmittedAt: "2026-10-18T08:00:00.000Z",
      refundStatus: "NONE",
    });

    // isPaymentReviewOverdue check
    expect(isPaymentReviewOverdue(overdueItem, fixedNow)).toBe(true);
    expect(isPaymentReviewOverdue(refundedItem, fixedNow)).toBe(false);
    expect(isPaymentReviewOverdue(activeItem, fixedNow)).toBe(false);

    // evaluateAndSegregatePaymentReviews partitioning
    const result = evaluateAndSegregatePaymentReviews([overdueItem, refundedItem, activeItem], fixedNow);

    expect(result.activeQueue.map((i) => i.paymentAttemptId)).toEqual(["pay-active"]);
    expect(result.overdueQueue.map((i) => i.paymentAttemptId)).toEqual(["pay-overdue"]);
    expect(result.refundedQueue.map((i) => i.paymentAttemptId)).toEqual(["pay-refunded"]);
    expect(result.overdueQueue.find((i) => i.paymentAttemptId === "pay-refunded")).toBeUndefined();
  });

  it("MS67-TC10: Customer Refund Confirmation Email Template generation with zero em-dashes", () => {
    const emailResult = renderPaymentRefundSuccessEmail({
      to: "maria.santos@example.com",
      customerFirstName: "Maria",
      customerLastName: "Santos",
      referenceCode: "RES-REF-992",
      amountRefunded: 750,
      refundNotes: "Transferred via GCash reference 009812743.",
      contactPhone: "+63 917 555 0199",
      websiteUrl: "https://www.thedeskatlas.com",
    });

    expect(emailResult.subject).toContain("Payment Refund Confirmed for Reservation RES-REF-992 - DeskAtlas");
    expect(emailResult.text).toContain("Dear Maria,");
    expect(emailResult.text).toContain("payment refund for reservation RES-REF-992 has been successfully disbursed and recorded");
    expect(emailResult.text).toContain("₱750");
    expect(emailResult.text).toContain("Transferred via GCash reference 009812743.");
    expect(emailResult.text).toContain("1-3 business days");

    expect(emailResult.html).toContain("Payment Refund Confirmed");
    expect(emailResult.html).toContain("RES-REF-992");
    expect(emailResult.html).toContain("₱750");
    expect(emailResult.html).toContain("Transferred via GCash reference 009812743.");
    expect(emailResult.html).toContain("Completed / Disbursed");

    // Strictly enforce BAN-PUNCT-01 (zero em-dashes in email templates)
    expect(emailResult.subject).not.toContain("—");
    expect(emailResult.text).not.toContain("—");
    expect(emailResult.html).not.toContain("—");
  });

  it("MS67-TC11: Four-Way Filter Pill & Refunded View Elements in PaymentQueue.tsx", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // 4 tab buttons
    expect(fileContent).toContain('data-testid="tab-awaiting-review"');
    expect(fileContent).toContain('data-testid="tab-overdue-reviews"');
    expect(fileContent).toContain('data-testid="tab-refunded-payments"');
    expect(fileContent).toContain('data-testid="tab-rejected-payments"');

    // 4 count badges
    expect(fileContent).toContain('data-testid="badge-awaiting-review-count"');
    expect(fileContent).toContain('data-testid="badge-overdue-count"');
    expect(fileContent).toContain('data-testid="badge-refunded-count"');
    expect(fileContent).toContain('data-testid="badge-rejected-count"');

    // Tab labels
    expect(fileContent).toContain("<span>Awaiting Review</span>");
    expect(fileContent).toContain("<span>Overdue (Refund Eligible)</span>");
    expect(fileContent).toContain("<span>Refunded</span>");
    expect(fileContent).toContain("<span>Rejected Payments</span>");

    // Refunded tab view elements
    expect(fileContent).toContain('data-testid="admin-payments-refunded-notice"');
    expect(fileContent).toContain('data-testid="refunded-section-count"');
    expect(fileContent).toContain('data-testid="refunded-payment-item"');
    expect(fileContent).toContain('data-testid="refunded-status-badge"');
    expect(fileContent).toContain('data-testid="inspect-refund-button"');
    expect(fileContent).toContain("REFUND DISBURSED");

    // Color tokens for refunded tab: emerald
    expect(fileContent).toContain("#047857");
    expect(fileContent).toContain("#ECFDF5");
    expect(fileContent).toContain("#A7F3D0");

    // BAN-PUNCT-01: Zero em-dashes in source code
    expect(fileContent).not.toContain("—");
  });

  it("MS67-TC12: Overdue and Refunded Payment Action Panel Exclusivity (No Approve or Reject Buttons)", () => {
    const reviewComponentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentReview.tsx"
    );
    const fileContent = fs.readFileSync(reviewComponentPath, "utf-8");

    // Verify mutually exclusive ternary structure where REFUNDED and isOverdue precede UNDER_REVIEW approve/reject
    expect(fileContent).toContain("detail.refundStatus === 'REFUNDED' ? (");
    expect(fileContent).toContain(") : isOverdue ? (");
    expect(fileContent).toContain(") : detail.paymentStatus === 'UNDER_REVIEW' ? (");

    // Verify testids
    expect(fileContent).toContain('data-testid="refund-completed-badge"');
    expect(fileContent).toContain('data-testid="overdue-triage-container"');
    expect(fileContent).toContain('data-testid="open-reject-modal-button"');
    expect(fileContent).toContain('data-testid="open-approve-modal-button"');
    expect(fileContent).toContain('data-testid="admin-payment-refunded-banner"');
    expect(fileContent).toContain('data-testid="admin-payment-overdue-banner"');

    // BAN-PUNCT-01: Zero em-dashes in source code
    expect(fileContent).not.toContain("—");
  });

  it("MS67-TC13: Payment Notification Pill Strictly Counts and Shows Only Awaiting Review and Overdue (Refund Eligible)", () => {
    // 1. Verify /api/admin/badge-counts/route.ts implementation
    const routePath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/app/api/admin/badge-counts/route.ts"
    );
    const routeContent = fs.readFileSync(routePath, "utf-8");

    expect(routeContent).toContain("evaluateAndSegregatePaymentReviews(rawQueue, now)");
    expect(routeContent).toContain("item.refundStatus !== \"REFUNDED\"");
    expect(routeContent).toContain("const paymentsCount = awaitingReviewCount + overdueCount;");
    expect(routeContent).toContain("awaitingReviewCount");
    expect(routeContent).toContain("overdueCount");

    // 2. Verify layout badge rendering and event sync
    const layoutPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/app/manage/layout.tsx"
    );
    const layoutContent = fs.readFileSync(layoutPath, "utf-8");

    expect(layoutContent).toContain("badge: paymentsCount > 0 ? paymentsCount : undefined");
    expect(layoutContent).toContain("data-testid={item.id === '/manage/payments' ? \"payments-badge-count\" : undefined}");
    expect(layoutContent).toContain("deskatlas:badge-refresh");

    // 3. Functional segregation assertion
    const awaitingItem = createMockItem({
      paymentAttemptId: "pay-active-1",
      startTime: "2026-10-18T12:00:00.000Z",
      paymentStatus: "UNDER_REVIEW",
      refundStatus: "NONE",
    });
    const overdueItem = createMockItem({
      paymentAttemptId: "pay-overdue-1",
      startTime: "2026-10-18T07:00:00.000Z",
      paymentStatus: "UNDER_REVIEW",
      refundStatus: "NONE",
    });
    const refundedItem = createMockItem({
      paymentAttemptId: "pay-refunded-1",
      startTime: "2026-10-18T06:00:00.000Z",
      paymentStatus: "UNDER_REVIEW",
      refundStatus: "REFUNDED",
    });
    const rejectedItem = createMockItem({
      paymentAttemptId: "pay-rejected-1",
      startTime: "2026-10-18T11:00:00.000Z",
      paymentStatus: "REJECTED",
      refundStatus: "NONE",
    });

    const segregated = evaluateAndSegregatePaymentReviews(
      [awaitingItem, overdueItem, refundedItem, rejectedItem],
      fixedNow
    );

    const awaitingCount = segregated.activeQueue.filter(
      (item) => (item.paymentStatus === "UNDER_REVIEW" || !item.paymentStatus) && item.refundStatus !== "REFUNDED"
    ).length;
    const overdueCount = segregated.overdueQueue.filter(
      (item) => (item.paymentStatus === "UNDER_REVIEW" || !item.paymentStatus) && item.refundStatus !== "REFUNDED"
    ).length;
    const totalPaymentsCount = awaitingCount + overdueCount;

    // Must strictly equal 2 (1 awaiting + 1 overdue; refunded and rejected excluded)
    expect(awaitingCount).toBe(1);
    expect(overdueCount).toBe(1);
    expect(totalPaymentsCount).toBe(2);

    // BAN-PUNCT-01: Zero em-dashes
    expect(routeContent).not.toContain("—");
    expect(layoutContent).not.toContain("—");
  });
});
