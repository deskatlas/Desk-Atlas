import { GuestReservationAssignmentSummary } from "../models/reservation";

export interface GuestReservationTrackingRecord {
  reservationId: string;
  referenceCode: string;
  customerEmail: string;
  reservationStatus: string;
  amountDue: number;
  currency: string;
  confirmedAt: string | null;
  checkedOutAt: string | null;
  finalAssignment: GuestReservationAssignmentSummary | null;
  paymentStatus?: string | null;
  rejectionReason?: string | null;
}

export interface GuestReservationTrackingRepository {
  findGuestReservationTrackingRecord(input: {
    referenceCode: string;
    customerEmail?: string;
  }): Promise<GuestReservationTrackingRecord | null>;
}
