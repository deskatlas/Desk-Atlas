import type { ReservationStatus } from "./reservation";

export type AdminReportCategoryId =
  | "workspace"
  | "reservations"
  | "payment"
  | "booking-activity"
  | "cancellation"
  | "checkin"
  | "rentals";

export type AdminReportExportType =
  | "operations-summary"
  | "workspace"
  | "reservations"
  | "payment"
  | "booking-activity"
  | "cancellation"
  | "checkin"
  | "rentals";

export interface ReportReservationRecord {
  reservationId: string;
  referenceCode: string;
  source: "WEB" | "KIOSK";
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  reservationStatus: ReservationStatus;
  amountDue: number;
  currency: string;
  createdAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  bookingStartAt: string | null;
  bookingEndAt: string | null;
  assignedCandidateRank: 0 | 1 | 2 | null;
  workspaceDisplayName: string | null;
  workspaceInstanceCode: string | null;
  workspaceTemplateName: string | null;
  floorName: string | null;
  rescheduleCount?: number | null;
  updatedAt?: string | null;
  rescheduledAt?: string | null;
  reminderSentAt?: string | null;
  attendanceReconfirmedAt?: string | null;
  refundStatus?: "NONE" | "REQUIRED" | "REFUNDED" | "ELIGIBLE" | null;
  refundedAt?: string | null;
  cancellationRefundNotifiedAt?: string | null;
}

export interface ReportPaymentAttemptRecord {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  channel: "WEB" | "KIOSK";
  paymentStatus:
    | "PENDING"
    | "UNDER_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "CANCELLED";
  refundStatus: "NONE" | "REQUIRED" | "REFUNDED" | "ELIGIBLE";
  amount: number;
  currency: string;
  paymentMethodId: string | null;
  paymentMethodType: "GCASH" | "BANK" | "CASH" | null;
  paymentMethodDisplayName: string | null;
  createdAt: string;
  proofSubmittedAt: string | null;
  processedAt: string | null;
  refundedAt?: string | null;
  overdueNotifiedAt?: string | null;
  cancellationRefundNotifiedAt?: string | null;
}

export interface ReportRentalRecord {
  rentalId: string;
  rentalCode: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  spotName: string;
  serviceName: string;
  serviceType: "rental" | "one_time";
  billingMode: "hourly" | "daily";
  durationUnits: number;
  rateApplied: number;
  totalAmount: number;
  extensionCount: number;
  extensionAmount: number;
  idVerified: boolean;
  idNotes: string;
  status: "active" | "returned" | "overdue" | "cancelled";
  rentedAt: string;
  dueAt: string;
  returnedAt: string | null;
  staffName: string;
}

export interface RentalAnalyticsSnapshot {
  totalRentalsCount: number;
  activeRentalsCount: number;
  returnedRentalsCount: number;
  overdueRentalsCount: number;
  totalRentalRevenue: number;
  averageDurationHours: number;
  topRentedItems: Array<{
    serviceId: string;
    serviceName: string;
    rentalsCount: number;
    totalRevenue: number;
  }>;
}

export type AdminReportRange = "today" | "7days" | "30days" | "month" | "year";

export interface AdminReportMetric {
  label: string;
  value: string;
  rawValue: number;
  trend?: string;
  positive?: boolean;
}

export interface AdminRevenueOverviewBar {
  label: string;
  date: string;
  amount: number;
  formattedAmount: string;
  heightPercentage: number;
}

export interface AdminRevenueOverview {
  totalAmount: number;
  formattedTotalAmount: string;
  periodLabel: string;
  currency: string;
  bars: AdminRevenueOverviewBar[];
}

export interface AdminTopWorkspaceSummary {
  id: string;
  name: string;
  templateName: string;
  floorName: string;
  reservationCount: number;
  bookedHours: number;
  occupancyPercentage: number;
}

export interface AdminReportCategorySummary {
  id: AdminReportCategoryId;
  name: string;
  count: number;
  exportType: AdminReportExportType;
}

export interface AdminRecentReportSummary {
  id: string;
  name: string;
  date: string;
  type: string;
  status: "ready";
  exportType: AdminReportExportType;
}

export interface AdminFrequentBookerSummary {
  name: string;
  bookings: number;
  spent: string;
  rawSpent: number;
}

export interface AdminReportsSnapshot {
  range: AdminReportRange;
  rangeLabel: string;
  summaryMetrics: AdminReportMetric[];
  revenueOverview: AdminRevenueOverview;
  topWorkspaces: AdminTopWorkspaceSummary[];
  reportCategories: AdminReportCategorySummary[];
  recentReports: AdminRecentReportSummary[];
  topUsers: AdminFrequentBookerSummary[];
  defaultExportType: AdminReportExportType;
  generatedAt: string;
  rentalAnalytics?: RentalAnalyticsSnapshot;
}
