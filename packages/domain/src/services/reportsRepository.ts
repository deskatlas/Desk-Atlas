import {
  ReportPaymentAttemptRecord,
  ReportRentalRecord,
  ReportReservationRecord,
} from "../models/reports";

export interface ReportsRepository {
  listReportReservations(): Promise<ReportReservationRecord[]>;
  listReportPaymentAttempts(): Promise<ReportPaymentAttemptRecord[]>;
  listReportRentals?(): Promise<ReportRentalRecord[]>;
}
