'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AssistantAnswerText } from '@deskatlas/ui';
import { customerActionSchema, customerDiscoveryContextSchema, publicCustomerResponseSchema,
  type CustomerDiscoveryContext, type PublicCustomerResponse } from '@deskatlas/validation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/app/components/ui/sheet';
import { useRewardsSession } from '../tracking/context/RewardsSessionContext';
import { VerifiedBookingActions, VerifiedReservationControls } from './VerifiedReservationControls';
import { DiscoveryPreferences } from './DiscoveryPreferences';

type SpotAction = Required<Extract<PublicCustomerResponse['actions'][number], { id?: 'VIEW_SPOT' }>>;
interface AssistantContext {
  setDiscovery: (context: CustomerDiscoveryContext) => void;
  askSpot: (context: CustomerDiscoveryContext) => void;
  compareSpot: (context: CustomerDiscoveryContext) => void;
  handoff: SpotAction | null; consumeHandoff: () => void;
}
const Context = createContext<AssistantContext | null>(null);
const emptyDiscovery: CustomerDiscoveryContext = {};
export function useCustomerAssistant() { return useContext(Context); }

// MS77-TC03/04/13: only explicitly projected discovery fields enter memory.
export function CustomerAssistantProvider({ children }: { children: ReactNode }) {
  const { session } = useRewardsSession();
  const token = session?.purpose === 'REWARDS_AND_ASSISTANT_ACCESS' ? session.accessToken : undefined;
  const owner = session?.accessToken ?? 'public';
  const [open, setOpen] = useState(false);
  const [discovery, setContext] = useState<{ owner: string; value: CustomerDiscoveryContext } | null>(null);
  const [reservation, setReservation] = useState<{ owner: string; id: string } | null>(null);
  const [handoff, setHandoff] = useState<SpotAction | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const enabled = process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED === 'true';
  const setDiscovery = (value: CustomerDiscoveryContext) => {
    const parsed = customerDiscoveryContextSchema.safeParse(value);
    if (parsed.success) setContext(previous => {
      const saved = previous?.owner === owner ? previous.value : emptyDiscovery;
      return { owner, value: { ...parsed.data, date: parsed.data.date ?? saved.date, start_time: parsed.data.start_time ?? saved.start_time,
        duration_minutes: parsed.data.duration_minutes ?? saved.duration_minutes, preferences: parsed.data.preferences ?? saved.preferences,
        compared_ids: parsed.data.compared_ids ?? saved.compared_ids } };
    });
  };
  const begin = () => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true); };
  const changeOpen = (next: boolean) => {
    if (next) { begin(); return; }
    setOpen(false); setContext(null); setReservation(null);
  };
  useEffect(() => { setReservation(null); }, [pathname]);
  useEffect(() => {
    const ask = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (!value || typeof value !== 'object' || !('reservationId' in value) || typeof value.reservationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.reservationId)) return;
      setContext(null); setReservation({ owner, id: value.reservationId }); begin();
    };
    const clear = () => { setOpen(false); setContext(null); setReservation(null); setHandoff(null); };
    window.addEventListener('deskatlas:assistant:reservation', ask);
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('deskatlas:assistant:reservation', ask); window.removeEventListener('pagehide', clear); };
  }, [owner]);
  return <Context.Provider value={{ setDiscovery, askSpot: value => { setDiscovery({ ...value, compared_ids: [] }); setReservation(null); begin(); },
    compareSpot: value => {
      const parsed = customerDiscoveryContextSchema.safeParse(value);
      if (!parsed.success || !parsed.data.workspace_id) return;
      setContext(previous => {
        const current = previous?.owner === owner ? previous.value : {};
        const compared_ids = [...new Set([...(current.compared_ids ?? []), parsed.data.workspace_id!])];
        if (compared_ids.length > 3) return previous;
        return { owner, value: { date: current.date, start_time: current.start_time, duration_minutes: current.duration_minutes,
          preferences: current.preferences, compared_ids } };
      });
      setReservation(null); begin();
    }, handoff, consumeHandoff: () => setHandoff(null) }}>
    {children}
    {enabled && <Sheet modal={false} open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild><button ref={trigger} type="button" className="da-primary-button fixed bottom-6 right-6 z-40" aria-label="Ask DeskAtlas">Ask DeskAtlas</button></SheetTrigger>
      <SheetContent className="customer-assistant-panel bg-[var(--da-canvas)] text-[var(--da-text-primary)]" onInteractOutside={event => event.preventDefault()} onCloseAutoFocus={event => {
        event.preventDefault(); const target = returnFocus.current; (target?.isConnected ? target : trigger.current)?.focus();
      }}>
        <SheetHeader className="shrink-0 border-b border-[var(--da-border)] pr-12"><SheetTitle>Ask DeskAtlas</SheetTitle><SheetDescription>Ask about spaces, prices and booking policies. No verification needed.</SheetDescription></SheetHeader>
        {open && <Conversation key={owner} token={token} discovery={discovery?.owner === owner ? discovery.value : emptyDiscovery}
          initialReservation={reservation?.owner === owner ? reservation.id : undefined}
          onDiscovery={value => { const parsed = customerDiscoveryContextSchema.safeParse(value); if (parsed.success) setContext({ owner, value: parsed.data }); }} onViewSpot={action => { setHandoff(action); changeOpen(false); router.push('/reserve'); }} />}
      </SheetContent>
    </Sheet>}
  </Context.Provider>;
}

function Conversation({ token, discovery, initialReservation, onDiscovery, onViewSpot }: {
  token?: string; discovery: CustomerDiscoveryContext; initialReservation?: string;
  onDiscovery: (context: CustomerDiscoveryContext) => void; onViewSpot: (action: SpotAction) => void;
}) {
  const { clearSession } = useRewardsSession();
  const [selected, setSelected] = useState(initialReservation);
  const [reservationFilter, setReservationFilter] = useState<'UPCOMING' | 'HISTORY'>('UPCOMING');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<{ question: string; answer: PublicCustomerResponse }[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const generation = useRef(crypto.randomUUID());
  const sessionId = useRef(crypto.randomUUID());
  const active = useRef<{ identity: { request_id: string; session_id: string; generation: string }; abort: AbortController } | null>(null);
  const sourceAbort = useRef<AbortController | null>(null);
  const verification = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(true);
  const contextKey = JSON.stringify(discovery) + (selected ?? '') + reservationFilter;
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const ready = useRef<Promise<void> | null>(null);
  const cancel = () => {
    const request = active.current; active.current = null; generation.current = crypto.randomUUID();
    sourceAbort.current?.abort(); sourceAbort.current = null;
    if (request) { request.abort.abort(); void fetch('/api/customer-assistant/cancel', { method: 'POST', cache: 'no-store', keepalive: true,
      headers: requestHeaders, body: JSON.stringify(request.identity) }).catch(() => {}); }
  };
  useEffect(() => {
    mounted.current = true;
    const boot = new AbortController();
    ready.current = fetch('/api/customer-assistant/session', { method: 'POST', cache: 'no-store', signal: boot.signal, headers: requestHeaders, body: '{}' }).then(result => {
      if (!mounted.current || boot.signal.aborted) return;
      if (result.status === 401 || result.status === 403) {
        if (token) clearSession();
        throw new Error(token ? 'Access expired. Continue with public help or verify for private reservations.' : 'Unable to start guest help. Please reopen the chat and retry.');
      }
      if (!result.ok) throw new Error('Assistance is temporarily unavailable.');
    });
    void ready.current.catch(error => { if (mounted.current && !boot.signal.aborted) setNotice(error.message); });
    return () => { mounted.current = false; boot.abort(); cancel(); };
  }, []);
  useEffect(() => { cancel(); setPendingQuestion(''); setExcerpt(null); setBusy(false); }, [contextKey]);
  useEffect(() => { setTurns([]); }, [selected, reservationFilter]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [turns, pendingQuestion, notice]);
  useEffect(() => { setSelected(initialReservation); }, [initialReservation]);

  async function ask(question: string) {
    if (busy || !question.trim()) return;
    setBusy(true); setPendingQuestion(question); setMessage(''); setNotice('Checking...'); setExcerpt(null);
    const key = contextKey, gen = generation.current;
    const identity = { request_id: crypto.randomUUID(), session_id: sessionId.current, generation: gen };
    const abort = new AbortController(); active.current = { identity, abort };
    let progress: ReturnType<typeof setInterval> | undefined;
    try {
      if (token) await ready.current;
      else await ready.current?.catch(() => {});
      // Renew guest identity after idle expiry before starting any query work.
      if (!token) {
        const session = await fetch('/api/customer-assistant/session', { method: 'POST', cache: 'no-store', signal: abort.signal, headers: requestHeaders, body: '{}' });
        if (!session.ok) throw new Error('Unable to start guest help. Please reopen the chat and retry.');
      }
      if (!mounted.current || abort.signal.aborted || key !== currentContext.current) return;
      progress = setInterval(() => {
        void fetch('/api/customer-assistant/progress', { method: 'POST', cache: 'no-store', signal: abort.signal,
          headers: requestHeaders, body: JSON.stringify(identity) }).then(async r => {
          if (!mounted.current || abort.signal.aborted || generation.current !== gen) return;
          if (r.status === 401 || r.status === 403) { clearSession(); return; }
          if (r.ok) { const state = await r.json(); if (mounted.current && !abort.signal.aborted && generation.current === gen) setNotice(({ checking: 'Checking...', retrieving: 'Finding approved information...', preparing: 'Preparing answer...' } as Record<string, string>)[state.stage] ?? 'Checking...'); }
        }).catch(() => {});
      }, 3000);
      const result = await fetch('/api/customer-assistant/query', { method: 'POST', cache: 'no-store', signal: abort.signal, headers: requestHeaders,
        body: JSON.stringify({ ...identity, message: question, user_turns: turns.slice(-4).map(t => t.question),
          ...(Object.keys(discovery).length ? { discovery } : {}), ...(selected ? { selected_reservation_id: selected } : {}),
          ...(token ? { reservation_filter: reservationFilter } : {}),
          ...(turns.at(-1) ? { knowledge_epoch: turns.at(-1)!.answer.knowledge_epoch } : {}) }) });
      if (!mounted.current || abort.signal.aborted || generation.current !== gen || key !== currentContext.current) return;
      if (result.status === 401 || result.status === 403) {
        if (token) clearSession();
        throw new Error(token ? 'Access expired. Continue with public help or verify for private reservations.' : 'Guest session expired. Please reopen the chat and retry.');
      }
      if (!result.ok) {
        const retrySeconds = Number(result.headers.get('Retry-After'));
        throw new Error(result.status === 429 ? `The assistant has reached its request limit. ${retrySeconds > 0 ? `Please try again in ${Math.ceil(retrySeconds / 60)} minute(s).` : 'Please try again shortly.'}` : 'Assistance is temporarily unavailable. Please retry.');
      }
      const answer = publicCustomerResponseSchema.parse(await result.json());
      if (!mounted.current || abort.signal.aborted || generation.current !== gen || key !== currentContext.current) return;
      setTurns(previous => [...previous, { question, answer }]); setPendingQuestion(''); setNotice('Answer ready.');
    } catch (error) { if (mounted.current && !abort.signal.aborted && generation.current === gen) setNotice(error instanceof Error ? error.message : 'Unable to answer.'); }
    finally { if (progress) clearInterval(progress); if (active.current?.identity.request_id === identity.request_id) active.current = null;
      if (mounted.current && generation.current === gen) setBusy(false); }
  }
  async function source(citation: PublicCustomerResponse['citations'][number]) {
    sourceAbort.current?.abort(); const abort = new AbortController(); sourceAbort.current = abort;
    const gen = generation.current;
    try {
      const result = await fetch('/api/customer-assistant/source', { method: 'POST', cache: 'no-store', signal: abort.signal, headers: requestHeaders,
        body: JSON.stringify({ version_id: citation.version_id, chunk_id: citation.chunk_id }) });
      if (!mounted.current || abort.signal.aborted || gen !== generation.current) return;
      if (result.status === 401 || result.status === 403) { clearSession(); return; }
      if (!result.ok) throw new Error('This source is no longer available.');
      const body = await result.json(); if (mounted.current && !abort.signal.aborted && gen === generation.current && typeof body.excerpt === 'string') setExcerpt(body.excerpt);
    } catch { if (mounted.current && !abort.signal.aborted) setNotice('This source is no longer available.'); }
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
    <div className="customer-assistant-scroll min-h-0 flex-1 overflow-y-auto space-y-4">
    {!turns.length && <div className="space-y-3 rounded-2xl border border-[var(--da-border)] bg-white p-4 text-sm">
      <p className="font-bold">How can I help?</p>
      <p className="text-[var(--da-text-secondary)]">Explore spaces or ask a general question right away. Verify only when you want to view your own reservations.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{['Help me choose a spot', 'Explain the booking process', 'Which spot suits focused work?', 'What is a Customer ID?'].map(prompt =>
        <button key={prompt} type="button" disabled={busy} className="da-secondary-button text-left" onClick={() => void ask(prompt)}>{prompt}</button>)}</div>
    </div>}
    <div className="space-y-4" role="log" aria-label="Conversation">
      {turns.map((turn, index) => <div key={index} className="space-y-3">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[var(--da-primary)] px-4 py-3 text-sm text-white"><p className="sr-only">You</p><p className="whitespace-pre-wrap">{turn.question}</p></div>
        <article className="mr-auto max-w-[95%] rounded-2xl border border-[var(--da-border)] bg-white p-4 space-y-3">
        <p className="text-xs font-bold text-[var(--da-text-secondary)]">DeskAtlas</p><AssistantAnswerText text={turn.answer.summary} />
        {turn.answer.suggestions.map(spot => <div key={spot.workspace_id} className="rounded-xl border border-[var(--da-border)] p-3 text-sm">
          <p className="font-bold">{spot.name}</p><p>Capacity: {spot.capacity}. {spot.availability === 'AVAILABLE' ? 'Available when checked' : 'Availability not checked'}.</p>
          {spot.quote && <p>Base total for your duration: PHP {spot.quote.amount.toFixed(2)}</p>}
          {spot.reasons.map(reason => <p key={reason.dimension}>{reason.dimension}: {reason.quote}</p>)}
          {spot.catalog_reasons?.map(reason => <p key={reason.dimension}>Published map: {reason.tag} (matches your {reason.dimension === 'focus' ? 'focused work' : 'power access'} preference)</p>)}
          <p className="text-xs text-[var(--da-text-secondary)]">Checked {new Date(spot.as_of).toLocaleString()}</p>
        </div>)}
        <div className="flex flex-wrap gap-2">{turn.answer.actions.map((candidate, i) => {
          const action = customerActionSchema.parse(candidate);
          return action.id === 'VIEW_SPOT' ? <button key={i} type="button" className="da-secondary-button text-xs" onClick={() => onViewSpot({ id: 'VIEW_SPOT', workspace_id: action.workspace_id!, floor_id: action.floor_id!, map_version_id: action.map_version_id! })}>View spot</button>
            : process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_VERIFIED_ENABLED === 'true' ? <button key={i} type="button" className="da-secondary-button text-xs" onClick={() => {
              if (verification.current) { verification.current.open = true; verification.current.querySelector('button')?.focus(); }
            }}>Verify Customer ID and email</button> : <p key={i} className="text-xs">Private reservation assistance is not enabled yet. You can continue public help or use Manage Booking.</p>;
        })}</div>
        {turn.answer.booking_context && <VerifiedBookingActions actions={turn.answer.booking_context.actions} reference={turn.answer.booking_context.reservation.reference}
          navigate={path => { window.location.assign(path); }} />}
        {turn.answer.policy_excerpts?.length ? <div className="text-sm whitespace-pre-wrap"><p className="font-bold">Approved policy guidance</p>{turn.answer.policy_excerpts.map((policy, i) => <p key={i}>{policy.quote}</p>)}</div> : null}
        {turn.answer.citations.length > 0 && <details><summary className="text-xs font-bold">Sources ({turn.answer.citations.length})</summary><div className="mt-2 flex flex-wrap gap-2">{turn.answer.citations.map(citation => <button key={citation.chunk_id} type="button" className="da-secondary-button text-xs" onClick={() => void source(citation)}>{citation.title}</button>)}</div></details>}
        {turn.answer.limitations.map(line => <p key={line} className="text-xs text-[var(--da-text-secondary)]">{line}</p>)}
      </article></div>)}
      {pendingQuestion && <div className="space-y-3"><div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-[var(--da-primary)] px-4 py-3 text-sm text-white"><p className="sr-only">You</p><p className="whitespace-pre-wrap">{pendingQuestion}</p></div><div className="mr-auto max-w-[95%] rounded-2xl border border-[var(--da-border)] bg-white px-4 py-3 text-sm">{busy ? 'DeskAtlas is typing...' : notice}{!busy && <button type="button" className="da-secondary-button ml-2 text-xs" onClick={() => void ask(pendingQuestion)}>Retry</button>}</div></div>}
      {excerpt && <div className="whitespace-pre-wrap rounded-xl border border-[var(--da-border)] bg-white p-3 text-sm"><p className="font-bold">Approved source excerpt</p>{excerpt}</div>}
      <div ref={bottom} />
    </div>
    <DiscoveryPreferences value={discovery} onSave={onDiscovery} />
    {process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_VERIFIED_ENABLED === 'true' && <details ref={verification} className="rounded-xl border border-[var(--da-border)] bg-white p-3"><summary className="text-sm font-bold">My reservations (verification required)</summary>
      {selected && <button type="button" className="da-secondary-button mt-3" onClick={() => setSelected(undefined)}>Return to general help</button>}
      <VerifiedReservationControls selectedId={selected} onSelect={setSelected} onFilter={setReservationFilter} onAsk={q => void ask(q)} /></details>}
    <p className="text-xs text-[var(--da-text-secondary)]">Suggestions do not hold a spot. Availability is checked again when booking.</p>
    </div>
    <p role="status" aria-live="polite" className="shrink-0 text-xs text-[var(--da-text-secondary)]">{notice}</p>
    <form className="flex shrink-0 items-end gap-2 border-t border-[var(--da-border)] pt-3" onSubmit={event => { event.preventDefault(); void ask(message); }}>
      <label className="sr-only" htmlFor="customer-assistant-question">Ask DeskAtlas</label>
      <textarea id="customer-assistant-question" className="da-input min-w-0 flex-1 resize-none" rows={2} placeholder="Ask a question..." maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(message); } }} />
      {busy ? <button type="button" className="da-secondary-button" onClick={() => { cancel(); setBusy(false); setNotice('Cancelled.'); }}>Cancel</button>
        : <button type="submit" className="da-primary-button" disabled={!message.trim()}>Send</button>}
    </form>
  </div>;
}
