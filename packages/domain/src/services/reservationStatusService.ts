import { ReservationStatus } from "../models/reservation";

export interface ReservationStatusInput {
  status: string;
  reservationStatus?: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  endAt?: string | null;
  bookingEndAt?: string | null;
  paymentExpiresAt?: string | null;
  paymentStatus?: string | null;
  paymentAttemptStatus?: string | null;
}

export function resolveReservationOperationalStatus(
  reservation: ReservationStatusInput,
  nowMs: number = Date.now()
): "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED" | "PENDING_PAYMENT" {
  // 1. Rejected payments belong strictly to REJECTED
  if (
    reservation.reservationStatus === "REJECTED" ||
    reservation.status?.toUpperCase() === "REJECTED" ||
    reservation.paymentStatus?.toUpperCase() === "REJECTED" ||
    reservation.paymentAttemptStatus?.toUpperCase() === "REJECTED"
  ) {
    return "REJECTED";
  }

  // 2. Explicit cancellations
  if (reservation.reservationStatus === "CANCELLED" || reservation.status?.toUpperCase() === "CANCELLED") {
    return "CANCELLED";
  }

  const effectiveEnd = reservation.endAt ?? reservation.bookingEndAt ?? null;
  const endMs = effectiveEnd ? new Date(effectiveEnd).getTime() : NaN;
  const hasEnded = !isNaN(endMs) && endMs <= nowMs;
  const hasCheckedIn = Boolean(reservation.checkedInAt);

  // 3. Completed: Checked in, and session has ended (checkout is automatic)
  if (hasCheckedIn && hasEnded) {
    return "COMPLETED";
  }

  // 4. Currently Active Check-In
  if (hasCheckedIn && !hasEnded && !reservation.checkedOutAt) {
    return "CHECKED_IN";
  }

  // 5. Expired: Booking ended but customer NEVER checked in (No-Show)
  if (!hasCheckedIn && hasEnded) {
    return "EXPIRED";
  }

  // 6. Expired: Pending payment session expired without payment submission
  if (
    (reservation.reservationStatus === "PENDING_PAYMENT" || reservation.status?.toUpperCase() === "PENDING_PAYMENT") &&
    reservation.paymentExpiresAt &&
    new Date(reservation.paymentExpiresAt).getTime() <= nowMs
  ) {
    return "EXPIRED";
  }

  if (reservation.reservationStatus === "PENDING_PAYMENT" || reservation.status?.toUpperCase() === "PENDING_PAYMENT") {
    return "PENDING_PAYMENT";
  }

  return "CONFIRMED";
}
