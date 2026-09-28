export interface BookingEndAlert {
  reservationId: string;
  referenceCode: string;
  customerName: string;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  spotName: string;
  spotCode?: string;
  endAt: string;
  endTime?: string;
  startAt?: string | null;
  minutesRemaining: number;
  urgency?: 'critical' | 'warning' | 'info';
}

export interface ActiveBookingCandidate {
  id?: string;
  reservationId?: string;
  referenceCode?: string;
  status?: string;
  operationalStatus?: string;
  reservationStatus?: string;
  customerName?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  spotName?: string | null;
  spotCode?: string | null;
  workspaceName?: string | null;
  assignedCandidate?: {
    workspaceName?: string | null;
    startAt?: string | null;
    endAt?: string | null;
  } | null;
  candidates?: Array<{
    workspaceName?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    isAssigned?: boolean;
  }> | null;
  endAt?: string | null;
  startAt?: string | null;
  bookingEndAt?: string | null;
  bookingStartAt?: string | null;
  schedule?: {
    startAt?: string | null;
    endAt?: string | null;
  } | null;
}

/**
 * Resolves the primary end time for an active booking.
 */
export function resolveBookingEndTime(booking: ActiveBookingCandidate): string | null {
  if (booking.endAt) return booking.endAt;
  if (booking.bookingEndAt) return booking.bookingEndAt;
  if (booking.schedule?.endAt) return booking.schedule.endAt;
  if (booking.assignedCandidate?.endAt) return booking.assignedCandidate.endAt;
  if (Array.isArray(booking.candidates) && booking.candidates.length > 0) {
    const assigned = booking.candidates.find((c) => c.isAssigned);
    if (assigned?.endAt) return assigned.endAt;
    if (booking.candidates[0]?.endAt) return booking.candidates[0].endAt;
  }
  return null;
}

/**
 * Resolves the primary start time for an active booking.
 */
export function resolveBookingStartTime(booking: ActiveBookingCandidate): string | null {
  if (booking.startAt) return booking.startAt;
  if (booking.bookingStartAt) return booking.bookingStartAt;
  if (booking.schedule?.startAt) return booking.schedule.startAt;
  if (booking.assignedCandidate?.startAt) return booking.assignedCandidate.startAt;
  if (Array.isArray(booking.candidates) && booking.candidates.length > 0) {
    const assigned = booking.candidates.find((c) => c.isAssigned);
    if (assigned?.startAt) return assigned.startAt;
    if (booking.candidates[0]?.startAt) return booking.candidates[0].startAt;
  }
  return null;
}

/**
 * Resolves the workspace/spot name for an active booking.
 */
export function resolveBookingSpotName(booking: ActiveBookingCandidate): string {
  if (booking.spotCode && booking.spotCode.trim()) return booking.spotCode.trim();
  if (booking.spotName && booking.spotName.trim()) return booking.spotName.trim();
  if (booking.workspaceName && booking.workspaceName.trim()) return booking.workspaceName.trim();
  if (booking.assignedCandidate?.workspaceName && booking.assignedCandidate.workspaceName.trim()) {
    return booking.assignedCandidate.workspaceName.trim();
  }
  if (Array.isArray(booking.candidates) && booking.candidates.length > 0) {
    const assigned = booking.candidates.find((c) => c.isAssigned);
    if (assigned?.workspaceName && assigned.workspaceName.trim()) return assigned.workspaceName.trim();
    if (booking.candidates[0]?.workspaceName && booking.candidates[0].workspaceName.trim()) {
      return booking.candidates[0].workspaceName.trim();
    }
  }
  return 'Unassigned Spot';
}

/**
 * Resolves the full customer name.
 */
export function resolveBookingCustomerName(booking: ActiveBookingCandidate): string {
  if (booking.customerName && booking.customerName.trim()) return booking.customerName.trim();
  const first = booking.customerFirstName || '';
  const last = booking.customerLastName || '';
  const full = `${first} ${last}`.trim();
  return full || 'Guest Customer';
}

export type NearCheckoutAlert = BookingEndAlert;

/**
 * Checks if a time diff is within the near checkout threshold (0 < minutesRemaining <= threshold).
 */
export function isNearCheckout(
  target: number | string | Date,
  thresholdMinutes: number,
  now: Date | number = new Date()
): boolean {
  if (typeof target === 'number' && target <= 10000 && !Number.isNaN(target)) {
    return target > 0 && target <= thresholdMinutes;
  }

  const endMs = target instanceof Date ? target.getTime() : typeof target === 'number' ? target : new Date(target).getTime();
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();

  if (Number.isNaN(endMs) || Number.isNaN(nowMs)) {
    return false;
  }

  const diffMs = endMs - nowMs;
  const minutesRemaining = diffMs / (60 * 1000);

  return minutesRemaining > 0 && minutesRemaining <= thresholdMinutes;
}

/**
 * Evaluates active checked-in bookings against the given alert threshold minutes.
 * Returns alerts for bookings where 0 < minutesRemaining <= alertMinutes, sorted earliest to end first.
 */
export function evaluateApproachingBookingEnds(
  activeBookings: ActiveBookingCandidate[],
  alertMinutes: number,
  now: Date | number = new Date()
): BookingEndAlert[] {
  if (!Array.isArray(activeBookings) || activeBookings.length === 0) {
    return [];
  }

  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();
  const threshold = typeof alertMinutes === 'number' && alertMinutes >= 1 ? alertMinutes : 15;
  const alerts: BookingEndAlert[] = [];

  for (const booking of activeBookings) {
    // Only evaluate checked-in bookings
    const isCheckedIn =
      booking.status === 'CHECKED_IN' ||
      (booking as any).reservationStatus === 'CHECKED_IN' ||
      booking.operationalStatus === 'ACTIVE' ||
      booking.status === 'ACTIVE' ||
      booking.status === 'Checked In' ||
      ((booking as any).checkedInAt &&
        !(booking as any).checkedOutAt &&
        (booking as any).reservationStatus !== 'CANCELLED' &&
        (booking as any).reservationStatus !== 'REJECTED' &&
        (booking as any).reservationStatus !== 'COMPLETED' &&
        (booking as any).reservationStatus !== 'EXPIRED');

    if (!isCheckedIn) {
      continue;
    }

    const endAtStr = resolveBookingEndTime(booking);
    if (!endAtStr) {
      continue;
    }

    const endMs = new Date(endAtStr).getTime();
    if (isNaN(endMs)) {
      continue;
    }

    const diffMs = endMs - nowMs;
    const minutesRemaining = diffMs / (60 * 1000);

    // Alert fires when booking is approaching end (strictly remaining time > 0 and <= threshold)
    if (minutesRemaining > 0 && minutesRemaining <= threshold) {
      const reservationId = booking.reservationId || booking.id || '';
      const referenceCode = booking.referenceCode || '';
      const customerName = resolveBookingCustomerName(booking);
      const spotName = resolveBookingSpotName(booking);
      const startAt = resolveBookingStartTime(booking);

      const roundedMinutes = Math.round(minutesRemaining * 10) / 10;
      const urgency: 'critical' | 'warning' = roundedMinutes <= 5 ? 'critical' : 'warning';

      alerts.push({
        reservationId,
        referenceCode,
        customerName,
        customerFirstName: booking.customerFirstName ?? null,
        customerLastName: booking.customerLastName ?? null,
        customerEmail: booking.customerEmail ?? null,
        customerPhone: booking.customerPhone ?? null,
        spotName,
        spotCode: booking.spotCode || spotName,
        endAt: endAtStr,
        endTime: endAtStr,
        startAt,
        minutesRemaining: roundedMinutes,
        urgency,
      });
    }
  }

  return alerts.sort((a, b) => a.minutesRemaining - b.minutesRemaining);
}

/**
 * Generates dismissal key for deduplication.
 */
export function makeEndAlertDismissKey(
  reservationId: string,
  threshold?: number | string
): string {
  return threshold !== undefined ? `${reservationId}:${threshold}` : reservationId;
}

/**
 * Checks if a booking end alert is dismissed in the given storage/set.
 */
export function isEndAlertDismissed(
  dismissedKeys: string[] | Set<string>,
  reservationId: string,
  threshold?: number | string
): boolean {
  if (!dismissedKeys || !reservationId) return false;
  const key = makeEndAlertDismissKey(reservationId, threshold);
  if (dismissedKeys instanceof Set) {
    return dismissedKeys.has(key) || dismissedKeys.has(reservationId);
  }
  return dismissedKeys.includes(key) || dismissedKeys.includes(reservationId);
}
