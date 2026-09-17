import { StaffOperationalReservation } from "../models/reservation";

export type StaffReservationFilter =
  | "active"
  | "all"
  | "checked_in"
  | "upcoming"
  | "confirmed"
  | "counter_queue";

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
];

export function matchesStaffReservationFilter(
  res: StaffOperationalReservation,
  filter: StaffReservationFilter,
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime();

  switch (filter) {
    case "all":
      return true;

    case "active":
      // Currently active reservations — either explicitly CHECKED_IN or CONFIRMED where now >= bookingStartAt and now < bookingEndAt.
      if (res.reservationStatus === "CHECKED_IN") {
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
      // Reservations with reservationStatus === 'CHECKED_IN'
      return res.reservationStatus === "CHECKED_IN";

    case "upcoming": {
      // Confirmed reservations that have not started yet (reservationStatus === 'CONFIRMED' and new Date(bookingStartAt).getTime() > now)
      if (res.reservationStatus !== "CONFIRMED") return false;
      if (!res.bookingStartAt) return false;
      const startMs = new Date(res.bookingStartAt).getTime();
      if (isNaN(startMs)) return false;
      return startMs > nowMs;
    }

    case "confirmed":
      // Reservations with reservationStatus === 'CONFIRMED'
      return res.reservationStatus === "CONFIRMED";

    case "counter_queue":
      // Reservations waiting in the counter queue (reservationStatus === 'PENDING_COUNTER_CONFIRMATION')
      return res.reservationStatus === "PENDING_COUNTER_CONFIRMATION";

    default:
      return true;
  }
}

export function filterStaffReservationsByStatus(
  reservations: StaffOperationalReservation[],
  filter: StaffReservationFilter,
  now: Date = new Date()
): StaffOperationalReservation[] {
  if (filter === "all") {
    return reservations;
  }
  return reservations.filter((r) => matchesStaffReservationFilter(r, filter, now));
}
