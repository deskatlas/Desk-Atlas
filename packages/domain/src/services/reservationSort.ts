import { AdminReservationSummary, StaffOperationalReservation } from "../models/reservation";

export type ReservationSortDirection = "asc" | "desc";
export type ReservationSortOrder = "asc" | "desc" | "none";

/**
 * Sorts AdminReservationSummary items by their scheduled booking start time.
 * - 'asc': Earliest scheduled start time first -> latest.
 * - 'desc': Latest scheduled start time first -> earliest.
 * 
 * Ties in start time are broken by end time, then creation time, then reference code.
 * Items missing explicit start dates fall back to createdAt, or are placed at the end.
 */
export function sortAdminReservationsBySchedule<T extends AdminReservationSummary>(
  reservations: T[],
  direction: ReservationSortDirection = "asc"
): T[] {
  return [...reservations].sort((a, b) => {
    const timeA = a.startAt
      ? new Date(a.startAt).getTime()
      : a.createdAt
      ? new Date(a.createdAt).getTime()
      : direction === "asc"
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

    const timeB = b.startAt
      ? new Date(b.startAt).getTime()
      : b.createdAt
      ? new Date(b.createdAt).getTime()
      : direction === "asc"
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

    const validA = !isNaN(timeA);
    const validB = !isNaN(timeB);

    if (!validA && !validB) return (a.referenceCode || "").localeCompare(b.referenceCode || "");
    if (!validA) return 1;
    if (!validB) return -1;

    if (timeA !== timeB) {
      return direction === "asc" ? timeA - timeB : timeB - timeA;
    }

    // Tiebreaker 1: End time
    const endA = a.endAt ? new Date(a.endAt).getTime() : 0;
    const endB = b.endAt ? new Date(b.endAt).getTime() : 0;
    if (endA !== endB && !isNaN(endA) && !isNaN(endB)) {
      return direction === "asc" ? endA - endB : endB - endA;
    }

    // Tiebreaker 2: Created at
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (createdA !== createdB && !isNaN(createdA) && !isNaN(createdB)) {
      return direction === "asc" ? createdA - createdB : createdB - createdA;
    }

    // Tiebreaker 3: Reference code
    return (a.referenceCode || "").localeCompare(b.referenceCode || "");
  });
}

/**
 * Sorts StaffOperationalReservation items by their scheduled booking start time.
 * - 'asc': Earliest scheduled start time first -> latest.
 * - 'desc': Latest scheduled start time first -> earliest.
 * 
 * Ties in start time are broken by end time, then confirmed time, then reference code.
 * Items missing explicit start dates are placed at the end.
 */
export function sortStaffReservationsBySchedule<T extends StaffOperationalReservation>(
  reservations: T[],
  direction: ReservationSortDirection = "asc"
): T[] {
  return [...reservations].sort((a, b) => {
    const timeA = a.bookingStartAt
      ? new Date(a.bookingStartAt).getTime()
      : direction === "asc"
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

    const timeB = b.bookingStartAt
      ? new Date(b.bookingStartAt).getTime()
      : direction === "asc"
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

    const validA = !isNaN(timeA);
    const validB = !isNaN(timeB);

    if (!validA && !validB) return (a.referenceCode || "").localeCompare(b.referenceCode || "");
    if (!validA) return 1;
    if (!validB) return -1;

    if (timeA !== timeB) {
      return direction === "asc" ? timeA - timeB : timeB - timeA;
    }

    // Tiebreaker 1: End time
    const endA = a.bookingEndAt ? new Date(a.bookingEndAt).getTime() : 0;
    const endB = b.bookingEndAt ? new Date(b.bookingEndAt).getTime() : 0;
    if (endA !== endB && !isNaN(endA) && !isNaN(endB)) {
      return direction === "asc" ? endA - endB : endB - endA;
    }

    // Tiebreaker 2: Confirmed time
    const confA = a.confirmedAt ? new Date(a.confirmedAt).getTime() : 0;
    const confB = b.confirmedAt ? new Date(b.confirmedAt).getTime() : 0;
    if (confA !== confB && !isNaN(confA) && !isNaN(confB)) {
      return direction === "asc" ? confA - confB : confB - confA;
    }

    // Tiebreaker 3: Reference code
    return (a.referenceCode || "").localeCompare(b.referenceCode || "");
  });
}
