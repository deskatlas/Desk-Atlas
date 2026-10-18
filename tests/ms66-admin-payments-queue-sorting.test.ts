// MS-66: Admin Online Payments Queue Multi-Criterion Sorting and Immutable Rank Preservation
// Traceability: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC47, MS66-TC01..06

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
    paymentStatus: "PENDING_REVIEW",
    customerFirstName: "Test",
    customerLastName: "Customer",
    customerEmail: "customer@example.com",
    amountDue: overrides.amountDue !== undefined ? overrides.amountDue : 500,
    currency: "PHP",
    paymentMethodId: "pm-online",
    proofSubmittedAt: overrides.proofSubmittedAt !== undefined ? overrides.proofSubmittedAt : "2026-10-18T08:00:00.000Z",
    submittedCandidates: [],
    ...overrides,
  };
}

describe("MS-66: Admin Online Payments Queue Multi-Criterion Sorting and Immutable Rank Preservation (QAD-TC47)", () => {
  // Test items according to MS66 specification:
  // Item A: submitted 08:00:00, amount ₱250 -> Canonical Rank #1
  // Item B: submitted 08:15:00, amount ₱1,500 -> Canonical Rank #2
  // Item C: submitted 08:30:00, amount ₱800 -> Canonical Rank #3
  const rawItemA = createMockItem({
    paymentAttemptId: "pay-item-a",
    reservationReferenceCode: "RES-ITEM-A",
    customerFirstName: "Alice",
    customerLastName: "Alvarez",
    amountDue: 250,
    proofSubmittedAt: "2026-10-18T08:00:00.000Z",
  });

  const rawItemB = createMockItem({
    paymentAttemptId: "pay-item-b",
    reservationReferenceCode: "RES-ITEM-B",
    customerFirstName: "Bob",
    customerLastName: "Builder",
    amountDue: 1500,
    proofSubmittedAt: "2026-10-18T08:15:00.000Z",
  });

  const rawItemC = createMockItem({
    paymentAttemptId: "pay-item-c",
    reservationReferenceCode: "RES-ITEM-C",
    customerFirstName: "Charlie",
    customerLastName: "Clark",
    amountDue: 800,
    proofSubmittedAt: "2026-10-18T08:30:00.000Z",
  });

  const canonicalBatch: RankedPaymentReviewQueueItem[] = assignCanonicalQueueRanks([
    rawItemC,
    rawItemA,
    rawItemB,
  ]);

  it("MS66-TC01: Default Sort Initialization renders items in FIFO order with ranks #1, #2, #3", () => {
    // Canonical rank assignment guarantees strict FIFO ordering regardless of array input order
    expect(canonicalBatch).toHaveLength(3);
    expect(canonicalBatch[0].paymentAttemptId).toBe("pay-item-a");
    expect(canonicalBatch[0].queueRank).toBe(1);
    expect(canonicalBatch[1].paymentAttemptId).toBe("pay-item-b");
    expect(canonicalBatch[1].queueRank).toBe(2);
    expect(canonicalBatch[2].paymentAttemptId).toBe("pay-item-c");
    expect(canonicalBatch[2].queueRank).toBe(3);

    // Default sorting mode is RANK_DESC
    const defaultSorted = sortPaymentReviewQueue(canonicalBatch, "RANK_DESC");
    expect(defaultSorted.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-a",
      "pay-item-b",
      "pay-item-c",
    ]);
    expect(defaultSorted.map((item) => item.queueRank)).toEqual([1, 2, 3]);
  });

  it("MS66-TC02: Ranking Ascending Reversal displays reverse order while preserving exact original rank badges", () => {
    // When sorted by RANK_ASC, order reverses to #3, #2, #1
    const reversed = sortPaymentReviewQueue(canonicalBatch, "RANK_ASC");
    expect(reversed.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-c",
      "pay-item-b",
      "pay-item-a",
    ]);

    // Items retain their immutable original canonical rank badges
    expect(reversed[0].queueRank).toBe(3);
    expect(reversed[1].queueRank).toBe(2);
    expect(reversed[2].queueRank).toBe(1);
  });

  it("MS66-TC03: Amount Descending Sorting orders by highest monetary amount due while preserving immutable rank badges", () => {
    // Item A: ₱250 (Rank 1), Item B: ₱1,500 (Rank 2), Item C: ₱800 (Rank 3)
    // Order becomes: Item B (₱1,500, badge #2), Item C (₱800, badge #3), Item A (₱250, badge #1)
    const amountDesc = sortPaymentReviewQueue(canonicalBatch, "AMOUNT_DESC");
    expect(amountDesc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-b",
      "pay-item-c",
      "pay-item-a",
    ]);
    expect(amountDesc.map((item) => item.amountDue)).toEqual([1500, 800, 250]);
    expect(amountDesc.map((item) => item.queueRank)).toEqual([2, 3, 1]);
  });

  it("MS66-TC04: Amount Ascending Sorting orders by lowest monetary amount due while preserving immutable rank badges", () => {
    // Order becomes: Item A (₱250, badge #1), Item C (₱800, badge #3), Item B (₱1,500, badge #2)
    const amountAsc = sortPaymentReviewQueue(canonicalBatch, "AMOUNT_ASC");
    expect(amountAsc.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-a",
      "pay-item-c",
      "pay-item-b",
    ]);
    expect(amountAsc.map((item) => item.amountDue)).toEqual([250, 800, 1500]);
    expect(amountAsc.map((item) => item.queueRank)).toEqual([1, 3, 2]);
  });

  it("MS66-TC05: Deterministic Amount Tie-Breaking prioritizes earlier arrival for equal amounts due", () => {
    // Two items with identical amounts due (₱500)
    // Item X submitted earlier than Item Y
    const itemX = createMockItem({
      paymentAttemptId: "pay-x",
      amountDue: 500,
      proofSubmittedAt: "2026-10-18T09:00:00.000Z",
    });
    const itemY = createMockItem({
      paymentAttemptId: "pay-y",
      amountDue: 500,
      proofSubmittedAt: "2026-10-18T09:30:00.000Z",
    });

    const rankedTieBatch = assignCanonicalQueueRanks([itemY, itemX]);
    expect(rankedTieBatch[0].paymentAttemptId).toBe("pay-x");
    expect(rankedTieBatch[0].queueRank).toBe(1);
    expect(rankedTieBatch[1].paymentAttemptId).toBe("pay-y");
    expect(rankedTieBatch[1].queueRank).toBe(2);

    // In both AMOUNT_DESC and AMOUNT_ASC, Item X (Rank #1) must precede Item Y (Rank #2)
    const tieDesc = sortPaymentReviewQueue(rankedTieBatch, "AMOUNT_DESC");
    expect(tieDesc[0].paymentAttemptId).toBe("pay-x");
    expect(tieDesc[1].paymentAttemptId).toBe("pay-y");

    const tieAsc = sortPaymentReviewQueue(rankedTieBatch, "AMOUNT_ASC");
    expect(tieAsc[0].paymentAttemptId).toBe("pay-x");
    expect(tieAsc[1].paymentAttemptId).toBe("pay-y");

    // Identical amounts and timestamps break ties deterministically on paymentAttemptId
    const itemZ1 = createMockItem({
      paymentAttemptId: "pay-001",
      amountDue: 750,
      proofSubmittedAt: "2026-10-18T10:00:00.000Z",
    });
    const itemZ2 = createMockItem({
      paymentAttemptId: "pay-002",
      amountDue: 750,
      proofSubmittedAt: "2026-10-18T10:00:00.000Z",
    });
    const tieSameTimestamp = assignCanonicalQueueRanks([itemZ2, itemZ1]);
    expect(tieSameTimestamp[0].paymentAttemptId).toBe("pay-001");
    expect(tieSameTimestamp[1].paymentAttemptId).toBe("pay-002");
  });

  it("MS66-TC06: Accessibility, Form Control Integrity, and Dynamic Notice Webcopy", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Verify sortMode state with default RANK_DESC
    expect(fileContent).toContain("const [sortMode, setSortMode] = useState<PaymentQueueSortMode>('RANK_DESC');");

    // Verify accessible select control attributes
    expect(fileContent).toContain('htmlFor="admin-payments-sort-select"');
    expect(fileContent).toContain('id="admin-payments-sort-select"');
    expect(fileContent).toContain('data-testid="admin-payments-sort-select"');

    // Verify all 4 required sorting options and their human-readable labels
    expect(fileContent).toContain('<option value="RANK_DESC">Ranking: Descending</option>');
    expect(fileContent).toContain('<option value="RANK_ASC">Ranking: Ascending</option>');
    expect(fileContent).toContain('<option value="AMOUNT_DESC">Amount: Descending</option>');
    expect(fileContent).toContain('<option value="AMOUNT_ASC">Amount: Ascending</option>');

    // Verify immutable rank badge binding (queueNumber = p.queueRank)
    expect(fileContent).toContain("const queueNumber = p.queueRank;");
    expect(fileContent).toContain("#{queueNumber}");
    expect(fileContent).toContain('data-testid="payment-queue-number"');

    // Verify notice banner contains both default and active sorting copy
    expect(fileContent).toContain(
      "Payments are sorted by proof upload time (earliest first). The rank badge indicates original queue arrival order."
    );
    expect(fileContent).toContain(
      "Active sorting applied. The rank badge (#) permanently identifies each customer's original submission order."
    );

    // Verify design tokens adhere to DeskAtlas standards without ad-hoc styling
    expect(fileContent).toContain("var(--da-brand-dark)");
    expect(fileContent).toContain("var(--da-border");
    expect(fileContent).toContain("var(--da-font-family)");
  });
});
