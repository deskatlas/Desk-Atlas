import { StaffOperationalReservation } from "../models/reservation";
import { isReservationCancelled } from "./reservationTabSegregation";

export type StaffReservationFilter =
  | "active"
  | "all"
  | "checked_in"
  | "upcoming"
  | "confirmed"
  | "counter_queue"
  | "cancelled";

export interface StaffReservationFilterOption {
  label: string;
  filter: StaffReservationFilter;
}

export const STAFF_RESERVATION_FILTERS: StaffReservationFilterOption[] = [
  { label: "Active", filter: "active" },
  { label: "All", filter: "all" },
  { label: "Checked In", filter: "checked_in" },
  { label: "Upcoming", filter: "upcoming" },
  { label: "Confirmed", filter: "confirmed" },
  { label: "Counter Queue", filter: "counter_queue" },
  { label: "Cancelled", filter: "cancelled" },
];

export function matchesStaffReservationFilter(
  res: StaffOperationalReservation,
  filter: StaffReservationFilter,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());
  const isTimeEnded = Boolean(
    res.bookingEndAt &&
    !isNaN(new Date(res.bookingEndAt).getTime()) &&
    new Date(res.bookingEndAt).getTime() <= nowMs
  );

  switch (filter) {
    case "all":
      return true;

    case "active":
      // Ended bookings are automatically checked out / completed and removed from Active
      if (isTimeEnded) {
        return false;
      }
      // Currently active reservations — either explicitly CHECKED_IN or CONFIRMED where now >= bookingStartAt and now < bookingEndAt.
      if (
        (res.reservationStatus === "CHECKED_IN" || res.checkInState === "CHECKED_IN") &&
        res.checkInState !== "CHECKED_OUT" &&
        res.reservationStatus !== "COMPLETED"
      ) {
        return true;
      }
      if (res.reservationStatus === "CONFIRMED") {
        if (!res.bookingStartAt || !res.bookingEndAt) return false;
        const startMs = new Date(res.bookingStartAt).getTime();
        const endMs = new Date(res.bookingEndAt).getTime();
        if (isNaN(startMs) || isNaN(endMs)) return false;
        return nowMs >= startMs && nowMs < endMs;
      }
      return false;

    case "checked_in":
      // Ended bookings are automatically checked out and removed from Checked In
      if (isTimeEnded) {
        return false;
      }
      return (
        (res.reservationStatus === "CHECKED_IN" || res.checkInState === "CHECKED_IN") &&
        res.checkInState !== "CHECKED_OUT" &&
        res.reservationStatus !== "COMPLETED"
      );

    case "upcoming": {
      if (isTimeEnded) return false;
      // Confirmed reservations that have not started yet (reservationStatus === 'CONFIRMED' and new Date(bookingStartAt).getTime() > now)
      if (res.reservationStatus !== "CONFIRMED") return false;
      if (!res.bookingStartAt) return false;
      const startMs = new Date(res.bookingStartAt).getTime();
      if (isNaN(startMs)) return false;
      return startMs > nowMs;
    }

    case "confirmed":
      if (isTimeEnded) return false;
      // Reservations with reservationStatus === 'CONFIRMED'
      return res.reservationStatus === "CONFIRMED";

    case "counter_queue":
      if (isTimeEnded) return false;
      // Reservations waiting in the counter queue (reservationStatus === 'PENDING_COUNTER_CONFIRMATION')
      return res.reservationStatus === "PENDING_COUNTER_CONFIRMATION";

    case "cancelled":
      return isReservationCancelled(res);

    default:
      return true;
  }
}

export function filterStaffReservationsByStatus(
  reservations: StaffOperationalReservation[],
  filter: StaffReservationFilter,
  now: Date | number = new Date()
): StaffOperationalReservation[] {
  if (filter === "all") {
    return reservations;
  }
  return reservations.filter((r) => matchesStaffReservationFilter(r, filter, now));
}
