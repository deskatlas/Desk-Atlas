// MS78-R03, PRD-F8, QAD-TC38: shared tracking and assistance predicates.
import type { GuestReservationTrackingRecord } from './guestReservationTrackingRepository';
import type { GuestReservationTrackingStatus } from '../models/reservation';

export function evaluateCustomerManagementEligibility(
  record: GuestReservationTrackingRecord,
  status: GuestReservationTrackingStatus,
  cutoffHours: number,
  cancellationCutoffHours: number,
  nowMs: number,
) {
  const rescheduleCount = record.rescheduleCount ?? 0;
  const isClosurePending = Boolean(record.isClosureImpacted &&
    (record.closureImpactStatus === 'AFFECTED_PENDING_ACTION' || record.closureImpactStatus === 'MANUAL_RESOLUTION_REQUIRED'));
  const start = record.finalAssignment?.bookingStartAt ? Date.parse(record.finalAssignment.bookingStartAt) : 0;
  const end = record.finalAssignment?.bookingEndAt ? Date.parse(record.finalAssignment.bookingEndAt) : 0;
  const canReschedule = status === 'CONFIRMED' && (isClosurePending ||
    (rescheduleCount === 0 && start > 0 && nowMs <= start - cutoffHours * 3600000));
  const canCancel = status === 'CONFIRMED' && !record.checkedInAt && !record.checkedOutAt &&
    start > nowMs && nowMs <= start - cancellationCutoffHours * 3600000;
  const isInSession = status === 'CONFIRMED' && start > 0 && end > 0 && nowMs >= start && nowMs < end;
  return {
    rescheduleCount, canReschedule, canCancel, isInSession,
    rescheduleReason: canReschedule ? 'ELIGIBLE_FOR_REVIEW' : status !== 'CONFIRMED' ? 'STATUS_NOT_CONFIRMED'
      : rescheduleCount > 0 ? 'RESCHEDULE_USED' : !start ? 'NO_SCHEDULE' : 'CUTOFF_PASSED',
    canRelocate: isInSession || isClosurePending,
    remainingMinutes: isInSession ? Math.max(0, Math.round((end - nowMs) / 60000)) : 0,
  };
}
