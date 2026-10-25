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
import { SpotDetailModal } from '@/features/reservation/components/SpotDetailModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/app/components/ui/dialog';

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
      const settings: { statusColors?: unknown } = await response.json();
      if (active && settings.statusColors) setStatusColors(normalizeWorkspaceStatusColors(settings.statusColors));
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
    setSelected(null); setAvailable([]);
    if (!context?.eligible || !context.templateId || !targetDate || !targetTime || !mode || mode === 'REFUND') return;
    setAvailabilityLoading(true); setError(null);
    fetchTemplateAvailability({ templateId: context.templateId, date: targetDate, startTime: targetTime, durationMinutes: duration / 60000 })
      .then(result => { if (active) setAvailable(result.availableInstances); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Availability unavailable.'); })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [context, mode, targetDate, targetTime, duration, reload]);

  const selectable = (id: string) => !availabilityLoading && available.some(value => value.workspaceInstanceId === id && value.isAvailable);
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
    if (mode !== 'REFUND' && !selected) return;
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
      setUncertain(true); setSelected(null); setReload(value => value + 1);
      setError(reason instanceof Error ? reason.message : 'Refresh tracking before trying again.');
      try {
        const latest = await recoveryRequest(identity);
        setContext(latest); setUncertain(false);
        if (!latest?.eligible) { setMode(null); onRefresh(); }
      } catch { setError('The outcome is unknown. Refresh tracking to verify the booking before another action.'); }
    } finally { setBusy(false); }
  }

  if (loading) return <p role="status">Checking paid booking recovery...</p>;
  if (!context) return <p role="status" className="mt-4 text-sm text-[var(--da-text-secondary)]">{error || 'Enter your registered email and check status to verify recovery access. If recovery is unavailable, contact support.'}</p>;
  if (context.refundPending) return <p role="status" className="mt-4 text-sm font-semibold">Booking cancelled. Your payment is awaiting administrator refund processing. The refund has not yet been recorded as paid.</p>;
  if (!context.eligible) return <p className="mt-4 text-sm">Recovery is unavailable for this booking. Refresh tracking for its current status or contact support.</p>;
  return <section className="mt-6 rounded-[24px] border border-[var(--da-border)] bg-white p-6">
    <h2 className="text-lg font-extrabold text-[var(--da-brand-dark)]">Payment received, assignment pending</h2>
    <p className="mt-2 text-sm">All approved choices were unavailable. Keep your paid reservation and choose a remedy below.</p>
    <p className="mt-2 text-sm">Original template: {context.templateName}. Duration: {duration / 3600000} hours.</p>
    <p className="text-sm">{context.startAt && new Date(context.startAt).toLocaleString('en-PH', { timeZone: context.timezone })} to {context.endAt && new Date(context.endAt).toLocaleString('en-PH', { timeZone: context.timezone })} ({context.timezone})</p>
    <p className="mt-2 text-xs text-[var(--da-text-secondary)]">Availability can change until confirmation. Selecting a desk does not hold it. Your paid amount and ordinary reschedule allowance are preserved.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!canReposition && <p className="mt-3 text-sm">The original interval has started. Choose Reschedule or Refund.</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="da-primary-button" disabled={busy || uncertain} onClick={() => setMode('RESCHEDULE')}>Reschedule</button>
      <button className="da-secondary-button" disabled={!canReposition || busy || uncertain} onClick={() => setMode('REPOSITION')}>Reposition</button>
      <button className="da-secondary-button" disabled={busy || uncertain} onClick={() => setMode('REFUND')}>Refund</button>
    </div>
    <Dialog open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] min-w-0 max-w-6xl sm:max-w-6xl max-h-[90vh] overflow-x-hidden overflow-y-auto rounded-[24px] bg-white p-6">
        <DialogHeader><DialogTitle>{mode === 'REFUND' ? 'Cancel and request a refund' : mode === 'REPOSITION' ? 'Reposition on the reservation map' : 'Reschedule your paid booking'}</DialogTitle>
          <DialogDescription>{mode === 'REFUND' ? 'This cancels your booking and requests administrator refund processing. It does not send money or mark the refund completed.' : `${context.templateName}, ${duration / 3600000} hours. Review a replacement desk, then confirm. No additional payment.`}</DialogDescription>
        </DialogHeader>
        {mode !== 'REFUND' && <>
          {mode === 'RESCHEDULE' && <div className="flex flex-wrap gap-4">
            <label className="text-sm">Date<input type="date" className="da-input" value={date} onChange={event => setDate(event.target.value)} /></label>
            <label className="text-sm">Start time ({context.timezone})<input type="time" className="da-input" value={time} onChange={event => setTime(event.target.value)} /></label>
          </div>}
          <p className="text-sm">{targetDate} {targetTime} to {replacementEnd || 'select a valid time'} ({context.timezone}), duration locked to {duration / 3600000} hours.</p>
          <p role="status" className="text-sm">{availabilityLoading ? 'Checking interval availability...' : `${available.length} eligible desks. ${!available.length ? 'Choose Reschedule or Refund if no desks are available.' : ''}`}</p>
          {map.error && <p role="alert">{map.error}<button className="da-inline-button" onClick={map.refetch}>Retry map</button></p>}
          <ReservationMap floors={map.floors} floorId={map.floorId} handleFloorChange={id => { map.setFloorId(id); setSelected(null); }}
            mapLoading={map.loading} published={published} elements={published?.elements || []}
            statusColors={statusColors} zoom={zoom} handleZoomOut={() => setZoom(value => clampMapZoom(value - .15))}
            handleZoomIn={() => setZoom(value => clampMapZoom(value + .15))} handleFitView={() => setZoom(1)}
            mapContainerRef={mapRef} canvasRef={canvasRef} canvasDimensions={{ width: published?.version.canvasWidth || DEFAULT_MAP_CANVAS_WIDTH, height: published?.version.canvasHeight || DEFAULT_MAP_CANVAS_HEIGHT, gridSize: published?.version.gridSize || DEFAULT_MAP_GRID_SIZE }}
            selectedWorkspaceId={selected?.workspaceInstanceId || null} activeRank={0} workspaces={workspaces}
            handleSpotClick={workspace => setDetails(workspace)} isSelectable={selectable} />
          <label className="text-sm">Available desks on this floor<select className="da-input" value={selected?.workspaceInstanceId || ''} onChange={event => setDetails(workspaces.find(value => value.workspaceInstanceId === event.target.value) || null)}>
            <option value="">Review a desk</option>{workspaces.filter(value => selectable(value.workspaceInstanceId)).map(value => <option key={value.workspaceInstanceId} value={value.workspaceInstanceId}>{value.displayName}</option>)}
          </select></label>
          <SpotDetailModal paidRecovery workspace={details} open={Boolean(details)} onOpenChange={open => { if (!open) setDetails(null); }} onProceed={workspace => { if (selectable(workspace.workspaceInstanceId)) setSelected(workspace); setDetails(null); }} />
          {selected && <p className="text-sm font-bold">Selected: {selected.displayName}. {targetDate} {targetTime}, {duration / 3600000} hours.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="da-primary-button" disabled={busy || uncertain || (mode !== 'REFUND' && (!selected || availabilityLoading))} onClick={confirm}>{busy ? 'Verifying booking...' : mode === 'REFUND' ? 'Confirm cancellation and refund request' : 'Confirm replacement'}</button>
      </DialogContent>
    </Dialog>
  </section>;
}
