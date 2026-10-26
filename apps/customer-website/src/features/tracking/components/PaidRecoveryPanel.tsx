"use client";

// MS83-R01/R03/R04/R06, PRD-F14, DSD-UI6. Selection never holds inventory.
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MAP_CANVAS_WIDTH, DEFAULT_MAP_CANVAS_HEIGHT, DEFAULT_MAP_GRID_SIZE,
  DEFAULT_WORKSPACE_STATUS_COLORS, normalizeWorkspaceStatusColors, clampMapZoom, zonedDateTimeToUtc,
  type PaidRecoveryContext, type PublishedFloorMap, type AvailableInstanceSummary,
} from '@deskatlas/domain';
import type { PaidRecoveryCommand } from '@deskatlas/validation';
import { usePublishedMap, mapPublishedFloorToWorkspaceCards, type WorkspaceMapViewModel } from '@/features/workspace-discovery';
import { fetchTemplateAvailability } from '@/app/lib/availabilityApi';
import { ReservationMap } from '@/features/reservation/components/ReservationMap';
import { ScheduleCalendarStep } from '@/features/reservation/components/ScheduleCalendarStep';
import { SpotDetailModal } from '@/features/reservation/components/SpotDetailModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/app/components/ui/dialog';
import { getRecoveryDeskSelection } from '../utils/recoveryDeskSelection';

interface Props {
  referenceCode: string;
  customerEmail: string;
  onRefresh: () => void;
}
async function recoveryRequest(input: { referenceCode: string; customerEmail: string } | PaidRecoveryCommand) {
  const response = await fetch('/api/track/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json() as { context?: PaidRecoveryContext | null; error?: string };
  if (!response.ok) throw new Error(body.error || 'Recovery unavailable. Refresh tracking.');
  return body.context ?? null;
}
function localParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find(value => value.type === name)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

export function PaidRecoveryPanel({ referenceCode, customerEmail, onRefresh }: Props) {
  const [context, setContext] = useState<PaidRecoveryContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'RESCHEDULE' | 'REPOSITION' | 'REFUND' | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [scheduleReviewed, setScheduleReviewed] = useState(false);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(90);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [selected, setSelected] = useState<WorkspaceMapViewModel | null>(null);
  const [details, setDetails] = useState<WorkspaceMapViewModel | null>(null);
  const [available, setAvailable] = useState<AvailableInstanceSummary[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const map = usePublishedMap();
  const [zoom, setZoom] = useState(1);
  const [statusColors, setStatusColors] = useState(DEFAULT_WORKSPACE_STATUS_COLORS);
  const mapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const identity = { referenceCode, customerEmail };

  useEffect(() => {
    let active = true;
    fetch('/api/settings').then(async response => {
      if (!response.ok) return;
      const settings: { statusColors?: unknown; maxAdvanceBookingDays?: number; rescheduleMaxAdvanceValue?: number; rescheduleMaxAdvanceUnit?: string } = await response.json();
      if (active) {
        if (settings.statusColors) setStatusColors(normalizeWorkspaceStatusColors(settings.statusColors));
        const rescheduleDays = settings.rescheduleMaxAdvanceValue
          ? settings.rescheduleMaxAdvanceValue / (settings.rescheduleMaxAdvanceUnit === 'HOURS' ? 24 : 1) : 30;
        setMaxAdvanceDays(Math.min(settings.maxAdvanceBookingDays || 90, Math.ceil(rescheduleDays)));
      }
    }).catch(() => { /* The reservation map uses the same default palette when settings are unavailable. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setContext(null);
    if (!customerEmail.trim()) { setLoading(false); return; }
    recoveryRequest({ referenceCode, customerEmail }).then(value => {
      if (!active) return;
      setContext(value);
      if (value?.startAt) { const original = localParts(value.startAt, value.timezone); setDate(original.date); setTime(original.time); }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Recovery unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [referenceCode, customerEmail]);

  const duration = context?.startAt && context.endAt ? Date.parse(context.endAt) - Date.parse(context.startAt) : 0;
  const original = context?.startAt ? localParts(context.startAt, context.timezone) : null;
  const targetDate = mode === 'REPOSITION' ? original?.date : date;
  const targetTime = mode === 'REPOSITION' ? original?.time : time;
  const replacementEnd = (() => {
    if (!context || !targetDate || !targetTime) return null;
    try {
      return new Date(zonedDateTimeToUtc(targetDate, targetTime, context.timezone).getTime() + duration)
        .toLocaleString('en-PH', { timeZone: context.timezone });
    } catch { return null; }
  })();
  useEffect(() => {
    let active = true;
    setAvailable([]);
    setAvailabilityLoading(false);
    if (!context?.eligible || !context.templateId || !targetDate || !targetTime || mode !== 'REPOSITION') return;
    setSelected(null); setAvailabilityLoading(true); setError(null);
    fetchTemplateAvailability({ templateId: context.templateId, date: targetDate, startTime: targetTime, durationMinutes: duration / 60000 })
      .then(result => { if (active) setAvailable(result.availableInstances); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Availability unavailable.'); })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [context, mode, targetDate, targetTime, duration, reload]);

  const deskSelection = (id: string) => getRecoveryDeskSelection({
    workspace: map.published?.elements.find(element => element.workspace?.workspaceInstanceId === id)?.workspace,
    templateId: context?.templateId, mode,
    originalSlotAvailable: !availabilityLoading && available.some(value => value.workspaceInstanceId === id && value.isAvailable),
  });
  const selectable = (id: string) => deskSelection(id).selectable;
  // Availability is for the proposed interval, not the map's current occupancy.
  const published: PublishedFloorMap | null = map.published ? {
    ...map.published, elements: map.published.elements.map(element => !element.workspace ? element : {
      ...element, workspace: { ...element.workspace, isBookable: selectable(element.workspace.workspaceInstanceId) },
    }),
  } : null;
  const workspaces = published ? mapPublishedFloorToWorkspaceCards(published) : [];
  const canReposition = Boolean(context?.startAt && Date.parse(context.startAt) > Date.now());

  async function confirm() {
    if (!context || !mode || busy || uncertain) return;
    if ((mode !== 'REFUND' && !selected) || (mode === 'RESCHEDULE' && !scheduleReviewed)) return;
    setBusy(true); setError(null);
    let command: PaidRecoveryCommand;
    try {
      const base = { ...identity, episodeId: context.episodeId };
      command = mode === 'REFUND' ? { ...base, remedy: mode } : mode === 'REPOSITION'
        ? { ...base, remedy: mode, workspaceInstanceId: selected!.workspaceInstanceId }
        : { ...base, remedy: mode, workspaceInstanceId: selected!.workspaceInstanceId,
          startAt: zonedDateTimeToUtc(date, time, context.timezone).toISOString() };
      const result = await recoveryRequest(command);
      setContext(result); setMode(null); onRefresh();
    } catch (reason) {
      // No blind replay after any ambiguous response. Require a successful authoritative read.
      setUncertain(true); setSelected(null); setScheduleReviewed(false); setReload(value => value + 1);
      setError(reason instanceof Error ? reason.message : 'Refresh tracking before trying again.');
      try {
        const latest = await recoveryRequest(identity);
        setContext(latest); setUncertain(false);
        if (!latest?.eligible) { setMode(null); onRefresh(); }
      } catch { setError('The outcome is unknown. Refresh tracking to verify the booking before another action.'); }
    } finally { setBusy(false); }
  }

  function openRemedy(nextMode: 'RESCHEDULE' | 'REPOSITION' | 'REFUND') {
    setSelected(null); setDetails(null); setScheduleReviewed(false); setError(null); setMode(nextMode);
  }

  function selectDesk(workspace: WorkspaceMapViewModel) {
    if (busy || uncertain) return;
    const choice = deskSelection(workspace.workspaceInstanceId);
    if (!choice.selectable) return;
    setSelected(workspace); setDetails(null); setScheduleReviewed(false);
    if (choice.needsAnotherTime) {
      setMode('RESCHEDULE');
    }
    setError(null);
  }

  if (loading) return <p role="status">Checking paid booking recovery...</p>;
  if (!context) return <p role="status" className="mt-4 text-sm text-[var(--da-text-secondary)]">{error || 'Enter your registered email and check status to verify recovery access. If recovery is unavailable, contact support.'}</p>;
  if (context.refundPending) return <p role="status" className="mt-4 text-sm font-semibold">Booking cancelled. Your payment is awaiting administrator refund processing. The refund has not yet been recorded as paid.</p>;
  if (!context.eligible) return <p className="mt-4 text-sm">Recovery is unavailable for this booking. Refresh tracking for its current status or contact support.</p>;
  return <section className="mt-6 rounded-[24px] border border-[var(--da-border)] bg-white p-6">
    <h2 className="text-lg font-extrabold text-[var(--da-brand-dark)]">Payment received, assignment pending</h2>
    <p className="mt-2 text-sm">We received your payment, but none of your selected desks were available. Choose a new desk or time, or request a refund.</p>
    <p className="mt-2 text-sm">Original template: {context.templateName}. Duration: {duration / 3600000} hours.</p>
    <p className="text-sm">{context.startAt && new Date(context.startAt).toLocaleString('en-PH', { timeZone: context.timezone })} to {context.endAt && new Date(context.endAt).toLocaleString('en-PH', { timeZone: context.timezone })} ({context.timezone})</p>
    <p className="mt-2 text-xs text-[var(--da-text-secondary)]">Availability can change until confirmation. Selecting a desk does not hold it. Your paid amount and ordinary reschedule allowance are preserved.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!canReposition && <p className="mt-3 text-sm">Your original start time has passed. Choose a future slot or request a refund.</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="da-primary-button" disabled={busy || uncertain} onClick={() => openRemedy(canReposition ? 'REPOSITION' : 'RESCHEDULE')}>Choose a new desk or time</button>
      <button className="da-secondary-button" disabled={busy || uncertain} onClick={() => openRemedy('REFUND')}>Request a refund</button>
    </div>
    <p className="mt-2 text-xs text-[var(--da-text-secondary)]">Keep your original time or pick another available slot. Your workspace type, booked duration and payment stay the same.</p>
    <Dialog open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] min-w-0 max-w-6xl sm:max-w-6xl max-h-[90vh] overflow-x-hidden overflow-y-auto rounded-[24px] bg-white p-6">
        <DialogHeader><DialogTitle>{mode === 'REFUND' ? 'Cancel and request a refund' : 'Choose a new desk or time'}</DialogTitle>
          <DialogDescription>{mode === 'REFUND' ? 'This cancels your booking and requests administrator refund processing. It does not send money or mark the refund completed.' : `${context.templateName}, ${duration / 3600000} hours. Review a replacement desk, then confirm. No additional payment.`}</DialogDescription>
        </DialogHeader>
        {mode !== 'REFUND' && <>
          <fieldset className="rounded-[18px] border border-[var(--da-border)] bg-[var(--da-canvas)] p-4">
            <legend className="px-1 text-sm font-bold text-[var(--da-brand-dark)]">When would you like to visit?</legend>
            <div className="flex flex-wrap gap-3" role="group" aria-label="Booking time">
              <button type="button" aria-pressed={mode === 'REPOSITION'}
                className={mode === 'REPOSITION' ? 'da-primary-button' : 'da-secondary-button'}
                disabled={!canReposition || busy || uncertain} onClick={() => { if (mode !== 'REPOSITION') openRemedy('REPOSITION'); }}>Keep my original time</button>
              <button type="button" aria-pressed={mode === 'RESCHEDULE'}
                className={mode === 'RESCHEDULE' ? 'da-primary-button' : 'da-secondary-button'}
                disabled={busy || uncertain} onClick={() => { if (mode !== 'RESCHEDULE') openRemedy('RESCHEDULE'); }}>Choose another date or time</button>
            </div>
            {!canReposition && <p className="mt-2 text-xs text-[var(--da-text-secondary)]">Your original start time has passed. Please choose a future date and time.</p>}
            <p className="mt-2 text-xs text-[var(--da-text-secondary)]">Select a desk on the map, review your booking details, then confirm. No additional payment is needed.</p>
          </fieldset>
          {mode === 'RESCHEDULE' && selected && !scheduleReviewed && (
            <div className="min-w-0 grid gap-3">
            <p className="text-sm text-[var(--da-text-secondary)]">You can keep this desk. Choose from the available times below.</p>
            <ScheduleCalendarStep key={selected.workspaceInstanceId} workspace={selected}
              reschedule={{ durationHours: duration / 3600000, initialDate: date, busy }}
              maxAdvanceBookingDays={maxAdvanceDays}
              onBackToMap={() => { setSelected(null); setScheduleReviewed(false); }}
              onContinue={schedule => { setDate(schedule.date); setTime(schedule.startTime); setScheduleReviewed(true); }} />
            </div>
          )}
          {(mode === 'REPOSITION' || scheduleReviewed) && <>
          <p className="text-sm">{targetDate} {targetTime} to {replacementEnd || 'select a valid time'} ({context.timezone}), duration locked to {duration / 3600000} hours.</p>
          {mode === 'REPOSITION' && <p role="status" className="text-sm">{availabilityLoading ? 'Checking available times...' : `${available.length} desks available for your original time. You can also select the same desk and choose a different time.`}</p>}
          </>}
          {(mode === 'REPOSITION' || !selected) && <>
          {mode === 'RESCHEDULE' && <p className="text-sm">Choose a desk from your original template, then select a date and an available time on the reservation calendar.</p>}
          {map.error && <p role="alert">{map.error}<button className="da-inline-button" onClick={map.refetch}>Retry map</button></p>}
          <ReservationMap floors={map.floors} floorId={map.floorId} handleFloorChange={id => { map.setFloorId(id); setSelected(null); }}
            mapLoading={map.loading} published={published} elements={published?.elements || []}
            statusColors={statusColors} zoom={zoom} handleZoomOut={() => setZoom(value => clampMapZoom(value - .15))}
            handleZoomIn={() => setZoom(value => clampMapZoom(value + .15))} handleFitView={() => setZoom(1)}
            mapContainerRef={mapRef} canvasRef={canvasRef} canvasDimensions={{ width: published?.version.canvasWidth || DEFAULT_MAP_CANVAS_WIDTH, height: published?.version.canvasHeight || DEFAULT_MAP_CANVAS_HEIGHT, gridSize: published?.version.gridSize || DEFAULT_MAP_GRID_SIZE }}
            selectedWorkspaceId={selected?.workspaceInstanceId || null} activeRank={0} workspaces={workspaces}
            handleSpotClick={workspace => { if (busy || uncertain) return; setDetails(workspace); }} isSelectable={selectable} />
          <label className="text-sm">Desks of your workspace type on this floor<select className="da-input" disabled={busy || uncertain} value={selected?.workspaceInstanceId || ''} onChange={event => setDetails(workspaces.find(value => value.workspaceInstanceId === event.target.value) || null)}>
            <option value="">Review a desk</option>{workspaces.filter(value => selectable(value.workspaceInstanceId)).map(value => <option key={value.workspaceInstanceId} value={value.workspaceInstanceId}>{value.displayName}</option>)}
          </select></label>
          </>}
          <SpotDetailModal paidRecovery workspace={details} open={Boolean(details)} onOpenChange={open => { if (!open) setDetails(null); }} onProceed={selectDesk} />
          {selected && (mode === 'REPOSITION' || scheduleReviewed) && <p className="text-sm font-bold">Selected: {selected.displayName}. {targetDate} {targetTime}, {duration / 3600000} hours.</p>}
        </>}
        {mode === 'RESCHEDULE' && scheduleReviewed && <button className="da-secondary-button" disabled={busy} onClick={() => setScheduleReviewed(false)}>Change date or time</button>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {(mode !== 'RESCHEDULE' || scheduleReviewed) && <button className="da-primary-button" disabled={busy || uncertain || (mode !== 'REFUND' && (!selected || availabilityLoading))} onClick={confirm}>{busy ? 'Verifying booking...' : mode === 'REFUND' ? 'Confirm cancellation and refund request' : 'Confirm my new booking details'}</button>}
      </DialogContent>
    </Dialog>
  </section>;
}
