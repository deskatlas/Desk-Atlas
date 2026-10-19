// MS-70: Admin Online Payments Queue Multi-Section Sorting Filter Harmonization for Overdue and Refunded Payments
// Traceability: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC51, MS70-TC01..08

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assignCanonicalQueueRanks,
  sortPaymentReviewQueue,
  type PaymentQueueSortMode,
  type PaymentReviewQueueItem,
  type RankedPaymentReviewQueueItem,
} from "@deskatlas/domain";

function createMockItem(overrides: Partial<PaymentReviewQueueItem>): PaymentReviewQueueItem {
  return {
    paymentAttemptId: overrides.paymentAttemptId || "pay-default",
    reservationId: overrides.reservationId || "res-default",
    reservationReferenceCode: overrides.reservationReferenceCode || "REF-DEF",
    reservationStatus: "AWAITING_PAYMENT_PROOF",
    paymentStatus: overrides.paymentStatus || "PENDING_REVIEW",
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
  // Items per MS-70 specification:
  // Item A: submitted 08:00:00, amount ₱250 -> Canonical Rank #1
  // Item B: submitted 08:15:00, amount ₱1,500 -> Canonical Rank #2
  // Item C: submitted 08:30:00, amount ₱800 -> Canonical Rank #3
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

  // Assign canonical ranks from arbitrary ingestion order (C, A, B)
  const rankedRefundedBatch: RankedPaymentReviewQueueItem[] = assignCanonicalQueueRanks([
    rawRefundedC,
    rawRefundedA,
    rawRefundedB,
  ]);

  it("MS70-TC01: Refunded Tab Ranking Descending Sorting renders items in FIFO order with ranks #1, #2, #3", () => {
    expect(rankedRefundedBatch).toHaveLength(3);
    expect(rankedRefundedBatch[0].paymentAttemptId).toBe("pay-refunded-a");
    expect(rankedRefundedBatch[0].queueRank).toBe(1);
    expect(rankedRefundedBatch[1].paymentAttemptId).toBe("pay-refunded-b");
    expect(rankedRefundedBatch[1].queueRank).toBe(2);
    expect(rankedRefundedBatch[2].paymentAttemptId).toBe("pay-refunded-c");
    expect(rankedRefundedBatch[2].queueRank).toBe(3);

    const sortedRankDesc = sortPaymentReviewQueue(rankedRefundedBatch, "RANK_DESC");
    expect(sortedRankDesc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-a",
      "pay-refunded-b",
      "pay-refunded-c",
    ]);
    expect(sortedRankDesc.map((item) => item.queueRank)).toEqual([1, 2, 3]);
  });

  it("MS70-TC02: Refunded Tab Ranking Ascending Sorting displays reverse order #3, #2, #1 while retaining rank badges", () => {
    const sortedRankAsc = sortPaymentReviewQueue(rankedRefundedBatch, "RANK_ASC");
    expect(sortedRankAsc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-c",
      "pay-refunded-b",
      "pay-refunded-a",
    ]);
    expect(sortedRankAsc.map((item) => item.queueRank)).toEqual([3, 2, 1]);
  });

  it("MS70-TC03: Refunded Tab Amount Descending Sorting orders by highest monetary amount due", () => {
    // Expected order: Item B (₱1,500, #2), Item C (₱800, #3), Item A (₱250, #1)
    const sortedAmountDesc = sortPaymentReviewQueue(rankedRefundedBatch, "AMOUNT_DESC");
    expect(sortedAmountDesc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-b",
      "pay-refunded-c",
      "pay-refunded-a",
    ]);
    expect(sortedAmountDesc.map((item) => item.amountDue)).toEqual([1500, 800, 250]);
    expect(sortedAmountDesc.map((item) => item.queueRank)).toEqual([2, 3, 1]);
  });

  it("MS70-TC04: Refunded Tab Amount Ascending Sorting orders by lowest monetary amount due", () => {
    // Expected order: Item A (₱250, #1), Item C (₱800, #3), Item B (₱1,500, #2)
    const sortedAmountAsc = sortPaymentReviewQueue(rankedRefundedBatch, "AMOUNT_ASC");
    expect(sortedAmountAsc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-refunded-a",
      "pay-refunded-c",
      "pay-refunded-b",
    ]);
    expect(sortedAmountAsc.map((item) => item.amountDue)).toEqual([250, 800, 1500]);
    expect(sortedAmountAsc.map((item) => item.queueRank)).toEqual([1, 3, 2]);
  });

  it("MS70-TC05: Refunded Item Immutable Rank Badge Preservation verifies badge persistence across all sort modes", () => {
    const modes: PaymentQueueSortMode[] = ["RANK_DESC", "RANK_ASC", "AMOUNT_DESC", "AMOUNT_ASC"];

    for (const mode of modes) {
      const sorted = sortPaymentReviewQueue(rankedRefundedBatch, mode);
      // For each item in the sorted result, its queueRank property must match its canonical rank
      for (const item of sorted) {
        if (item.paymentAttemptId === "pay-refunded-a") {
          expect(item.queueRank).toBe(1);
        } else if (item.paymentAttemptId === "pay-refunded-b") {
          expect(item.queueRank).toBe(2);
        } else if (item.paymentAttemptId === "pay-refunded-c") {
          expect(item.queueRank).toBe(3);
        }
      }
    }

    // Component source check: verifies rank badge is rendered with data-testid="refunded-payment-queue-number"
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    expect(fileContent).toContain('data-testid="refunded-payment-queue-number"');
    expect(fileContent).toContain("#{p.queueRank}");
  });

  it("MS70-TC06: Overdue Tab Four-Mode Sorting Parity mirrors sorting logic with deterministic tie-breaking", () => {
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

    const rankedOverdue = assignCanonicalQueueRanks([overdueB, overdueC, overdueA]);
    expect(rankedOverdue.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-a",
      "pay-overdue-b",
      "pay-overdue-c",
    ]);

    // Test RANK_DESC
    const odRankDesc = sortPaymentReviewQueue(rankedOverdue, "RANK_DESC");
    expect(odRankDesc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-a",
      "pay-overdue-b",
      "pay-overdue-c",
    ]);

    // Test RANK_ASC
    const odRankAsc = sortPaymentReviewQueue(rankedOverdue, "RANK_ASC");
    expect(odRankAsc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-c",
      "pay-overdue-b",
      "pay-overdue-a",
    ]);

    // Test AMOUNT_DESC
    const odAmtDesc = sortPaymentReviewQueue(rankedOverdue, "AMOUNT_DESC");
    expect(odAmtDesc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-b",
      "pay-overdue-c",
      "pay-overdue-a",
    ]);

    // Test AMOUNT_ASC
    const odAmtAsc = sortPaymentReviewQueue(rankedOverdue, "AMOUNT_ASC");
    expect(odAmtAsc.map((i) => i.paymentAttemptId)).toEqual([
      "pay-overdue-a",
      "pay-overdue-c",
      "pay-overdue-b",
    ]);
  });

  it("MS70-TC07: Amount Sorting Deterministic Tie-Breaking prioritizes earlier canonical rank", () => {
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

    const rankedTie = assignCanonicalQueueRanks([tie2, tie1]);
    expect(rankedTie[0].paymentAttemptId).toBe("pay-tie-1");
    expect(rankedTie[0].queueRank).toBe(1);
    expect(rankedTie[1].paymentAttemptId).toBe("pay-tie-2");
    expect(rankedTie[1].queueRank).toBe(2);

    // Both AMOUNT_DESC and AMOUNT_ASC must resolve identical amounts by queueRank asc
    const tieDesc = sortPaymentReviewQueue(rankedTie, "AMOUNT_DESC");
    expect(tieDesc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-1", "pay-tie-2"]);

    const tieAsc = sortPaymentReviewQueue(rankedTie, "AMOUNT_ASC");
    expect(tieAsc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-1", "pay-tie-2"]);
  });

  it("MS70-TC08: Accessibility & Design Token Conformance verifies testids, labels, and design tokens", () => {
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

    // Refunded item canonical rank badge
    expect(fileContent).toContain('data-testid="refunded-payment-queue-number"');

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
