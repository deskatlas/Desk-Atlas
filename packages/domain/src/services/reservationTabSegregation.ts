import {
  AdminReservationSummary,
  StaffOperationalReservation,
  ReservationStatus,
} from "../models/reservation";

export type ReservationTabType = "reservations" | "operations" | "completed" | "expired";

export type AdminReservationsSubFilter =
  | "all"
  | "upcoming"
  | "awaiting_proof"
  | "counter_queue"
  | "closure_impacted"
  | "cancelled";

export type AdminOperationsSubFilter =
  | "all"
  | "active"
  | "checked_in";

export type AdminCompletedSubFilter =
  | "all"
  | "completed";

export type AdminExpiredSubFilter =
  | "all"
  | "expired"
  | "rejected"
  | "cancelled";

export type StaffReservationsSubFilter =
  | "all"
  | "upcoming"
  | "confirmed"
  | "counter_queue"
  | "closure_impacted"
  | "cancelled";

export type StaffOperationsSubFilter =
  | "all"
  | "active"
  | "checked_in";

export type StaffCompletedSubFilter =
  | "all"
  | "completed";

export type StaffExpiredSubFilter =
  | "all"
  | "expired"
  | "rejected"
  | "cancelled";

export interface ReservationTabFilterOption<T extends string = string> {
  label: string;
  filter: T;
}

export const ADMIN_RESERVATIONS_TAB_FILTERS: ReservationTabFilterOption<AdminReservationsSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Upcoming", filter: "upcoming" },
  { label: "Awaiting Proof", filter: "awaiting_proof" },
  { label: "Counter Queue", filter: "counter_queue" },
  { label: "Closure Impacted", filter: "closure_impacted" },
  { label: "Cancelled", filter: "cancelled" },
];

export const ADMIN_OPERATIONS_TAB_FILTERS: ReservationTabFilterOption<AdminOperationsSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Active", filter: "active" },
  { label: "Checked In", filter: "checked_in" },
];

export const ADMIN_COMPLETED_TAB_FILTERS: ReservationTabFilterOption<AdminCompletedSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Completed", filter: "completed" },
];

export const ADMIN_EXPIRED_TAB_FILTERS: ReservationTabFilterOption<AdminExpiredSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Expired", filter: "expired" },
  { label: "Rejected", filter: "rejected" },
  { label: "Cancelled", filter: "cancelled" },
];

export const STAFF_RESERVATIONS_TAB_FILTERS: ReservationTabFilterOption<StaffReservationsSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Upcoming", filter: "upcoming" },
  { label: "Counter Queue", filter: "counter_queue" },
  { label: "Closure Impacted", filter: "closure_impacted" },
  { label: "Cancelled", filter: "cancelled" },
];

export const STAFF_OPERATIONS_TAB_FILTERS: ReservationTabFilterOption<StaffOperationsSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Active", filter: "active" },
  { label: "Checked In", filter: "checked_in" },
];

export const STAFF_COMPLETED_TAB_FILTERS: ReservationTabFilterOption<StaffCompletedSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Completed", filter: "completed" },
];

export const STAFF_EXPIRED_TAB_FILTERS: ReservationTabFilterOption<StaffExpiredSubFilter>[] = [
  { label: "All", filter: "all" },
  { label: "Expired", filter: "expired" },
  { label: "Rejected", filter: "rejected" },
  { label: "Cancelled", filter: "cancelled" },
];

export function isReservationRejected(
  r: {
    reservationStatus?: string;
    status?: string;
    paymentStatus?: string;
    paymentAttemptStatus?: string | null;
    cancellationReason?: string | null;
  }
): boolean {
  return (
    r.reservationStatus === "REJECTED" ||
    Boolean(r.status && r.status.toLowerCase().includes("rejected")) ||
    Boolean(r.paymentStatus && r.paymentStatus.toLowerCase().includes("rejected")) ||
    Boolean(r.paymentAttemptStatus && r.paymentAttemptStatus.toLowerCase().includes("rejected")) ||
    Boolean(r.cancellationReason && r.cancellationReason.toLowerCase().includes("rejected"))
  );
}

export function isReservationCancelled(
  r: {
    reservationStatus?: string;
    status?: string;
    paymentStatus?: string;
    paymentAttemptStatus?: string | null;
    cancellationReason?: string | null;
  }
): boolean {
  if (isReservationRejected(r)) {
    return false;
  }
  return (
    r.reservationStatus === "CANCELLED" ||
    Boolean(r.status && r.status.toLowerCase().includes("cancelled"))
  );
}

function isTimeWithinWindow(
  startStr?: string | null,
  endStr?: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!startStr || !endStr) return false;
  const startMs = new Date(startStr).getTime();
  const endMs = new Date(endStr).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return false;
  return nowMs >= startMs && nowMs < endMs;
}

export function isAdminExpiredReservation(
  res: AdminReservationSummary,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (
    res.reservationStatus === "COMPLETED" ||
    Boolean(res.checkedOutAt) ||
    (res.status && res.status.toLowerCase().includes("completed")) ||
    (res.status && res.status.toLowerCase().includes("checked out"))
  ) {
    return false;
  }

  if (res.reservationStatus === "EXPIRED" || res.status.toLowerCase() === "expired") {
    return true;
  }

  if (isReservationRejected(res)) {
    return true;
  }

  if (isReservationCancelled(res)) {
    return true;
  }

  // Awaiting proof expired session (1-hour timeout)
  if (res.reservationStatus === "PENDING_PAYMENT") {
    if (res.paymentExpiresAt) {
      const expMs = new Date(res.paymentExpiresAt).getTime();
      if (!isNaN(expMs) && expMs <= nowMs) {
        return true;
      }
    } else if (res.createdAt) {
      const createdMs = new Date(res.createdAt).getTime();
      if (!isNaN(createdMs) && createdMs + 60 * 60 * 1000 <= nowMs) {
        return true;
      }
    }
  }

  // End time elapsed without being checked-in or completed
  if (res.endAt && !res.checkedInAt && (res.reservationStatus as string) !== "COMPLETED") {
    const endMs = new Date(res.endAt).getTime();
    if (!isNaN(endMs) && endMs <= nowMs) {
      return true;
    }
  }

  return false;
}

export function isAdminCompletedReservation(
  res: AdminReservationSummary
): boolean {
  return (
    res.reservationStatus === "COMPLETED" ||
    Boolean(res.checkedOutAt) ||
    res.status.toLowerCase().includes("completed") ||
    res.status.toLowerCase().includes("checked out")
  );
}

export function isAdminOperationsReservation(
  res: AdminReservationSummary,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  // Never show expired, cancelled, or rejected records in Active Operations
  if (isAdminExpiredReservation(res, nowMs)) {
    return false;
  }

  // Never show completed / checked out records in Active Operations (they belong in Completed)
  if (isAdminCompletedReservation(res)) {
    return false;
  }

  // Explicitly checked-in (and not checked out)
  if (
    res.reservationStatus === "CHECKED_IN" ||
    (Boolean(res.checkedInAt) && !res.checkedOutAt) ||
    res.status.toLowerCase().includes("checked in")
  ) {
    return true;
  }

  // Confirmed booking currently in active time window
  if (res.reservationStatus === "CONFIRMED" && res.startAt && res.endAt) {
    if (isTimeWithinWindow(res.startAt, res.endAt, nowMs)) {
      return true;
    }
  }

  return false;
}

export function isAdminBookingManagementReservation(
  res: AdminReservationSummary,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (isAdminExpiredReservation(res, nowMs)) {
    return false;
  }

  if (isAdminCompletedReservation(res)) {
    return false;
  }

  if (isAdminOperationsReservation(res, nowMs)) {
    return false;
  }

  // Pending / Awaiting proof / Counter queue / Manual resolution
  if (
    res.reservationStatus === "PENDING_PAYMENT" ||
    res.reservationStatus === "PAYMENT_UNDER_REVIEW" ||
    res.reservationStatus === "PENDING_COUNTER_CONFIRMATION" ||
    res.reservationStatus === "NEEDS_MANUAL_RESOLUTION"
  ) {
    return true;
  }

  // Upcoming confirmed (start time is in the future or not active yet)
  if (res.reservationStatus === "CONFIRMED") {
    if (!res.startAt) return true;
    const startMs = new Date(res.startAt).getTime();
    if (isNaN(startMs) || startMs > nowMs) {
      return true;
    }
  }

  return true;
}

export function filterAdminReservationsByTab(
  reservations: AdminReservationSummary[],
  tab: ReservationTabType,
  subFilter: AdminReservationsSubFilter | AdminOperationsSubFilter | AdminCompletedSubFilter | AdminExpiredSubFilter = "all",
  now: Date | number = new Date()
): AdminReservationSummary[] {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (tab === "reservations") {
    const base = reservations.filter((r) => isAdminBookingManagementReservation(r, nowMs));
    const sf = subFilter as AdminReservationsSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "upcoming":
        return base.filter((r) => {
          if (r.reservationStatus === "CONFIRMED") {
            if (!r.startAt) return true;
            const startMs = new Date(r.startAt).getTime();
            return isNaN(startMs) || startMs > nowMs;
          }
          return false;
        });

      case "awaiting_proof":
        return base.filter((r) =>
          ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION"].includes(
            r.reservationStatus
          ) &&
          r.reservationStatus !== "EXPIRED" &&
          !isReservationRejected(r)
        );

      case "counter_queue":
        return base.filter(
          (r) =>
            r.reservationStatus === "PENDING_COUNTER_CONFIRMATION" &&
            !isReservationRejected(r)
        );

      case "closure_impacted":
        return reservations.filter(
          (r) =>
            r.isClosureImpacted === true ||
            (Boolean(r.closureImpactStatus) && r.closureImpactStatus !== "CUSTOMER_RESOLVED" && r.closureImpactStatus !== "STAFF_RESOLVED")
        );

      case "cancelled":
        return reservations.filter((r) => isReservationCancelled(r));

      default:
        return base;
    }
  } else if (tab === "operations") {
    // Operations Tab — live occupying / active bookings ONLY
    const base = reservations.filter((r) => isAdminOperationsReservation(r, nowMs));
    const sf = subFilter as AdminOperationsSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "active":
        return base.filter((r) => {
          if (r.reservationStatus === "CHECKED_IN" || (Boolean(r.checkedInAt) && !r.checkedOutAt)) {
            return true;
          }
          if (r.reservationStatus === "CONFIRMED" && r.startAt && r.endAt) {
            return isTimeWithinWindow(r.startAt, r.endAt, nowMs);
          }
          return false;
        });

      case "checked_in":
        return base.filter(
          (r) =>
            !r.checkedOutAt &&
            (r.reservationStatus === "CHECKED_IN" || (Boolean(r.checkedInAt) && !r.checkedOutAt))
        );

      default:
        return base;
    }
  } else if (tab === "completed") {
    // Completed Tab — attended & completed bookings
    const base = reservations.filter((r) => isAdminCompletedReservation(r));
    return base;
  } else {
    // Expired Tab
    const base = reservations.filter((r) => isAdminExpiredReservation(r, nowMs));
    const sf = subFilter as AdminExpiredSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "expired":
        return base.filter(
          (r) =>
            !isReservationCancelled(r) &&
            !isReservationRejected(r) &&
            (r.reservationStatus === "EXPIRED" ||
              r.status.toLowerCase() === "expired" ||
              (r.endAt && !r.checkedInAt && new Date(r.endAt).getTime() <= nowMs) ||
              (r.reservationStatus === "PENDING_PAYMENT" &&
                ((r.paymentExpiresAt && new Date(r.paymentExpiresAt).getTime() <= nowMs) ||
                  (r.createdAt && new Date(r.createdAt).getTime() + 60 * 60 * 1000 <= nowMs))))
        );

      case "rejected":
        return base.filter((r) => isReservationRejected(r));

      case "cancelled":
        return base.filter((r) => isReservationCancelled(r));

      default:
        return base;
    }
  }
}

export function isStaffExpiredReservation(
  res: StaffOperationalReservation,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (
    res.reservationStatus === "COMPLETED" ||
    res.checkInState === "CHECKED_OUT" ||
    Boolean(res.checkedOutAt) ||
    (res.status && res.status.toLowerCase().includes("completed")) ||
    (res.status && res.status.toLowerCase().includes("checked out"))
  ) {
    return false;
  }

  if (
    res.reservationStatus === "EXPIRED" ||
    res.reservationStatus === "REJECTED" ||
    res.reservationStatus === "CANCELLED" ||
    (res.status && res.status.toLowerCase() === "rejected") ||
    (res.paymentStatus && res.paymentStatus.toLowerCase().includes("rejected")) ||
    (res.paymentAttemptStatus && res.paymentAttemptStatus.toLowerCase() === "rejected")
  ) {
    return true;
  }

  if (
    res.bookingEndAt &&
    !res.checkedInAt &&
    res.checkInState === "NOT_CHECKED_IN" &&
    (res.reservationStatus as string) !== "COMPLETED"
  ) {
    const endMs = new Date(res.bookingEndAt).getTime();
    if (!isNaN(endMs) && endMs <= nowMs) {
      return true;
    }
  }

  return false;
}

export function isStaffCompletedReservation(
  res: StaffOperationalReservation
): boolean {
  return (
    res.reservationStatus === "COMPLETED" ||
    res.checkInState === "CHECKED_OUT" ||
    Boolean(res.checkedOutAt)
  );
}

export function isStaffOperationsReservation(
  res: StaffOperationalReservation,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  // Never show expired in Active Operations
  if (isStaffExpiredReservation(res, nowMs)) {
    return false;
  }

  // Never show completed in Active Operations
  if (isStaffCompletedReservation(res)) {
    return false;
  }

  // Explicitly checked-in
  if (
    res.reservationStatus === "CHECKED_IN" ||
    res.checkInState === "CHECKED_IN" ||
    (Boolean(res.checkedInAt) && !res.checkedOutAt)
  ) {
    return true;
  }

  // In active time window
  if (res.reservationStatus === "CONFIRMED" && res.bookingStartAt && res.bookingEndAt) {
    if (isTimeWithinWindow(res.bookingStartAt, res.bookingEndAt, nowMs)) {
      return true;
    }
  }

  return false;
}

export function isStaffBookingManagementReservation(
  res: StaffOperationalReservation,
  now: Date | number = new Date()
): boolean {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (isStaffExpiredReservation(res, nowMs)) {
    return false;
  }

  if (isStaffCompletedReservation(res)) {
    return false;
  }

  if (isStaffOperationsReservation(res, nowMs)) {
    return false;
  }

  if (res.reservationStatus === "PENDING_COUNTER_CONFIRMATION") {
    return true;
  }

  if (
    res.reservationStatus === "PENDING_PAYMENT" ||
    res.reservationStatus === "PAYMENT_UNDER_REVIEW" ||
    res.reservationStatus === "NEEDS_MANUAL_RESOLUTION"
  ) {
    return true;
  }

  if (res.reservationStatus === "CONFIRMED") {
    if (!res.bookingStartAt) return true;
    const startMs = new Date(res.bookingStartAt).getTime();
    if (isNaN(startMs) || startMs > nowMs) {
      return true;
    }
  }

  return true;
}

export function filterStaffReservationsByTab(
  reservations: StaffOperationalReservation[],
  tab: ReservationTabType,
  subFilter: StaffReservationsSubFilter | StaffOperationsSubFilter | StaffCompletedSubFilter | StaffExpiredSubFilter = "all",
  now: Date | number = new Date()
): StaffOperationalReservation[] {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  if (tab === "reservations") {
    const base = reservations.filter((r) => isStaffBookingManagementReservation(r, nowMs));
    const sf = subFilter as StaffReservationsSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "upcoming":
      case "confirmed":
        return base.filter((r) => {
          if (r.reservationStatus === "CONFIRMED") {
            if (!r.bookingStartAt) return true;
            const startMs = new Date(r.bookingStartAt).getTime();
            return isNaN(startMs) || startMs > nowMs;
          }
          return false;
        });

      case "counter_queue":
        return base.filter((r) => r.reservationStatus === "PENDING_COUNTER_CONFIRMATION");

      case "closure_impacted":
        return reservations.filter(
          (r) =>
            r.isClosureImpacted === true ||
            (Boolean(r.closureImpactStatus) && r.closureImpactStatus !== "CUSTOMER_RESOLVED" && r.closureImpactStatus !== "STAFF_RESOLVED")
        );

      case "cancelled":
        return reservations.filter((r) => isReservationCancelled(r));

      default:
        return base;
    }
  } else if (tab === "operations") {
    // Operations Tab — live active / checked in only
    const base = reservations.filter((r) => isStaffOperationsReservation(r, nowMs));
    const sf = subFilter as StaffOperationsSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "active":
        return base.filter((r) => {
          if (r.reservationStatus === "CHECKED_IN" || r.checkInState === "CHECKED_IN") {
            return true;
          }
          if (r.reservationStatus === "CONFIRMED" && r.bookingStartAt && r.bookingEndAt) {
            return isTimeWithinWindow(r.bookingStartAt, r.bookingEndAt, nowMs);
          }
          return false;
        });

      case "checked_in":
        return base.filter(
          (r) =>
            r.checkInState !== "CHECKED_OUT" &&
            (r.reservationStatus === "CHECKED_IN" || r.checkInState === "CHECKED_IN")
        );

      default:
        return base;
    }
  } else if (tab === "completed") {
    // Completed Tab
    const base = reservations.filter((r) => isStaffCompletedReservation(r));
    return base;
  } else {
    // Expired Tab
    const base = reservations.filter((r) => isStaffExpiredReservation(r, nowMs));
    const sf = subFilter as StaffExpiredSubFilter;

    switch (sf) {
      case "all":
        return base;

      case "expired":
        return base.filter(
          (r) =>
            !isReservationCancelled(r) &&
            !isReservationRejected(r) &&
            (r.reservationStatus === "EXPIRED" ||
              (r.status && r.status.toLowerCase() === "expired") ||
              (r.bookingEndAt &&
                !r.checkedInAt &&
                new Date(r.bookingEndAt).getTime() <= nowMs))
        );

      case "rejected":
        return base.filter((r) => isReservationRejected(r));

      case "cancelled":
        return base.filter((r) => isReservationCancelled(r));

      default:
        return base;
    }
  }
}

export function getAdminReservationTabCounts(
  reservations: AdminReservationSummary[],
  now: Date | number = new Date()
): { reservationsBadgeCount: number; operationsBadgeCount: number; completedBadgeCount: number; expiredBadgeCount: number } {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  let reservationsBadgeCount = 0;
  let operationsBadgeCount = 0;
  let completedBadgeCount = 0;
  let expiredBadgeCount = 0;

  for (const r of reservations) {
    if (isAdminCompletedReservation(r)) {
      completedBadgeCount++;
      continue;
    }

    if (isAdminExpiredReservation(r, nowMs)) {
      expiredBadgeCount++;
      continue;
    }

    // Operations badge count: live active + checked in
    const isCheckedIn =
      !r.checkedOutAt &&
      r.reservationStatus !== "COMPLETED" &&
      (r.reservationStatus === "CHECKED_IN" || (Boolean(r.checkedInAt) && !r.checkedOutAt));

    const isActiveInSession =
      r.reservationStatus === "CONFIRMED" &&
      r.startAt &&
      r.endAt &&
      isTimeWithinWindow(r.startAt, r.endAt, nowMs);

    if (isCheckedIn || isActiveInSession) {
      operationsBadgeCount++;
    }

    // Reservations badge count: pending + awaiting payment + payment under review + upcoming confirmed + counter queue
    const isPendingOrReview =
      ["PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "PENDING_COUNTER_CONFIRMATION", "NEEDS_MANUAL_RESOLUTION"].includes(
        r.reservationStatus
      ) &&
      r.reservationStatus !== "EXPIRED" &&
      r.status.toLowerCase() !== "rejected";

    const isUpcomingConfirmed =
      r.reservationStatus === "CONFIRMED" &&
      (!r.startAt || new Date(r.startAt).getTime() > nowMs);

    if (isPendingOrReview || isUpcomingConfirmed) {
      reservationsBadgeCount++;
    }
  }

  return { reservationsBadgeCount, operationsBadgeCount, completedBadgeCount, expiredBadgeCount };
}

export function getStaffReservationTabCounts(
  reservations: StaffOperationalReservation[],
  now: Date | number = new Date()
): { reservationsBadgeCount: number; operationsBadgeCount: number; completedBadgeCount: number; expiredBadgeCount: number } {
  const nowMs = typeof now === "number" ? now : (now instanceof Date ? now.getTime() : new Date(now).getTime());

  let reservationsBadgeCount = 0;
  let operationsBadgeCount = 0;
  let completedBadgeCount = 0;
  let expiredBadgeCount = 0;

  for (const r of reservations) {
    if (isStaffCompletedReservation(r)) {
      completedBadgeCount++;
      continue;
    }

    if (isStaffExpiredReservation(r, nowMs)) {
      expiredBadgeCount++;
      continue;
    }

    const isCheckedIn =
      r.checkInState !== "CHECKED_OUT" &&
      r.reservationStatus !== "COMPLETED" &&
      (r.reservationStatus === "CHECKED_IN" || r.checkInState === "CHECKED_IN");

    const isActiveInSession =
      r.reservationStatus === "CONFIRMED" &&
      r.bookingStartAt &&
      r.bookingEndAt &&
      isTimeWithinWindow(r.bookingStartAt, r.bookingEndAt, nowMs);

    if (isCheckedIn || isActiveInSession) {
      operationsBadgeCount++;
    }

    const isPendingOrQueue =
      ["PENDING_COUNTER_CONFIRMATION", "PENDING_PAYMENT", "PAYMENT_UNDER_REVIEW", "NEEDS_MANUAL_RESOLUTION"].includes(
        r.reservationStatus
      ) &&
      r.reservationStatus !== "EXPIRED" &&
      r.reservationStatus !== "REJECTED" &&
      !(r.status && r.status.toLowerCase() === "rejected") &&
      !(r.paymentStatus && r.paymentStatus.toLowerCase().includes("rejected")) &&
      !(r.paymentAttemptStatus && r.paymentAttemptStatus.toLowerCase() === "rejected");

    const isUpcomingConfirmed =
      r.reservationStatus === "CONFIRMED" &&
      (!r.bookingStartAt || new Date(r.bookingStartAt).getTime() > nowMs);

    if (isPendingOrQueue || isUpcomingConfirmed) {
      reservationsBadgeCount++;
    }
  }

  return { reservationsBadgeCount, operationsBadgeCount, completedBadgeCount, expiredBadgeCount };
}
