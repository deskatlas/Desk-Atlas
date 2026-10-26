"use client";

// MS83-R03 / PRD-F14 / DSD-UI6: the reservation calendar and time cards are shared.
import { useCallback, useEffect, useState } from 'react';
import { zonedDateTimeToUtc, type AvailableTimeSlot, type GuestReservationTrackingResult, type PublishedFloorMap } from '@deskatlas/domain';
import { mapPublishedFloorToWorkspaceCards, type WorkspaceMapViewModel } from '@/features/workspace-discovery';
import { ScheduleCalendarStep } from '@/features/reservation/components/ScheduleCalendarStep';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/app/components/ui/dialog';

interface CustomerRescheduleModalProps {
  trackingData: GuestReservationTrackingResult;
  customerEmail?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}
interface ScheduleChoice { date: string; startTime: string; durationHours: number }

export function CustomerRescheduleModal({ trackingData, customerEmail, onClose, onSuccess }: CustomerRescheduleModalProps) {
  const [workspace, setWorkspace] = useState<WorkspaceMapViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ScheduleChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [maxDays, setMaxDays] = useState(30);
  const assignment = trackingData.finalAssignment;
  const durationMs = assignment ? Date.parse(assignment.bookingEndAt) - Date.parse(assignment.bookingStartAt) : 0;
  const timezone = 'Asia/Manila';

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    Promise.all([
      fetch('/api/published-map?includeAllFloors=true').then(async response => {
        if (!response.ok) throw new Error('Unable to load your booked workspace. Please retry.');
        return response.json() as Promise<{ published: PublishedFloorMap; allFloors?: PublishedFloorMap[] }>;
      }),
      fetch('/api/settings').then(response => response.json() as Promise<{ maxAdvanceBookingDays?: number; rescheduleMaxAdvanceValue?: number; rescheduleMaxAdvanceUnit?: string }>),
    ]).then(([maps, settings]) => {
      if (!active) return;
      const cards = (maps.allFloors || [maps.published]).flatMap(mapPublishedFloorToWorkspaceCards);
      const booked = cards.find(value => value.workspaceInstanceId === assignment?.workspaceInstanceId);
      if (!booked) throw new Error('Your booked workspace is unavailable on the published map. Contact support for rescheduling.');
      setWorkspace(booked);
      const limit = settings.rescheduleMaxAdvanceValue || 30;
      setMaxDays(Math.min(settings.maxAdvanceBookingDays || 90, Math.ceil(limit / (settings.rescheduleMaxAdvanceUnit === 'HOURS' ? 24 : 1))));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the schedule.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assignment?.workspaceInstanceId]);

  function interval(choice: ScheduleChoice) {
    const start = zonedDateTimeToUtc(choice.date, choice.startTime, timezone);
    return { startAt: start.toISOString(), endAt: new Date(start.getTime() + durationMs).toISOString() };
  }

  // The verified ordinary-reschedule endpoint excludes this reservation's own
  // assignment, so overlapping replacement times are not falsely marked occupied.
  const loadTimeSlots = useCallback(async (date: string): Promise<AvailableTimeSlot[]> => {
    const response = await fetch('/api/track/reschedule-availability', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceCode: trackingData.referenceCode, customerEmail, date, workspaceInstanceId: assignment?.workspaceInstanceId }) });
    const result = await response.json() as { slots?: Array<{ startTime: string; endTime: string; isAvailable: boolean }>; error?: string };
    if (!response.ok) throw new Error(result.error || 'Unable to load available start times.');
    return (result.slots || []).map(slot => ({ ...slot, blockingReason: slot.isAvailable ? null : 'RESERVATION_CONFLICT' }));
  }, [trackingData.referenceCode, customerEmail, assignment?.workspaceInstanceId]);

  async function reviewSchedule(choice: ScheduleChoice) {
    if (submitting || verifying || !assignment) return;
    setVerifying(true); setError(null); setReview(null);
    try {
      const response = await fetch('/api/track/reschedule-availability', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceCode: trackingData.referenceCode, customerEmail, date: choice.date,
          ...interval(choice), workspaceInstanceId: assignment.workspaceInstanceId }) });
      const result = await response.json() as { isAvailable?: boolean; reason?: string; error?: string; available?: boolean };
      if (!response.ok || !(result.isAvailable ?? result.available)) throw new Error(result.error || result.reason || 'This time is no longer available. Select another start time.');
      setReview(choice);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to verify availability.'); }
    finally { setVerifying(false); }
  }

  async function confirm() {
    if (!review || submitting || !assignment) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch('/api/track/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceCode: trackingData.referenceCode, customerEmail, ...interval(review), workspaceInstanceId: assignment.workspaceInstanceId }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to reschedule. Refresh tracking before trying again.');
      onSuccess(result.message || 'Reservation rescheduled successfully.');
    } catch (reason) { setReview(null); setError(reason instanceof Error ? reason.message : 'Refresh tracking to verify the outcome before another action.'); }
    finally { setSubmitting(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !submitting && !verifying) onClose(); }}>
    <DialogContent data-modal="customer-reschedule-modal" data-testid="customer-reschedule-modal"
      className="w-[calc(100%-2rem)] min-w-0 max-w-6xl sm:max-w-6xl max-h-[90vh] overflow-x-hidden overflow-y-auto rounded-[24px] bg-white p-6">
      <DialogHeader><DialogTitle>Reschedule Reservation</DialogTitle><DialogDescription>
        Reference: {trackingData.referenceCode}. Choose a date and an available start time. Your booked desk, duration and paid amount stay the same.
      </DialogDescription></DialogHeader>
      <p className="text-xs text-[var(--da-text-secondary)]">Ordinary rescheduling is allowed once, at least {trackingData.rescheduleCutoffHours ?? 12} hours before the original start. The server checks these rules again before confirmation.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loading ? <p role="status">Loading your workspace and reservation calendar...</p> : !assignment || durationMs <= 0 ? <p role="alert">The original booking interval is unavailable. Contact support.</p> : workspace && !review ? (
        <ScheduleCalendarStep workspace={workspace} reschedule={{ durationHours: durationMs / 3600000, busy: verifying, backLabel: 'Cancel reschedule' }}
          loadTimeSlots={loadTimeSlots} maxAdvanceBookingDays={maxDays} onBackToMap={onClose} onContinue={choice => { void reviewSchedule(choice); }} />
      ) : review ? <>
        <p className="text-sm font-bold">{workspace?.displayName}: {review.date}, {review.startTime} ({timezone}), {durationMs / 3600000} hours.</p>
        <p className="text-sm">End: {new Date(interval(review).endAt).toLocaleString('en-PH', { timeZone: timezone })}. Already paid.</p>
        <button className="da-secondary-button" disabled={submitting} onClick={() => setReview(null)}>Change date or time</button>
        <button className="da-primary-button" disabled={submitting} onClick={confirm}>{submitting ? 'Rescheduling...' : 'Confirm Reschedule'}</button>
      </> : null}
    </DialogContent>
  </Dialog>;
}
