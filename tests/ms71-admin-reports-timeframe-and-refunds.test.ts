// MS-71: Admin Reports Multi-Period Timeframe Filter Reactivity, Refund Financial KPI Metrics, and Cancellation Export Refund Date Integration
// Traceability: PRD-F15, SDD-C11, DSD-UI11, ERD-E10, ERD-E13, QAD-TC52, MS71-TC01..08

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  buildCancellationSheet,
  createReportsService,
  formatDateTime,
  type AdminReportRange,
  type ReportPaymentAttemptRecord,
  type ReportReservationRecord,
  type ReportsRepository,
} from "@deskatlas/domain";

class MockReportsRepository implements ReportsRepository {
  constructor(
    public reservations: ReportReservationRecord[] = [],
    public payments: ReportPaymentAttemptRecord[] = []
  ) {}

  async listReportReservations(): Promise<ReportReservationRecord[]> {
    return this.reservations;
  }

  async listReportPaymentAttempts(): Promise<ReportPaymentAttemptRecord[]> {
    return this.payments;
  }
}

function createPaymentAttempt(overrides: Partial<ReportPaymentAttemptRecord>): ReportPaymentAttemptRecord {
  return {
    paymentAttemptId: overrides.paymentAttemptId || "pay-" + Math.random().toString(36).slice(2, 8),
    reservationId: overrides.reservationId || "res-" + Math.random().toString(36).slice(2, 8),
    reservationReferenceCode: overrides.reservationReferenceCode || "REF-TEST",
    channel: overrides.channel || "WEB",
    paymentStatus: overrides.paymentStatus || "APPROVED",
    refundStatus: overrides.refundStatus || "NONE",
    amount: overrides.amount ?? 500,
    currency: overrides.currency || "PHP",
    paymentMethodId: overrides.paymentMethodId ?? null,
    paymentMethodType: overrides.paymentMethodType ?? "GCASH",
    paymentMethodDisplayName: overrides.paymentMethodDisplayName ?? "GCash",
    createdAt: overrides.createdAt || "2026-10-21T08:00:00.000Z",
    proofSubmittedAt: overrides.proofSubmittedAt ?? "2026-10-21T08:05:00.000Z",
    processedAt: overrides.processedAt ?? "2026-10-21T08:10:00.000Z",
    refundedAt: overrides.refundedAt ?? null,
    ...overrides,
  };
}

function createReservation(overrides: Partial<ReportReservationRecord>): ReportReservationRecord {
  return {
    reservationId: overrides.reservationId || "res-" + Math.random().toString(36).slice(2, 8),
    referenceCode: overrides.referenceCode || "REF-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    source: overrides.source || "WEB",
    customerFirstName: overrides.customerFirstName || "John",
    customerLastName: overrides.customerLastName || "Doe",
    customerEmail: overrides.customerEmail || "john.doe@example.com",
    reservationStatus: overrides.reservationStatus || "CONFIRMED",
    amountDue: overrides.amountDue ?? 500,
    currency: overrides.currency || "PHP",
    createdAt: overrides.createdAt || "2026-10-21T08:00:00.000Z",
    confirmedAt: overrides.confirmedAt ?? "2026-10-21T08:10:00.000Z",
    checkedInAt: overrides.checkedInAt ?? null,
    checkedOutAt: overrides.checkedOutAt ?? null,
    bookingStartAt: overrides.bookingStartAt ?? "2026-10-21T10:00:00.000Z",
    bookingEndAt: overrides.bookingEndAt ?? "2026-10-21T14:00:00.000Z",
    assignedCandidateRank: overrides.assignedCandidateRank ?? 0,
    workspaceDisplayName: overrides.workspaceDisplayName ?? "Desk Alpha",
    workspaceInstanceCode: overrides.workspaceInstanceCode ?? "D-01",
    workspaceTemplateName: overrides.workspaceTemplateName ?? "Dedicated Desk",
    floorName: overrides.floorName ?? "Main Floor",
    ...overrides,
  };
}

describe("MS-71: Admin Reports Timeframe Filter Reactivity, Refund KPI, and Cancellation Export (QAD-TC52)", () => {
  const fixedNow = new Date("2026-10-21T12:00:00.000Z");

  it("MS71-TC01: Revenue Overview 'Today' Timeframe Reactivity", async () => {
    const todayPayment = createPaymentAttempt({
      paymentAttemptId: "pay-today",
      amount: 600,
      paymentStatus: "APPROVED",
      processedAt: "2026-10-21T09:00:00.000Z",
      createdAt: "2026-10-21T08:50:00.000Z",
    });

    const yesterdayPayment = createPaymentAttempt({
      paymentAttemptId: "pay-yesterday",
      amount: 800,
      paymentStatus: "APPROVED",
      processedAt: "2026-10-20T14:00:00.000Z",
      createdAt: "2026-10-20T13:50:00.000Z",
    });

    const repo = new MockReportsRepository([], [todayPayment, yesterdayPayment]);
    const service = createReportsService(repo, () => fixedNow);

    const snapshot = await service.getAdminReportsSnapshot("today");
    expect(snapshot.range).toBe("today");
    expect(snapshot.revenueOverview.periodLabel).toBe("Today's");
    expect(snapshot.revenueOverview.totalAmount).toBe(600);
    expect(snapshot.revenueOverview.bars.length).toBe(1);
    expect(snapshot.revenueOverview.bars[0]?.label).toBe("Today");
    expect(snapshot.revenueOverview.bars[0]?.amount).toBe(600);
  });

  it("MS71-TC02: Revenue Overview '30 Days' Timeframe Reactivity", async () => {
    const repo = new MockReportsRepository([], []);
    const service = createReportsService(repo, () => fixedNow);

    const snapshot = await service.getAdminReportsSnapshot("30days");
    expect(snapshot.range).toBe("30days");
    expect(snapshot.revenueOverview.periodLabel).toBe("30-Day");
    expect(snapshot.revenueOverview.bars.length).toBe(30);

    // Verify dates span 30 consecutive days up to today
    const lastBar = snapshot.revenueOverview.bars[29];
    expect(lastBar?.date).toBe("2026-10-21");
  });

  it("MS71-TC03: Revenue Overview 'This Month' and 'This Year' Reactivity", async () => {
    const repo = new MockReportsRepository([], []);
    const service = createReportsService(repo, () => fixedNow);

    // Test 'month' range (October has 31 days)
    const monthSnapshot = await service.getAdminReportsSnapshot("month");
    expect(monthSnapshot.range).toBe("month");
    expect(monthSnapshot.revenueOverview.periodLabel).toBe("This Month's");
    expect(monthSnapshot.revenueOverview.bars.length).toBe(31);
    expect(monthSnapshot.revenueOverview.bars[0]?.label).toBe("1");
    expect(monthSnapshot.revenueOverview.bars[30]?.label).toBe("31");

    // Test 'year' range (12 calendar months)
    const yearSnapshot = await service.getAdminReportsSnapshot("year");
    expect(yearSnapshot.range).toBe("year");
    expect(yearSnapshot.revenueOverview.periodLabel).toBe("This Year's");
    expect(yearSnapshot.revenueOverview.bars.length).toBe(12);
    expect(yearSnapshot.revenueOverview.bars[0]?.label).toBe("Jan");
    expect(yearSnapshot.revenueOverview.bars[9]?.label).toBe("Oct");
    expect(yearSnapshot.revenueOverview.bars[11]?.label).toBe("Dec");
  });

  it("MS71-TC04: Cancellation / Refunded Amount KPI Calculation", async () => {
    const cancelledRes1 = createReservation({
      reservationId: "res-can-1",
      reservationStatus: "CANCELLED",
      amountDue: 500,
      createdAt: "2026-10-15T08:00:00.000Z",
    });
    const cancelledRes2 = createReservation({
      reservationId: "res-can-2",
      reservationStatus: "CANCELLED",
      amountDue: 1000,
      createdAt: "2026-10-16T08:00:00.000Z",
    });
    const cancelledRes3 = createReservation({
      reservationId: "res-can-3",
      reservationStatus: "CANCELLED",
      amountDue: 250,
      createdAt: "2026-10-17T08:00:00.000Z",
    });

    const payment1 = createPaymentAttempt({
      reservationId: "res-can-1",
      refundStatus: "REFUNDED",
      refundedAt: "2026-10-15T12:00:00.000Z",
      amount: 500,
    });
    const payment2 = createPaymentAttempt({
      reservationId: "res-can-2",
      refundStatus: "REFUNDED",
      refundedAt: "2026-10-16T12:00:00.000Z",
      amount: 1000,
    });
    const payment3 = createPaymentAttempt({
      reservationId: "res-can-3",
      refundStatus: "NONE",
      refundedAt: null,
      amount: 250,
    });

    const repo = new MockReportsRepository(
      [cancelledRes1, cancelledRes2, cancelledRes3],
      [payment1, payment2, payment3]
    );
    const service = createReportsService(repo, () => fixedNow);

    const snapshot = await service.getAdminReportsSnapshot("month");
    const refundMetric = snapshot.summaryMetrics.find((m) => m.label === "Refunds Disbursed");

    expect(refundMetric).toBeDefined();
    expect(refundMetric!.rawValue).toBe(1500);
    expect(refundMetric!.value).toContain("1,500.00");
  });

  it("MS71-TC05: Refunded Amount Period Comparison Trend", async () => {
    // Previous period refund: September 2026 (₱1,000)
    const prevPayment = createPaymentAttempt({
      reservationId: "res-prev",
      refundStatus: "REFUNDED",
      refundedAt: "2026-09-15T10:00:00.000Z",
      amount: 1000,
    });

    // Current period refund: October 2026 (₱1,500)
    const currentPayment = createPaymentAttempt({
      reservationId: "res-curr",
      refundStatus: "REFUNDED",
      refundedAt: "2026-10-10T10:00:00.000Z",
      amount: 1500,
    });

    const repo = new MockReportsRepository([], [prevPayment, currentPayment]);
    const service = createReportsService(repo, () => fixedNow);

    const snapshot = await service.getAdminReportsSnapshot("month");
    const refundMetric = snapshot.summaryMetrics.find((m) => m.label === "Refunds Disbursed");

    expect(refundMetric).toBeDefined();
    expect(refundMetric!.rawValue).toBe(1500);
    // (1500 - 1000) / 1000 = +50%
    expect(refundMetric!.trend).toContain("+50%");
    expect(refundMetric!.positive).toBe(false); // Higher refunds disbursed than previous period is negative
  });

  it("MS71-TC06: Excel Cancellation Sheet Refund Date Column Presence", async () => {
    const workbook = new ExcelJS.Workbook();
    buildCancellationSheet(workbook, [], []);
    const sheet = workbook.getWorksheet("Cancellations & Resolutions");

    expect(sheet).toBeDefined();
    expect(sheet!.columns?.length).toBe(8);

    // Column 5 is 'Refund Date'
    const refundDateCol = sheet!.columns?.[4];
    expect(refundDateCol?.header).toBe("Refund Date");
    expect(refundDateCol?.key).toBe("refundDate");

    // AutoFilter covers columns A1 to H1
    expect(sheet!.autoFilter).toBe("A1:H1");
  });

  it("MS71-TC07: Excel Cancellation Sheet Refund Date Value Formatting", async () => {
    const workbook = new ExcelJS.Workbook();
    const mockReservations: ReportReservationRecord[] = [
      createReservation({
        reservationId: "res-ref-1",
        referenceCode: "DA-REFUNDED-01",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        reservationStatus: "CANCELLED",
        amountDue: 500,
        createdAt: "2026-10-19T08:00:00.000Z",
      }),
      createReservation({
        reservationId: "res-unref-2",
        referenceCode: "DA-UNREFUNDED-02",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        reservationStatus: "CANCELLED",
        amountDue: 250,
        createdAt: "2026-10-19T09:00:00.000Z",
      }),
    ];

    const mockPayments: ReportPaymentAttemptRecord[] = [
      createPaymentAttempt({
        paymentAttemptId: "pay-ref-1",
        reservationId: "res-ref-1",
        reservationReferenceCode: "DA-REFUNDED-01",
        refundStatus: "REFUNDED",
        refundedAt: "2026-10-19T15:45:00.000Z",
        amount: 500,
      }),
      createPaymentAttempt({
        paymentAttemptId: "pay-unref-2",
        reservationId: "res-unref-2",
        reservationReferenceCode: "DA-UNREFUNDED-02",
        refundStatus: "NONE",
        refundedAt: null,
        amount: 250,
      }),
    ];

    buildCancellationSheet(workbook, mockReservations, mockPayments);
    const sheet = workbook.getWorksheet("Cancellations & Resolutions");
    expect(sheet).toBeDefined();

    // Data Row 2: Refunded reservation
    const row2 = sheet!.getRow(2);
    expect(row2.getCell(1).value).toBe("DA-REFUNDED-01");
    expect(row2.getCell(4).value).toBe("REFUNDED");
    expect(String(row2.getCell(5).value)).toContain("Oct 19, 2026");
    expect(row2.getCell(5).alignment?.horizontal).toBe("center");

    // Data Row 3: Unrefunded reservation
    const row3 = sheet!.getRow(3);
    expect(row3.getCell(1).value).toBe("DA-UNREFUNDED-02");
    expect(row3.getCell(4).value).toBe("NONE");
    expect(row3.getCell(5).value).toBe("N/A");
    expect(row3.getCell(5).alignment?.horizontal).toBe("center");
  });

  it("MS71-TC08: UI Header Period Total Binding and Component Static Consistency", () => {
    const componentPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/reports/components/Reports.tsx"
    );
    expect(fs.existsSync(componentPath)).toBe(true);

    const fileContent = fs.readFileSync(componentPath, "utf-8");

    // Dynamic period total testid element
    expect(fileContent).toContain('data-testid="admin-reports-revenue-overview-period-total"');

    // Dynamic periodLabel binding in header
    expect(fileContent).toContain("{snapshot.revenueOverview.periodLabel} Total:");

    // Zero hardcoded '7-Day Total:' in JSX header
    expect(fileContent).not.toContain("7-Day Total:");

    // Fallback metrics list includes Refunds Disbursed
    expect(fileContent).toContain("label: 'Refunds Disbursed'");

    // Adherence to design tokens
    expect(fileContent).toContain("var(--da-brand-dark)");
    expect(fileContent).toContain("var(--da-border)");
    expect(fileContent).toContain("var(--da-text-secondary)");
    expect(fileContent).toContain("var(--da-font-family)");

    // BAN-PUNCT-01: Zero em-dashes
    expect(fileContent).not.toContain("—");
  });
});
