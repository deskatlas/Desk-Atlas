import { GuestReservationAssignmentSummary, CustomerRelocationRequest } from "../models/reservation";

export interface GuestReservationTrackingRecord {
  reservationId: string;
  referenceCode: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail: string;
  customerContactNumber?: string | null;
  customerPhone?: string | null;
  reservationStatus: string;
  amountDue: number;
  grossAmountDue?: number | null;
  discountAmount?: number | null;
  promoCodeUsed?: string | null;
  currency: string;
  confirmedAt: string | null;
  checkedInAt?: string | null;
  checkedOutAt: string | null;
  finalAssignment: GuestReservationAssignmentSummary | null;
  paymentStatus?: string | null;
  rejectionReason?: string | null;
  rescheduleCount?: number;
  pendingRelocationRequest?: CustomerRelocationRequest | null;
  isClosureImpacted?: boolean;
  closureImpactStatus?: import("../models/reservation").ClosureImpactStatus | null;
  closureReason?: string | null;
  closureDate?: string | null;
  closureNotifiedAt?: string | null;
  manualResolutionNotes?: string | null;
  reminderSentAt?: string | null;
  attendanceReconfirmedAt?: string | null;
}

export interface GuestReservationTrackingRepository {
  findGuestReservationTrackingRecord(input: {
    referenceCode: string;
    customerEmail?: string;
  }): Promise<GuestReservationTrackingRecord | null>;
}
