import {
  AdminFrequentBookerSummary,
  AdminRecentReportSummary,
  AdminReportCategorySummary,
  AdminReportExportType,
  AdminReportRange,
  AdminReportsSnapshot,
  AdminRevenueOverview,
  AdminRevenueOverviewBar,
  AdminTopWorkspaceSummary,
  ReportPaymentAttemptRecord,
  ReportReservationRecord,
} from "../models/reports";
import { ReportsRepository } from "./reportsRepository";
import { buildAdminExcelWorkbook } from "./excelReportBuilder";

const REPORT_CATEGORY_DEFINITIONS: Array<{
  id: AdminReportCategorySummary["id"];
  name: string;
  exportType: AdminReportExportType;
}> = [
  { id: "workspace", name: "Workspace Utilization", exportType: "workspace" },
  { id: "reservations", name: "Reservation History", exportType: "reservations" },
  { id: "payment", name: "Payment Records", exportType: "payment" },
  { id: "booking-activity", name: "Customer Booking Activity", exportType: "booking-activity" },
  { id: "cancellation", name: "Cancellation & Rescheduling", exportType: "cancellation" },
  { id: "checkin", name: "Check-in / Checkout Records", exportType: "checkin" },
];

export class ReportsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportsError";
  }
}

export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly nowProvider: () => Date = () => new Date()
  ) {}

  async getAdminReportsSnapshot(range: AdminReportRange = "month"): Promise<AdminReportsSnapshot> {
    const now = this.nowProvider();
    const reservations = await this.repository.listReportReservations();
    const payments = await this.repository.listReportPaymentAttempts();

    const rangeBounds = calculateReportRangeBounds(now, range);

    const currentReservations = reservations.filter((reservation) =>
      isWithinRange(reservation.createdAt, rangeBounds.currentStart, rangeBounds.currentEnd)
    );
    const prevReservations = reservations.filter((reservation) =>
      isWithinRange(reservation.createdAt, rangeBounds.prevStart, rangeBounds.prevEnd)
    );

    const currentApprovedPayments = payments.filter(
      (attempt) =>
        attempt.paymentStatus === "APPROVED" &&
        attempt.processedAt !== null &&
        isWithinRange(attempt.processedAt, rangeBounds.currentStart, rangeBounds.currentEnd)
    );
    const prevApprovedPayments = payments.filter(
      (attempt) =>
        attempt.paymentStatus === "APPROVED" &&
        attempt.processedAt !== null &&
        isWithinRange(attempt.processedAt, rangeBounds.prevStart, rangeBounds.prevEnd)
    );

    const currentTotalRevenue = currentApprovedPayments.reduce((sum, a) => sum + a.amount, 0);
    const prevTotalRevenue = prevApprovedPayments.reduce((sum, a) => sum + a.amount, 0);
    const currency = currentApprovedPayments[0]?.currency ?? payments[0]?.currency ?? "PHP";

    const confirmedCurrent = currentReservations.filter((r) =>
      ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus)
    );
    const confirmedPrev = prevReservations.filter((r) =>
      ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.reservationStatus)
    );
    const occupancyPctCurrent =
      currentReservations.length > 0
        ? Math.round((confirmedCurrent.length / currentReservations.length) * 100)
        : 0;
    const occupancyPctPrev =
      prevReservations.length > 0
        ? Math.round((confirmedPrev.length / prevReservations.length) * 100)
        : 0;

    const cancelledCurrent = currentReservations.filter((r) =>
      ["CANCELLED", "NEEDS_MANUAL_RESOLUTION"].includes(r.reservationStatus)
    ).length;
    const cancelledPrev = prevReservations.filter((r) =>
      ["CANCELLED", "NEEDS_MANUAL_RESOLUTION"].includes(r.reservationStatus)
    ).length;

    const summaryMetrics = [
      {
        label: getReservationsMetricLabel(range),
        value: formatInteger(currentReservations.length),
        rawValue: currentReservations.length,
        trend: `${formatComparisonTrend(currentReservations.length, prevReservations.length)} ${rangeBounds.comparisonLabel}`,
        positive: currentReservations.length >= prevReservations.length,
      },
      {
        label: getRevenueMetricLabel(range),
        value: formatCurrency(currentTotalRevenue, currency),
        rawValue: currentTotalRevenue,
        trend: `${formatComparisonTrend(currentTotalRevenue, prevTotalRevenue)} ${rangeBounds.comparisonLabel}`,
        positive: currentTotalRevenue >= prevTotalRevenue,
      },
      {
        label: "Occupancy Rate",
        value: `${occupancyPctCurrent}%`,
        rawValue: occupancyPctCurrent,
        trend: `${occupancyPctCurrent >= occupancyPctPrev ? "+" : ""}${occupancyPctCurrent - occupancyPctPrev}% ${rangeBounds.comparisonLabel}`,
        positive: occupancyPctCurrent >= occupancyPctPrev,
      },
      {
        label: "No Shows & Cancellations",
        value: formatInteger(cancelledCurrent),
        rawValue: cancelledCurrent,
        trend: `${formatComparisonTrend(cancelledCurrent, cancelledPrev)} ${rangeBounds.comparisonLabel}`,
        positive: cancelledCurrent <= cancelledPrev,
      },
    ];

    const revenueOverview = buildRevenueOverview(now, payments, currency);
    const topWorkspaces = buildTopWorkspaces(currentReservations.length > 0 ? currentReservations : reservations);

    const reportCategories = REPORT_CATEGORY_DEFINITIONS.map((definition) => ({
      id: definition.id,
      name: definition.name,
      count: this.buildExportRows(definition.exportType, reservations, payments).length,
      exportType: definition.exportType,
    }));

    const recentReports = REPORT_CATEGORY_DEFINITIONS.map((definition, index) =>
      this.buildRecentReport(definition.exportType, definition.name, index + 1, now)
    );

    const topUsers = buildTopUsers(currentReservations.length > 0 ? currentReservations : reservations);

    return {
      range,
      rangeLabel: rangeBounds.rangeLabel,
      summaryMetrics,
      revenueOverview,
      topWorkspaces,
      reportCategories,
      recentReports,
      topUsers,
      defaultExportType: "operations-summary",
      generatedAt: now.toISOString(),
    };
  }

  async exportAdminReport(
    exportType: AdminReportExportType,
    range?: AdminReportRange,
    format: "csv" | "xlsx" = "csv"
  ): Promise<{
    filename: string;
    contentType: string;
    content: string;
    buffer?: Buffer;
  }> {
    const now = this.nowProvider();
    let reservations = await this.repository.listReportReservations();
    let payments = await this.repository.listReportPaymentAttempts();

    if (range) {
      const rangeBounds = calculateReportRangeBounds(now, range);
      reservations = reservations.filter((r) =>
        isWithinRange(r.createdAt, rangeBounds.currentStart, rangeBounds.currentEnd)
      );
      payments = payments.filter((p) =>
        isWithinRange(p.createdAt, rangeBounds.currentStart, rangeBounds.currentEnd)
      );
    }

    const filenameDate = now.toISOString().slice(0, 10);
    const rangeSuffix = range ? `-${range}` : "";

    if (format === "xlsx") {
      const snapshot = await this.getAdminReportsSnapshot(range ?? "month");
      const buffer = await buildAdminExcelWorkbook({
        exportType,
        range,
        snapshot,
        reservations,
        payments,
        now,
      });

      return {
        filename: `deskatlas-${exportType}${rangeSuffix}-${filenameDate}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: buffer.toString("base64"),
        buffer,
      };
    }

    const rows = this.buildExportRows(exportType, reservations, payments);

    return {
      filename: `deskatlas-${exportType}${rangeSuffix}-${filenameDate}.csv`,
      contentType: "text/csv; charset=utf-8",
      content: toCsv(rows),
    };
  }

  async exportAdminExcelReport(
    exportType: AdminReportExportType,
    range?: AdminReportRange
  ): Promise<{
    filename: string;
    contentType: string;
    buffer: Buffer;
  }> {
    const result = await this.exportAdminReport(exportType, range, "xlsx");
    return {
      filename: result.filename,
      contentType: result.contentType,
      buffer: result.buffer!,
    };
  }

  private buildExportRows(
    exportType: AdminReportExportType,
    reservations: ReportReservationRecord[],
    payments: ReportPaymentAttemptRecord[]
  ): Array<Record<string, string | number>> {
    switch (exportType) {
      case "operations-summary":
        return buildOperationsSummaryRows(reservations, payments);
      case "workspace":
        return buildWorkspaceRows(reservations);
      case "reservations":
        return buildReservationRows(reservations);
      case "payment":
        return buildPaymentRows(payments);
      case "booking-activity":
        return buildBookingActivityRows(reservations);
      case "cancellation":
        return buildCancellationRows(reservations, payments);
      case "checkin":
        return buildCheckInRows(reservations);
      default:
        throw new ReportsError("Unsupported report export type.");
    }
  }

  private buildRecentReport(
    exportType: AdminReportExportType,
    name: string,
    sequence: number,
    now: Date
  ): AdminRecentReportSummary {
    const reportId = `RPT-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(sequence).padStart(3, "0")}`;
    return {
      id: reportId,
      name: `${name} - ${formatMonthLabel(now)}`,
      date: now.toISOString().slice(0, 10),
      type: name,
      status: "ready",
      exportType,
    };
  }
}

export function createReportsService(
  repository: ReportsRepository,
  nowProvider?: () => Date
) {
  return new ReportsService(repository, nowProvider);
}

function calculateReportRangeBounds(now: Date, range: AdminReportRange) {
  let currentStart: Date;
  let currentEnd: Date;
  let prevStart: Date;
  let prevEnd: Date;
  let comparisonLabel: string;
  let rangeLabel: string;

  switch (range) {
    case "today": {
      const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
      currentStart = startOfToday;
      currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      prevStart = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
      prevEnd = startOfToday;
      comparisonLabel = "vs yesterday";
      rangeLabel = "Today";
      break;
    }
    case "7days": {
      currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      currentEnd = new Date(now.getTime() + 1000);
      prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      prevEnd = currentStart;
      comparisonLabel = "vs previous 7 days";
      rangeLabel = "Last 7 Days";
      break;
    }
    case "30days": {
      currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      currentEnd = new Date(now.getTime() + 1000);
      prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      prevEnd = currentStart;
      comparisonLabel = "vs previous 30 days";
      rangeLabel = "Last 30 Days";
      break;
    }
    case "year": {
      currentStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      currentEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
      prevStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      prevEnd = currentStart;
      comparisonLabel = "vs last year";
      rangeLabel = "This Year";
      break;
    }
    case "month":
    default: {
      currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      prevEnd = currentStart;
      comparisonLabel = "vs last month";
      rangeLabel = "This Month";
      break;
    }
  }

  return {
    currentStart,
    currentEnd,
    prevStart,
    prevEnd,
    comparisonLabel,
    rangeLabel,
  };
}

function getReservationsMetricLabel(range: AdminReportRange): string {
  switch (range) {
    case "today":
      return "Total Reservations Today";
    case "7days":
      return "Total Reservations (7 Days)";
    case "30days":
      return "Total Reservations (30 Days)";
    case "year":
      return "Total Reservations This Year";
    case "month":
    default:
      return "Total Reservations This Month";
  }
}

function getRevenueMetricLabel(range: AdminReportRange): string {
  switch (range) {
    case "today":
      return "Total Payments Today";
    case "7days":
      return "Total Payments (7 Days)";
    case "30days":
      return "Total Payments (30 Days)";
    case "year":
      return "Total Payments This Year";
    case "month":
    default:
      return "Total Payments This Month";
  }
}

function formatComparisonTrend(current: number, previous: number): string {
  if (previous === 0) {
    if (current === 0) return "0%";
    return "+100%";
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function buildRevenueOverview(
  now: Date,
  payments: ReportPaymentAttemptRecord[],
  currency: string
): AdminRevenueOverview {
  const approvedPayments = payments.filter(
    (p) => p.paymentStatus === "APPROVED" && p.processedAt !== null
  );

  const days: AdminRevenueOverviewBar[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const dateIsoPrefix = d.toISOString().slice(0, 10);
    const dayLabel = dayNames[d.getUTCDay()];

    const dayPayments = approvedPayments.filter((p) =>
      p.processedAt?.startsWith(dateIsoPrefix)
    );
    const dayAmount = dayPayments.reduce((sum, p) => sum + p.amount, 0);

    days.push({
      label: dayLabel,
      date: dateIsoPrefix,
      amount: dayAmount,
      formattedAmount: formatCurrency(dayAmount, currency),
      heightPercentage: 0,
    });
  }

  const maxAmount = Math.max(...days.map((d) => d.amount), 0);
  const totalAmount = days.reduce((sum, d) => sum + d.amount, 0);

  const bars = days.map((d) => ({
    ...d,
    heightPercentage:
      maxAmount > 0
        ? Math.max(d.amount > 0 ? 8 : 0, Math.round((d.amount / maxAmount) * 100))
        : 0,
  }));

  return {
    totalAmount,
    formattedTotalAmount: formatCurrency(totalAmount, currency),
    currency,
    bars,
  };
}

function buildTopWorkspaces(
  reservations: ReportReservationRecord[]
): AdminTopWorkspaceSummary[] {
  const usageByWorkspace = new Map<
    string,
    {
      id: string;
      name: string;
      templateName: string;
      floorName: string;
      reservationCount: number;
      bookedHours: number;
    }
  >();

  for (const reservation of reservations) {
    if (!reservation.workspaceDisplayName) {
      continue;
    }

    const key = reservation.workspaceInstanceCode ?? reservation.workspaceDisplayName;
    const existing = usageByWorkspace.get(key) ?? {
      id: key,
      name: reservation.workspaceDisplayName,
      templateName: reservation.workspaceTemplateName ?? "Standard Workspace",
      floorName: reservation.floorName ?? "Main Floor",
      reservationCount: 0,
      bookedHours: 0,
    };

    existing.reservationCount += 1;
    if (reservation.bookingStartAt && reservation.bookingEndAt) {
      existing.bookedHours += calculateDurationHours(
        reservation.bookingStartAt,
        reservation.bookingEndAt
      );
    } else {
      existing.bookedHours += 1;
    }
    usageByWorkspace.set(key, existing);
  }

  const totalBookings = reservations.length || 1;
  return Array.from(usageByWorkspace.values())
    .sort((left, right) => right.reservationCount - left.reservationCount || right.bookedHours - left.bookedHours)
    .slice(0, 5)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      templateName: entry.templateName,
      floorName: entry.floorName,
      reservationCount: entry.reservationCount,
      bookedHours: Number(entry.bookedHours.toFixed(1)),
      occupancyPercentage: Math.min(100, Math.round((entry.reservationCount / totalBookings) * 100)),
    }));
}

function buildTopUsers(
  reservations: ReportReservationRecord[]
): AdminFrequentBookerSummary[] {
  const byCustomer = new Map<
    string,
    { name: string; bookings: number; spent: number; currency: string }
  >();

  for (const reservation of reservations) {
    const key = reservation.customerEmail.trim().toLowerCase();
    const current = byCustomer.get(key) ?? {
      name: `${reservation.customerFirstName} ${reservation.customerLastName}`.trim(),
      bookings: 0,
      spent: 0,
      currency: reservation.currency,
    };

    current.bookings += 1;
    current.spent += reservation.amountDue;
    byCustomer.set(key, current);
  }

  return Array.from(byCustomer.values())
    .sort((left, right) => {
      if (right.bookings !== left.bookings) {
        return right.bookings - left.bookings;
      }
      return right.spent - left.spent;
    })
    .slice(0, 5)
    .map((entry) => ({
      name: entry.name,
      bookings: entry.bookings,
      spent: formatCurrency(entry.spent, entry.currency),
      rawSpent: entry.spent,
    }));
}

function buildOperationsSummaryRows(
  reservations: ReportReservationRecord[],
  payments: ReportPaymentAttemptRecord[]
) {
  const approvedPayments = payments.filter((attempt) => attempt.paymentStatus === "APPROVED");
  const totalApprovedAmount = approvedPayments.reduce((sum, attempt) => sum + attempt.amount, 0);
  const currency = approvedPayments[0]?.currency ?? reservations[0]?.currency ?? "PHP";

  return [
    { metric: "total_reservations", value: reservations.length },
    {
      metric: "confirmed_or_completed_reservations",
      value: reservations.filter((reservation) =>
        ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(reservation.reservationStatus)
      ).length,
    },
    { metric: "payment_attempts", value: payments.length },
    { metric: "approved_payment_total", value: formatCurrency(totalApprovedAmount, currency) },
    {
      metric: "manual_resolution_cases",
      value: reservations.filter(
        (reservation) => reservation.reservationStatus === "NEEDS_MANUAL_RESOLUTION"
      ).length,
    },
    {
      metric: "cancelled_reservations",
      value: reservations.filter((reservation) => reservation.reservationStatus === "CANCELLED").length,
    },
  ];
}

function buildWorkspaceRows(reservations: ReportReservationRecord[]) {
  const usageByWorkspace = new Map<
    string,
    {
      floorName: string;
      workspaceDisplayName: string;
      workspaceInstanceCode: string;
      workspaceTemplateName: string;
      reservationCount: number;
      bookedHours: number;
    }
  >();

  for (const reservation of reservations) {
    if (!reservation.workspaceDisplayName || !reservation.bookingStartAt || !reservation.bookingEndAt) {
      continue;
    }

    const key = reservation.workspaceInstanceCode ?? reservation.workspaceDisplayName;
    const existing = usageByWorkspace.get(key) ?? {
      floorName: reservation.floorName ?? "",
      workspaceDisplayName: reservation.workspaceDisplayName,
      workspaceInstanceCode: reservation.workspaceInstanceCode ?? "",
      workspaceTemplateName: reservation.workspaceTemplateName ?? "",
      reservationCount: 0,
      bookedHours: 0,
    };

    existing.reservationCount += 1;
    existing.bookedHours += calculateDurationHours(
      reservation.bookingStartAt,
      reservation.bookingEndAt
    );
    usageByWorkspace.set(key, existing);
  }

  return Array.from(usageByWorkspace.values())
    .sort((left, right) => right.reservationCount - left.reservationCount)
    .map((entry) => ({
      floor_name: entry.floorName,
      workspace_name: entry.workspaceDisplayName,
      workspace_code: entry.workspaceInstanceCode,
      workspace_template: entry.workspaceTemplateName,
      reservation_count: entry.reservationCount,
      booked_hours: Number(entry.bookedHours.toFixed(2)),
    }));
}

function buildReservationRows(reservations: ReportReservationRecord[]) {
  return reservations
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((reservation) => ({
      reference_code: reservation.referenceCode,
      source: reservation.source,
      customer_name: `${reservation.customerFirstName} ${reservation.customerLastName}`.trim(),
      customer_email: reservation.customerEmail,
      reservation_status: reservation.reservationStatus,
      workspace_name: reservation.workspaceDisplayName ?? "",
      workspace_code: reservation.workspaceInstanceCode ?? "",
      floor_name: reservation.floorName ?? "",
      booking_start_at: reservation.bookingStartAt ?? "",
      booking_end_at: reservation.bookingEndAt ?? "",
      amount_due: reservation.amountDue,
      currency: reservation.currency,
      created_at: reservation.createdAt,
    }));
}

function buildPaymentRows(payments: ReportPaymentAttemptRecord[]) {
  return payments
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((attempt) => ({
      reservation_reference_code: attempt.reservationReferenceCode,
      channel: attempt.channel,
      payment_status: attempt.paymentStatus,
      refund_status: attempt.refundStatus,
      payment_method: attempt.paymentMethodDisplayName ?? "",
      payment_method_type: attempt.paymentMethodType ?? "",
      amount: attempt.amount,
      currency: attempt.currency,
      proof_submitted_at: attempt.proofSubmittedAt ?? "",
      processed_at: attempt.processedAt ?? "",
      created_at: attempt.createdAt,
    }));
}

function buildBookingActivityRows(reservations: ReportReservationRecord[]) {
  return reservations
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((reservation) => ({
      customer_name: `${reservation.customerFirstName} ${reservation.customerLastName}`.trim(),
      customer_email: reservation.customerEmail,
      reference_code: reservation.referenceCode,
      source: reservation.source,
      reservation_status: reservation.reservationStatus,
      assigned_candidate_rank:
        reservation.assignedCandidateRank === null ? "" : reservation.assignedCandidateRank,
      amount_due: reservation.amountDue,
      created_at: reservation.createdAt,
    }));
}

function buildCancellationRows(
  reservations: ReportReservationRecord[],
  payments: ReportPaymentAttemptRecord[]
) {
  const refundStatusByReservation = new Map<string, string>();
  for (const payment of payments) {
    const existing = refundStatusByReservation.get(payment.reservationId);
    if (existing === "REFUNDED") {
      continue;
    }
    refundStatusByReservation.set(payment.reservationId, payment.refundStatus);
  }

  return reservations
    .filter((reservation) =>
      reservation.reservationStatus === "CANCELLED" ||
      reservation.reservationStatus === "NEEDS_MANUAL_RESOLUTION"
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((reservation) => ({
      reference_code: reservation.referenceCode,
      customer_name: `${reservation.customerFirstName} ${reservation.customerLastName}`.trim(),
      reservation_status: reservation.reservationStatus,
      refund_status: refundStatusByReservation.get(reservation.reservationId) ?? "NONE",
      amount_due: reservation.amountDue,
      currency: reservation.currency,
      created_at: reservation.createdAt,
    }));
}

function buildCheckInRows(reservations: ReportReservationRecord[]) {
  return reservations
    .filter((reservation) => reservation.checkedInAt !== null || reservation.checkedOutAt !== null)
    .sort((left, right) =>
      (right.checkedInAt ?? right.checkedOutAt ?? "").localeCompare(
        left.checkedInAt ?? left.checkedOutAt ?? ""
      )
    )
    .map((reservation) => ({
      reference_code: reservation.referenceCode,
      customer_name: `${reservation.customerFirstName} ${reservation.customerLastName}`.trim(),
      workspace_name: reservation.workspaceDisplayName ?? "",
      workspace_code: reservation.workspaceInstanceCode ?? "",
      floor_name: reservation.floorName ?? "",
      checked_in_at: reservation.checkedInAt ?? "",
      checked_out_at: reservation.checkedOutAt ?? "",
      reservation_status: reservation.reservationStatus,
      source: reservation.source,
    }));
}

function isWithinRange(valueIso: string, start: Date, end: Date) {
  const valueTime = new Date(valueIso).getTime();
  return valueTime >= start.getTime() && valueTime < end.getTime();
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatMonthLabel(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
}

function calculateDurationHours(startAt: string, endAt: string) {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / (1000 * 60 * 60);
}

function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => csvEscape(row[header]))
        .join(",")
    ),
  ];

  return lines.join("\n");
}

function csvEscape(value: string | number) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export interface RevenueBarLabelInfo {
  formattedValue: string;
  isInsideBar: boolean;
  isZero: boolean;
}

export function formatRevenueBarValue(
  amount?: number,
  currency: string = "PHP"
): string {
  const numericAmount = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  if (numericAmount === 0) {
    return "₱0";
  }

  const hasDecimals = numericAmount % 1 !== 0;
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: currency || "PHP",
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch {
    return `₱${numericAmount.toLocaleString("en-US", {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  }
}

export function getRevenueBarLabelInfo(
  heightPercentage: number,
  amount?: number,
  currency: string = "PHP"
): RevenueBarLabelInfo {
  const numericAmount = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  const isZero = numericAmount === 0;
  const formattedValue = formatRevenueBarValue(numericAmount, currency);
  // Place inside the bar if the bar has sufficient vertical space (>= 25% height) and is not zero
  const isInsideBar = !isZero && heightPercentage >= 25;

  return {
    formattedValue,
    isInsideBar,
    isZero,
  };
}

