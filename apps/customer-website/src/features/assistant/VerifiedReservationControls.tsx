'use client';

// MS78-R04 / DSD-UI13/UI16: reuse the established identity form and booking workflow.
import { useEffect, useRef, useState } from 'react';
import type { CustomerReservationChoice } from '@deskatlas/domain';
import { customerAssistanceActionSchema, type CustomerAssistanceAction } from '@deskatlas/validation';
import { RewardsAccessCard } from '../tracking/components/RewardsAccessCard';
import { useRewardsSession } from '../tracking/context/RewardsSessionContext';

export function customerBookingActionDestination(action: unknown, reference: string): string | null {
  if (!customerAssistanceActionSchema.safeParse(action).success || !reference || reference.length > 100) return null;
  // All actions enter the existing screen and its independent verification/confirmation.
  return `/track/${encodeURIComponent(reference)}`;
}

export function VerifiedReservationControls({ selectedId, onSelect, onAsk, onFilter }: {
  selectedId?: string; onSelect: (id: string | undefined) => void; onAsk?: (message: string) => void;
  onFilter?: (filter: 'UPCOMING' | 'HISTORY') => void;
}) {
  const { session, clearSession } = useRewardsSession();
  const [verify, setVerify] = useState(false);
  const enabled = session?.purpose === 'REWARDS_AND_ASSISTANT_ACCESS' && Date.parse(session.expiresAt) > Date.now();
  if (!enabled) return <div className="space-y-3 pt-3">
    <p className="text-xs text-[var(--da-text-secondary)]">Verify Customer ID and email to ask about your own reservations.</p>
    {verify ? <RewardsAccessCard compact accessIntent="REWARDS_AND_ASSISTANT" onSuccess={() => setVerify(false)} /> :
      <button type="button" className="da-secondary-button" onClick={() => setVerify(true)}>Verify Customer ID and email</button>}
  </div>;
  return <div className="space-y-3 pt-3">
    <OwnedBookingSelector key={session.accessToken} token={session.accessToken} expiresAt={session.expiresAt}
      selectedId={selectedId} onSelect={onSelect} onExpired={clearSession} onFilter={onFilter} />
    {selectedId && onAsk && <div className="flex flex-wrap gap-2">
      {['What is happening with this reservation?', 'Explain my payment status', 'Can I cancel or reschedule?', 'What can I do next?'].map(prompt =>
        <button key={prompt} type="button" className="da-secondary-button text-xs" onClick={() => onAsk(prompt)}>{prompt}</button>)}
    </div>}
  </div>;
}

function OwnedBookingSelector({ token, expiresAt, selectedId, onSelect, onExpired, onFilter }: {
  token: string; expiresAt: string; selectedId?: string;
  onSelect: (id: string | undefined) => void; onExpired: () => void;
  onFilter?: (filter: 'UPCOMING' | 'HISTORY') => void;
}) {
  const [filter, setFilter] = useState<'UPCOMING' | 'HISTORY'>('UPCOMING');
  const [page, setPage] = useState<{ items: CustomerReservationChoice[]; next_cursor: string | null }>({ items: [], next_cursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  async function load(next?: string) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/customer-assistant/reservations', {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filter, ...(next ? { cursor: next } : {}) }),
      });
      if (generation.current !== current || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { onExpired(); return; }
      if (!response.ok) throw new Error('Reservation assistance is temporarily unavailable.');
      const body = await response.json();
      if (generation.current !== current || controller.signal.aborted || Date.parse(expiresAt) <= Date.now()) return;
      setPage(body.data);
    } catch (e) {
      if (!controller.signal.aborted && generation.current === current) setError(e instanceof Error ? e.message : 'Unable to load reservations.');
    } finally { if (generation.current === current) setLoading(false); }
  }
  useEffect(() => {
    setPage({ items: [], next_cursor: null }); void load();
    return () => { generation.current++; pending.current?.abort(); };
  }, [filter]);
  return <div className="grid gap-3">
    <label className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]">Your reservations
      <select className="da-input" value={filter} onChange={event => { const next = event.target.value as 'UPCOMING' | 'HISTORY'; onSelect(undefined); setFilter(next); onFilter?.(next); }}>
        <option value="UPCOMING">Upcoming and active</option><option value="HISTORY">All bookings and history</option>
      </select>
    </label>
    {loading && <p role="status">Loading reservations...</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && page.items.map(item => <button type="button" key={item.id} className="da-secondary-button text-xs"
      aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
      {item.reference} · {item.status} · {item.workspace ?? 'Workspace not assigned'}
      {item.start_at && <span>{new Date(item.start_at).toISOString()} - {item.end_at ? new Date(item.end_at).toISOString() : 'End unavailable'}</span>}
    </button>)}
    {!loading && !error && page.items.length === 0 && <p className="text-xs">No matching reservations.</p>}
    {page.next_cursor && <button type="button" disabled={loading} className="da-secondary-button" onClick={() => void load(page.next_cursor ?? undefined)}>Next reservations</button>}
  </div>;
}

export function VerifiedBookingActions({ actions, reference, navigate }: {
  actions: CustomerAssistanceAction[]; reference: string; navigate: (path: string) => void;
}) {
  const labels: Record<CustomerAssistanceAction, string> = {
    VIEW_RESERVATION: 'View reservation', REVIEW_CANCELLATION: 'Review cancellation',
    REVIEW_RESCHEDULE: 'Review reschedule', REVIEW_RELOCATION: 'Review relocation',
    VIEW_CHECKIN_INSTRUCTIONS: 'View check-in instructions',
  };
  return <div className="flex flex-wrap gap-2">{actions.map(action => {
    const destination = customerBookingActionDestination(action, reference);
    return destination ? <button type="button" key={action} className="da-secondary-button text-xs" onClick={() => navigate(destination)}>{labels[action]}</button> : null;
  })}</div>;
}
