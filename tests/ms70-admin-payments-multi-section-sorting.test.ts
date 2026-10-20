// MS-70: Admin Online Payments Queue Multi-Section Sorting Harmonization for Overdue and Refunded Payments
// Traceability: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC51, MS70-TC01..09

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assignCanonicalQueueRanks,
  evaluateAndSegregatePaymentReviews,
  sortRecentPaymentsQueue,
  type RecentQueueSortMode,
  type PaymentReviewQueueItem,
} from "@deskatlas/domain";

function createMockItem(overrides: Partial<PaymentReviewQueueItem>): PaymentReviewQueueItem {
  return {
    paymentAttemptId: overrides.paymentAttemptId || "pay-default",
    reservationId: overrides.reservationId || "res-default",
    reservationReferenceCode: overrides.reservationReferenceCode || "REF-DEF",
    reservationStatus: "AWAITING_PAYMENT_PROOF",
    paymentStatus: overrides.paymentStatus || "UNDER_REVIEW",
    customerFirstName: overrides.customerFirstName || "Test",
    customerLastName: overrides.customerLastName || "Customer",
    customerEmail: overrides.customerEmail || "customer@example.com",
    amountDue: overrides.amountDue !== undefined ? overrides.amountDue : 500,
    currency: "PHP",
    paymentMethodId: "pm-online",
    proofSubmittedAt: overrides.proofSubmittedAt !== undefined ? overrides.proofSubmittedAt : "2026-10-18T08:00:00.000Z",
    submittedCandidates: [],
    refundStatus: overrides.refundStatus || "NONE",
    refundedAt: overrides.refundedAt ?? null,
    refundNotes: overrides.refundNotes ?? null,
    ...overrides,
  };
}

describe("MS-70: Admin Online Payments Queue Multi-Section Sorting Filter Harmonization (QAD-TC51)", () => {
  // Items per specification:
  // Item A: submitted 08:00:00, refunded 10:00:00, amount ₱250
  // Item B: submitted 08:15:00, refunded 10:05:00, amount ₱1,500
  // Item C: submitted 08:30:00, refunded 10:10:00, amount ₱800
  const rawRefundedA = createMockItem({
    paymentAttemptId: "pay-refunded-a",
    reservationReferenceCode: "RES-REF-A",
    customerFirstName: "Alice",
    customerLastName: "Alvarez",
    amountDue: 250,
    proofSubmittedAt: "2026-10-18T08:00:00.000Z",
    refundStatus: "REFUNDED",
    refundedAt: "2026-10-18T10:00:00.000Z",
  });

  const rawRefundedB = createMockItem({
    paymentAttemptId: "pay-refunded-b",
    reservationReferenceCode: "RES-REF-B",
    customerFirstName: "Bob",
    customerLastName: "Builder",
    amountDue: 1500,
    proofSubmittedAt: "2026-10-18T08:15:00.000Z",
    refundStatus: "REFUNDED",
    refundedAt: "2026-10-18T10:05:00.000Z",
  });

  const rawRefundedC = createMockItem({
    paymentAttemptId: "pay-refunded-c",
    reservationReferenceCode: "RES-REF-C",
    customerFirstName: "Charlie",
    customerLastName: "Clark",
    amountDue: 800,
    proofSubmittedAt: "2026-10-18T08:30:00.000Z",
    refundStatus: "REFUNDED",
    refundedAt: "2026-10-18T10:10:00.000Z",
  });

  const refundedBatch = [rawRefundedC, rawRefundedA, rawRefundedB];

  it("MS70-TC01: Refunded Tab Most Recent Descending Sorting renders items newest to oldest", () => {
    const sortedRecentDesc = sortRecentPaymentsQueue(refundedBatch, "RECENT_DESC", (p) => {
      const raw = p.refundedAt || p.proofSubmittedAt;
      return raw ? new Date(raw).getTime() : 0;
    });

    // C (10:10:00) -> B (10:05:00) -> A (10:00:00)
    expect(sortedRecentDesc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-c",
      "pay-refunded-b",
      "pay-refunded-a",
    ]);
  });

  it("MS70-TC02: Refunded Tab Most Recent Ascending Sorting displays oldest to newest", () => {
    const sortedRecentAsc = sortRecentPaymentsQueue(refundedBatch, "RECENT_ASC", (p) => {
      const raw = p.refundedAt || p.proofSubmittedAt;
      return raw ? new Date(raw).getTime() : 0;
    });

    // A (10:00:00) -> B (10:05:00) -> C (10:10:00)
    expect(sortedRecentAsc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-a",
      "pay-refunded-b",
      "pay-refunded-c",
    ]);
  });

  it("MS70-TC03: Refunded Tab Amount Descending Sorting orders by highest monetary amount due", () => {
    // Expected order: Item B (₱1,500), Item C (₱800), Item A (₱250)
    const sortedAmountDesc = sortRecentPaymentsQueue(refundedBatch, "AMOUNT_DESC");
    expect(sortedAmountDesc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-b",
      "pay-refunded-c",
      "pay-refunded-a",
    ]);
    expect(sortedAmountDesc.map((item) => item.amountDue)).toEqual([1500, 800, 250]);
  });

  it("MS70-TC04: Refunded Tab Amount Ascending Sorting orders by lowest monetary amount due", () => {
    // Expected order: Item A (₱250), Item C (₱800), Item B (₱1,500)
    const sortedAmountAsc = sortRecentPaymentsQueue(refundedBatch, "AMOUNT_ASC");
    expect(sortedAmountAsc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-a",
      "pay-refunded-c",
      "pay-refunded-b",
    ]);
    expect(sortedAmountAsc.map((item) => item.amountDue)).toEqual([250, 800, 1500]);
  });

  it("MS70-TC05: Status Badges Rendering replaces order numbers in overdue and refunded tabs", () => {
    // Component source check: verifies status badges replace rank numbers
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Must have overdue badge and refunded badge test ids
    expect(fileContent).toContain('data-testid="overdue-payment-badge"');
    expect(fileContent).toContain('data-testid="refunded-payment-badge"');

    // Must NOT have rank numbers in overdue or refunded queue item rendering
    expect(fileContent).not.toContain("#{p.queueRank}");
  });

  it("MS70-TC06: Overdue Tab Four-Mode Recent and Amount Sorting Parity with deterministic tie-breaking", () => {
    const overdueA = createMockItem({
      paymentAttemptId: "pay-overdue-a",
      amountDue: 350,
      proofSubmittedAt: "2026-10-18T05:00:00.000Z",
    });
    const overdueB = createMockItem({
      paymentAttemptId: "pay-overdue-b",
      amountDue: 1200,
      proofSubmittedAt: "2026-10-18T05:15:00.000Z",
    });
    const overdueC = createMockItem({
      paymentAttemptId: "pay-overdue-c",
      amountDue: 600,
      proofSubmittedAt: "2026-10-18T05:30:00.000Z",
    });

    const overdueList = [overdueB, overdueC, overdueA];

    // Test RECENT_DESC (newest first: C 05:30 -> B 05:15 -> A 05:00)
    const odRecentDesc = sortRecentPaymentsQueue(overdueList, "RECENT_DESC", (p) =>
      p.proofSubmittedAt ? new Date(p.proofSubmittedAt).getTime() : 0
    );
    expect(odRecentDesc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-c",
      "pay-overdue-b",
      "pay-overdue-a",
    ]);

    // Test RECENT_ASC (oldest first: A 05:00 -> B 05:15 -> C 05:30)
    const odRecentAsc = sortRecentPaymentsQueue(overdueList, "RECENT_ASC", (p) =>
      p.proofSubmittedAt ? new Date(p.proofSubmittedAt).getTime() : 0
    );
    expect(odRecentAsc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-a",
      "pay-overdue-b",
      "pay-overdue-c",
    ]);

    // Test AMOUNT_DESC
    const odAmtDesc = sortRecentPaymentsQueue(overdueList, "AMOUNT_DESC");
    expect(odAmtDesc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-b",
      "pay-overdue-c",
      "pay-overdue-a",
    ]);

    // Test AMOUNT_ASC
    const odAmtAsc = sortRecentPaymentsQueue(overdueList, "AMOUNT_ASC");
    expect(odAmtAsc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-a",
      "pay-overdue-c",
      "pay-overdue-b",
    ]);
  });

  it("MS70-TC07: Amount Sorting Deterministic Tie-Breaking prioritizes most recent item", () => {
    const tie1 = createMockItem({
      paymentAttemptId: "pay-tie-1",
      amountDue: 500,
      proofSubmittedAt: "2026-10-18T08:00:00.000Z",
    });
    const tie2 = createMockItem({
      paymentAttemptId: "pay-tie-2",
      amountDue: 500,
      proofSubmittedAt: "2026-10-18T08:10:00.000Z",
    });

    // In AMOUNT_DESC and AMOUNT_ASC, tie2 (more recent) must precede tie1
    const tieDesc = sortRecentPaymentsQueue([tie1, tie2], "AMOUNT_DESC");
    expect(tieDesc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-2", "pay-tie-1"]);

    const tieAsc = sortRecentPaymentsQueue([tie1, tie2], "AMOUNT_ASC");
    expect(tieAsc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-2", "pay-tie-1"]);
  });

  it("MS70-TC08: Single awaiting review record receives rank #1 even when overdue records exist", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");

    const overdue1 = createMockItem({
      paymentAttemptId: "pay-od-1",
      submittedCandidates: [{ rank: 0, startAt: "2026-10-18T08:00:00.000Z", endAt: "2026-10-18T10:00:00.000Z", workspaceInstanceId: "inst-1", isAssigned: false }],
      proofSubmittedAt: "2026-10-18T07:00:00.000Z",
    });
    const overdue2 = createMockItem({
      paymentAttemptId: "pay-od-2",
      submittedCandidates: [{ rank: 0, startAt: "2026-10-18T09:00:00.000Z", endAt: "2026-10-18T11:00:00.000Z", workspaceInstanceId: "inst-2", isAssigned: false }],
      proofSubmittedAt: "2026-10-18T07:30:00.000Z",
    });
    const overdue3 = createMockItem({
      paymentAttemptId: "pay-od-3",
      submittedCandidates: [{ rank: 0, startAt: "2026-10-18T09:30:00.000Z", endAt: "2026-10-18T11:30:00.000Z", workspaceInstanceId: "inst-3", isAssigned: false }],
      proofSubmittedAt: "2026-10-18T08:00:00.000Z",
    });
    const overdue4 = createMockItem({
      paymentAttemptId: "pay-od-4",
      submittedCandidates: [{ rank: 0, startAt: "2026-10-18T10:00:00.000Z", endAt: "2026-10-18T11:45:00.000Z", workspaceInstanceId: "inst-4", isAssigned: false }],
      proofSubmittedAt: "2026-10-18T08:30:00.000Z",
    });
    const active1 = createMockItem({
      paymentAttemptId: "pay-active-1",
      submittedCandidates: [{ rank: 0, startAt: "2026-10-18T14:00:00.000Z", endAt: "2026-10-18T16:00:00.000Z", workspaceInstanceId: "inst-5", isAssigned: false }],
      proofSubmittedAt: "2026-10-18T09:00:00.000Z",
    });

    const rawAll = [overdue1, overdue2, overdue3, overdue4, active1];
    const segregated = evaluateAndSegregatePaymentReviews(rawAll, now);

    expect(segregated.overdueQueue).toHaveLength(4);
    expect(segregated.activeQueue).toHaveLength(1);

    // Ranking activeQueue strictly inside awaiting review tab produces #1 (NOT #5)
    const rankedActive = assignCanonicalQueueRanks(segregated.activeQueue);
    expect(rankedActive).toHaveLength(1);
    expect(rankedActive[0].paymentAttemptId).toBe("pay-active-1");
    expect(rankedActive[0].queueRank).toBe(1);
  });

  it("MS70-TC09: Accessibility & Design Token Conformance verifies testids, labels, and design tokens", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Overdue sort select control accessibility
    expect(fileContent).toContain('htmlFor="admin-payments-overdue-sort-select"');
    expect(fileContent).toContain('id="admin-payments-overdue-sort-select"');
    expect(fileContent).toContain('data-testid="admin-payments-overdue-sort-select"');

    // Refunded sort select control accessibility
    expect(fileContent).toContain('htmlFor="admin-payments-refunded-sort-select"');
    expect(fileContent).toContain('id="admin-payments-refunded-sort-select"');
    expect(fileContent).toContain('data-testid="admin-payments-refunded-sort-select"');

    // Informational notice banners for both tabs
    expect(fileContent).toContain('data-testid="admin-payments-overdue-sort-notice"');
    expect(fileContent).toContain('data-testid="admin-payments-refunded-sort-notice"');

    // Select options for Most Recent and Amount
    expect(fileContent).toContain('<option value="RECENT_DESC">Most Recent: Descending</option>');
    expect(fileContent).toContain('<option value="RECENT_ASC">Most Recent: Ascending</option>');

    // Memoized sort arrays for both sections
    expect(fileContent).toContain("const displayedOverdueQueue = useMemo(() => {");
    expect(fileContent).toContain("const displayedRefundedQueue = useMemo(() => {");

    // Adherence to design tokens
    expect(fileContent).toContain("var(--da-brand-dark)");
    expect(fileContent).toContain("var(--da-border");
    expect(fileContent).toContain("var(--da-font-family)");
    expect(fileContent).toContain("#047857");
    expect(fileContent).toContain("#ECFDF5");
    expect(fileContent).toContain("#A7F3D0");
    expect(fileContent).toContain("#FEF3C7");
    expect(fileContent).toContain("#B45309");

    // BAN-PUNCT-01: Zero em-dashes in source code
    expect(fileContent).not.toContain("—");
  });
});
