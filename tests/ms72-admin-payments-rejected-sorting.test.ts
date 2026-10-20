// MS-72: Admin Online Payments Queue Rejected Payments Multi-Criterion Sorting and Chronological Triage
// Traceability: PRD-F6, SDD-C5, DSD-UI11, ERD-E10, ERD-E13, QAD-TC53, MS72-TC01..07

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  sortRejectedPaymentsQueue,
  type RejectedQueueSortMode,
  type PaymentReviewDetail,
} from "@deskatlas/domain";

function createMockRejectedItem(overrides: Partial<PaymentReviewDetail>): PaymentReviewDetail {
  return {
    paymentAttemptId: overrides.paymentAttemptId || "pay-default",
    reservationId: overrides.reservationId || "res-default",
    reservationReferenceCode: overrides.reservationReferenceCode || "REF-DEF",
    reservationStatus: "REJECTED",
    paymentStatus: overrides.paymentStatus || "REJECTED",
    customerFirstName: overrides.customerFirstName || "Test",
    customerLastName: overrides.customerLastName || "Customer",
    customerEmail: overrides.customerEmail || "customer@example.com",
    amountDue: overrides.amountDue !== undefined ? overrides.amountDue : 500,
    currency: "PHP",
    paymentMethodId: "pm-online",
    proofSubmittedAt: overrides.proofSubmittedAt !== undefined ? overrides.proofSubmittedAt : "2026-10-18T08:00:00.000Z",
    submittedCandidates: [],
    proofStoragePath: "proofs/mock.png",
    rejectionReason: overrides.rejectionReason || "Proof unreadable",
    refundStatus: "NONE",
    refundNotes: null,
    refundedAt: null,
    processedAt: overrides.processedAt !== undefined ? overrides.processedAt : "2026-10-18T09:00:00.000Z",
    processedByUserId: "user-admin-1",
    createdAt: overrides.createdAt || "2026-10-18T07:50:00.000Z",
    ...overrides,
  };
}

describe("MS-72: Admin Online Payments Queue Rejected Payments Sorting (QAD-TC53)", () => {
  // Test Items for Chronological and Monetary Evaluation:
  // Item A: rejected 5 days ago (2026-10-16T12:00:00.000Z), amount ₱300
  // Item B: rejected 1 hour ago (2026-10-21T11:00:00.000Z), amount ₱2,500
  // Item C: rejected 2 days ago (2026-10-19T12:00:00.000Z), amount ₱750

  const itemA = createMockRejectedItem({
    paymentAttemptId: "pay-item-a",
    reservationReferenceCode: "RES-REJ-A",
    customerFirstName: "Alice",
    customerLastName: "Alvarez",
    amountDue: 300,
    processedAt: "2026-10-16T12:00:00.000Z",
    rejectionReason: "Illegible receipt image",
  });

  const itemB = createMockRejectedItem({
    paymentAttemptId: "pay-item-b",
    reservationReferenceCode: "RES-REJ-B",
    customerFirstName: "Bob",
    customerLastName: "Builder",
    amountDue: 2500,
    processedAt: "2026-10-21T11:00:00.000Z",
    rejectionReason: "Invalid account number",
  });

  const itemC = createMockRejectedItem({
    paymentAttemptId: "pay-item-c",
    reservationReferenceCode: "RES-REJ-C",
    customerFirstName: "Charlie",
    customerLastName: "Clark",
    amountDue: 750,
    processedAt: "2026-10-19T12:00:00.000Z",
    rejectionReason: "Mismatched amount paid",
  });

  it("MS72-TC01: Rejected Queue Most Recent Sorting (REJECTED_DESC) renders newest to oldest", () => {
    // Arbitrary input ingestion order: [itemA, itemC, itemB]
    const sorted = sortRejectedPaymentsQueue([itemA, itemC, itemB], "REJECTED_DESC");

    expect(sorted.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-b", // 1 hour ago
      "pay-item-c", // 2 days ago
      "pay-item-a", // 5 days ago
    ]);
  });

  it("MS72-TC02: Rejected Queue Oldest First Sorting (REJECTED_ASC) renders oldest to newest", () => {
    // Arbitrary input ingestion order: [itemB, itemA, itemC]
    const sorted = sortRejectedPaymentsQueue([itemB, itemA, itemC], "REJECTED_ASC");

    expect(sorted.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-a", // 5 days ago (earliest processedAt)
      "pay-item-c", // 2 days ago
      "pay-item-b", // 1 hour ago (latest processedAt)
    ]);
  });

  it("MS72-TC03: Rejected Queue Amount Descending (AMOUNT_DESC) renders highest to lowest amount", () => {
    // Input order: [itemA (₱300), itemB (₱2500), itemC (₱750)]
    const sorted = sortRejectedPaymentsQueue([itemA, itemB, itemC], "AMOUNT_DESC");

    expect(sorted.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-b", // ₱2,500
      "pay-item-c", // ₱750
      "pay-item-a", // ₱300
    ]);
    expect(sorted.map((item) => Number(item.amountDue))).toEqual([2500, 750, 300]);
  });

  it("MS72-TC04: Rejected Queue Amount Ascending (AMOUNT_ASC) renders lowest to highest amount", () => {
    // Input order: [itemB (₱2500), itemA (₱300), itemC (₱750)]
    const sorted = sortRejectedPaymentsQueue([itemB, itemA, itemC], "AMOUNT_ASC");

    expect(sorted.map((item) => item.paymentAttemptId)).toEqual([
      "pay-item-a", // ₱300
      "pay-item-c", // ₱750
      "pay-item-b", // ₱2,500
    ]);
    expect(sorted.map((item) => Number(item.amountDue))).toEqual([300, 750, 2500]);
  });

  it("MS72-TC05: Deterministic Amount Tie-Breaking prioritizes most recently rejected item", () => {
    // Two items with identical amount (₱500)
    // tie1: rejected 3 hours ago (2026-10-21T09:00:00.000Z)
    // tie2: rejected 1 hour ago (2026-10-21T11:00:00.000Z)
    const tie1 = createMockRejectedItem({
      paymentAttemptId: "pay-tie-1",
      amountDue: 500,
      processedAt: "2026-10-21T09:00:00.000Z",
    });
    const tie2 = createMockRejectedItem({
      paymentAttemptId: "pay-tie-2",
      amountDue: 500,
      processedAt: "2026-10-21T11:00:00.000Z",
    });

    // In AMOUNT_DESC: tie2 (more recent) must precede tie1
    const sortedDesc = sortRejectedPaymentsQueue([tie1, tie2], "AMOUNT_DESC");
    expect(sortedDesc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-2", "pay-tie-1"]);

    // In AMOUNT_ASC: tie2 (more recent) must also precede tie1 when amounts match
    const sortedAsc = sortRejectedPaymentsQueue([tie1, tie2], "AMOUNT_ASC");
    expect(sortedAsc.map((i) => i.paymentAttemptId)).toEqual(["pay-tie-2", "pay-tie-1"]);

    // Secondary tie-break: identical amount and identical rejection timestamp
    const exactTieA = createMockRejectedItem({
      paymentAttemptId: "pay-exact-alpha",
      amountDue: 500,
      processedAt: "2026-10-21T11:00:00.000Z",
    });
    const exactTieB = createMockRejectedItem({
      paymentAttemptId: "pay-exact-beta",
      amountDue: 500,
      processedAt: "2026-10-21T11:00:00.000Z",
    });

    const sortedExact = sortRejectedPaymentsQueue([exactTieB, exactTieA], "AMOUNT_DESC");
    expect(sortedExact.map((i) => i.paymentAttemptId)).toEqual([
      "pay-exact-alpha",
      "pay-exact-beta",
    ]);
  });

  it("MS72-TC06: Fallback to proofSubmittedAt and createdAt when processedAt is missing", () => {
    // Item without processedAt, fallback to proofSubmittedAt
    const fallbackItem1 = createMockRejectedItem({
      paymentAttemptId: "pay-fb-1",
      amountDue: 500,
      processedAt: null,
      proofSubmittedAt: "2026-10-20T10:00:00.000Z",
    });
    // Item without processedAt and proofSubmittedAt, fallback to createdAt
    const fallbackItem2 = createMockRejectedItem({
      paymentAttemptId: "pay-fb-2",
      amountDue: 500,
      processedAt: null,
      proofSubmittedAt: null,
      createdAt: "2026-10-21T10:00:00.000Z",
    });

    const sortedDesc = sortRejectedPaymentsQueue([fallbackItem1, fallbackItem2], "REJECTED_DESC");
    expect(sortedDesc.map((i) => i.paymentAttemptId)).toEqual(["pay-fb-2", "pay-fb-1"]);

    const sortedAsc = sortRejectedPaymentsQueue([fallbackItem1, fallbackItem2], "REJECTED_ASC");
    expect(sortedAsc.map((i) => i.paymentAttemptId)).toEqual(["pay-fb-1", "pay-fb-2"]);
  });

  it("MS72-TC07: Accessibility and Design Token Conformance verifies testids, labels, and design tokens", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/payments/components/PaymentQueue.tsx"
    );
    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Rejected sort select control accessibility
    expect(fileContent).toContain('htmlFor="admin-payments-rejected-sort-select"');
    expect(fileContent).toContain('id="admin-payments-rejected-sort-select"');
    expect(fileContent).toContain('data-testid="admin-payments-rejected-sort-select"');

    // Section count badge testid
    expect(fileContent).toContain('data-testid="rejected-section-count"');

    // Dynamic informational notice banner
    expect(fileContent).toContain('data-testid="admin-payments-rejected-sort-notice"');

    // Memoized sort array hook
    expect(fileContent).toContain("const displayedRejectedQueue = useMemo(() => {");
    expect(fileContent).toContain("sortRejectedPaymentsQueue(rejectedQueue, rejectedSortMode)");

    // Adherence to DeskAtlas design tokens
    expect(fileContent).toContain("var(--da-brand-dark)");
    expect(fileContent).toContain("var(--da-border");
    expect(fileContent).toContain("var(--da-font-family)");
    expect(fileContent).toContain("#991B1B");
    expect(fileContent).toContain("#FEE2E2");
    expect(fileContent).toContain("#FEF2F2");
    expect(fileContent).toContain("#FECACA");

    // BAN-PUNCT-01: Zero em-dashes in source code
    expect(fileContent).not.toContain("—");
  });
});
