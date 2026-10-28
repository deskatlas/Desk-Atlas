'use client';
import { MessageCircle } from 'lucide-react';
import { assistantAvailabilitySchema } from '@deskatlas/validation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantPanel, Button, type AssistantMessage } from '@deskatlas/ui';
import { assistantAnswerSchema, assistantSourceSchema, type AssistantAnswer, type AssistantSource } from '@deskatlas/domain';

// MS60-TC21/30: development-only fixed lifecycle reasons, never chat content.
function lifecycle(reason: 'close' | 'identity' | 'auth' | 'availability-transient' | 'query-complete' | 'query-gap') {
  if (process.env.NODE_ENV === 'development') window.dispatchEvent(new CustomEvent('deskatlas:assistant-lifecycle', { detail: { reason } }));
}

// SPEC-4 SDD-C20/DSD-UI16: this component is keyed by identity, token and route.
export function AssistantLauncher({ token, onReauthenticate }: { token?: string; onReauthenticate?: () => void }) {
  const [enabled, setEnabled] = useState(false), [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]), [value, setValue] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [source, setSource] = useState<AssistantSource>(), [epoch, setEpoch] = useState<number>();
  const [sourceError, setSourceError] = useState('');
  const session = useRef(''), generation = useRef(0), pending = useRef<{ controller: AbortController; id: string } | null>(null);
  const identity = useRef(''), catalogEpoch = useRef<number>(undefined), mounted = useRef(false);
  const availabilityRequest = useRef<{ controller: AbortController; promise: Promise<boolean> } | null>(null);
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('STAFF'), [blocked, setBlocked] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null), opening = useRef(false);
  const sourceController = useRef<AbortController | null>(null), last = useRef(''), selections = useRef<AssistantAnswer['selections']>(undefined);
  // MS-44 / DSD-UI16: ephemeral numeric measurements for a local benchmark listener.
  // No question, answer, credential or source is dispatched or persisted.
  const renderTiming = useRef<{ request_id: string; generation: number; start: number; dispatch: number; received: number; parsed: number; gateway_ms?: number } | null>(null);
  useEffect(() => {
    const measurement = renderTiming.current;
    if (!measurement) return;
    const frame = requestAnimationFrame(() => {
      renderTiming.current = null;
      if (measurement.generation !== generation.current) return;
      window.dispatchEvent(new CustomEvent('deskatlas:assistant-timing', { detail: {
        request_id: measurement.request_id,
        complete_ms: performance.now() - measurement.start,
        dispatch_delay_ms: measurement.dispatch - measurement.start,
        transport_ms: measurement.received - measurement.dispatch,
        parse_validate_ms: measurement.parsed - measurement.received,
        render_ms: performance.now() - measurement.parsed,
        gateway_ms: measurement.gateway_ms,
      } }));
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json', 'X-DeskAtlas-Answer-Contract': 'ms59-v1',
    'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
    ...(process.env.NODE_ENV === 'development' ? { 'X-DeskAtlas-Diagnostics': 'ms60-v1' } : {}),
  }), [token]);
  const cancel = useCallback(() => {
    generation.current++;
    renderTiming.current = null;
    sourceController.current?.abort(); sourceController.current = null;
    const request = pending.current;
    if (request) {
      request.controller.abort(); pending.current = null;
      void fetch('/api/assistant/cancel', { method: 'POST', headers: headers(), body: JSON.stringify({ session_id: session.current, request_id: request.id }), keepalive: true }).catch(() => undefined);
    }
  }, [headers]);
  const close = useCallback(() => {
    lifecycle('close');
    cancel(); setOpen(false); setMessages([]); setValue(''); setSource(undefined); setEpoch(undefined);
    setError(''); setSourceError(''); setBusy(false); setStatus(''); session.current = ''; last.current = ''; selections.current = undefined;
  }, [cancel]);
  // MS-45 / QAD-TC44/45: shared refresh for hidden, closed and open states.
  const refresh = useCallback((): Promise<boolean> => {
    if (!mounted.current || !token) return Promise.resolve(false);
    if (availabilityRequest.current) return availabilityRequest.current.promise;
    const controller = new AbortController(), current = generation.current;
    const promise = (async () => {
      try {
        const response = await fetch('/api/assistant/query', { headers: headers(), cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        const body: { data?: unknown } = await response.json();
        if (!mounted.current || controller.signal.aborted || current !== generation.current) return false;
        const parsed = assistantAvailabilitySchema.safeParse(body.data);
        if ([401, 403].includes(response.status)) { lifecycle('auth'); close(); setEnabled(false); setAuthRequired(true); return false; }
        if (!response.ok || !parsed.success) throw new Error('Availability unverified');
        const nextIdentity = JSON.stringify(parsed.data.identity);
        if (!parsed.data.enabled || (identity.current && identity.current !== nextIdentity)) {
          lifecycle('identity');
          identity.current = nextIdentity; close(); setEnabled(false); return false;
        }
        identity.current = nextIdentity; setRole(parsed.data.identity.role); setAuthRequired(false);
        if (catalogEpoch.current !== undefined && catalogEpoch.current !== parsed.data.knowledge_epoch) {
          cancel(); sourceController.current?.abort(); setSource(undefined); setSourceError(''); selections.current = undefined;
          setBusy(false); setStatus('');
        }
        catalogEpoch.current = parsed.data.knowledge_epoch; setEpoch(parsed.data.knowledge_epoch); setEnabled(true);
        return true;
      } catch {
        // A transient poll failure is not evidence of identity invalidation.
        // Every subsequent dispatch still requires a successful fresh read.
        if (mounted.current && !controller.signal.aborted && current === generation.current) {
          lifecycle('availability-transient');
          if (session.current) setError('The assistant is temporarily unavailable. Please retry.');
          else setEnabled(false);
        }
        return false;
      } finally { if (availabilityRequest.current?.controller === controller) availabilityRequest.current = null; }
    })();
    availabilityRequest.current = { controller, promise }; return promise;
  }, [token, headers, close, cancel]);
  useEffect(() => {
    mounted.current = true;
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
      else { availabilityRequest.current?.controller.abort(); availabilityRequest.current = null; }
    };
    const timer = setInterval(visible, 10000);
    const leave = () => { availabilityRequest.current?.controller.abort(); close(); setEnabled(false); };
    visible(); window.addEventListener('focus', visible); window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false; clearInterval(timer); availabilityRequest.current?.controller.abort(); availabilityRequest.current = null;
      cancel(); window.removeEventListener('focus', visible); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, cancel, close]);
  useEffect(() => {
    // Existing blocking dialogs take priority over assistant focus and overlays.
    const check = () => {
      const blocking = !!document.querySelector('[aria-modal="true"]:not([aria-labelledby="assistant-title"])');
      setBlocked(blocking); if (blocking && session.current) close();
    };
    const observer = new MutationObserver(check); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    check(); return () => observer.disconnect();
  }, [close]);
  const show = async () => {
    if (opening.current || open || blocked) return;
    opening.current = true; const current = generation.current;
    try {
      if (await refresh() && mounted.current && current === generation.current && !document.querySelector('[aria-modal="true"]')) {
        launcher.current?.focus(); session.current = crypto.randomUUID(); generation.current++; setOpen(true);
      }
    } finally { opening.current = false; }
  };
  const send = async (question: string, retry = false) => {
    if (pending.current || !question.trim() || !session.current) return;
    const before = generation.current;
    if (!await refresh() || before !== generation.current || !session.current || pending.current) return;
    const started = performance.now();
    const controller = new AbortController(), id = crypto.randomUUID(), current = generation.current;
    pending.current = { controller, id }; last.current = question;
    setBusy(true); setError(''); setStatus('Checking your request…');
    const users = messages.filter(m => m.role === 'user').slice(-4).map(m => m.text);
    // PRD-F26 / DSD-UI16: retain the previous request's failure when a new
    // question clears the active retry notice. Never leave an unanswered bubble.
    if (!retry) setMessages(previous => [...previous,
      ...(error ? [{ id: crypto.randomUUID(), role: 'assistant' as const, text: error }] : []),
      { id, role: 'user', text: question }]);
    setValue('');
    let polling = false, timedOut = false;
    // MS53 / SDD-C20: gateway permits at most 55 seconds. Allow transport cleanup
    // without leaving a lost request indefinitely busy in the browser.
    const deadline = setTimeout(() => {
      if (pending.current?.id !== id || current !== generation.current) return;
      timedOut = true; controller.abort();
      void fetch('/api/assistant/cancel', { method: 'POST', headers: headers(), body: JSON.stringify({ session_id: session.current, request_id: id }), keepalive: true }).catch(() => undefined);
    }, 65000);
    const progress = setInterval(() => {
      if (polling || controller.signal.aborted || pending.current?.id !== id) return;
      polling = true;
      void fetch('/api/assistant/progress', { method: 'POST', headers: headers(), body: JSON.stringify({ session_id: session.current, request_id: id }), cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
        .then(async response => { if (response.ok) {
          const payload: { data?: { stage?: string } } = await response.json();
          if (current === generation.current && pending.current?.id === id && !controller.signal.aborted) setStatus(payload.data?.stage === 'retrieving' ? 'Retrieving current evidence…' : payload.data?.stage === 'preparing' ? 'Preparing a grounded answer…' : payload.data?.stage === 'waiting' ? 'Waiting for capacity…' : 'Checking your request…');
        } })
        .catch(() => undefined).finally(() => { polling = false; });
    }, 1500);
    try {
      const dispatch = performance.now();
      const response = await fetch('/api/assistant/query', { method: 'POST', headers: headers(), body: JSON.stringify({ session_id: session.current, request_id: id, message: question, recent_context: { user_turns: users, selections: selections.current, knowledge_epoch: epoch } }), signal: controller.signal, cache: 'no-store' });
      if (process.env.NODE_ENV === 'development') {
        // Only the gateway's allowlisted numeric metrics and enum reason codes.
        const raw = response.headers.get('X-RAG-Diagnostics');
        if (raw) {
          try {
            const metadata = JSON.parse(raw) as { counts?: Record<string, unknown> };
            const counts = Object.fromEntries(['candidate_count', 'selected_count', 'closure_count', 'packed_quote_count', 'selection_attempts', 'expansion_attempts'].flatMap(key => {
              const value = metadata.counts?.[key]; return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? [[key, value]] : [];
            }));
            window.dispatchEvent(new CustomEvent('deskatlas:assistant-diagnostics', { detail: counts }));
          } catch { /* Diagnostics cannot affect answer delivery. */ }
        }
      }
      const received = performance.now();
      const body: { data?: unknown; error?: { code?: string; message?: string } } = await response.json();
      if (current !== generation.current) return;
      if ([401,403].includes(response.status)) { lifecycle('auth'); close(); setEnabled(false); setAuthRequired(true); return; }
      if (body.error?.code === 'NO_RELEVANT_SOURCE') { lifecycle('query-gap'); throw new Error('The requested evidence is unavailable. Please retry or ask an administrator.'); }
      if (!response.ok) throw new Error(body.error?.message || 'Assistant unavailable. Retry shortly.');
      const answer = assistantAnswerSchema.safeParse(body.data);
      if (!answer.success || answer.data.request_id !== id) throw new Error('Invalid assistant response. Retry shortly.');
      const gateway = /(?:^|,\s*)total;dur=(\d+(?:\.\d+)?)/.exec(response.headers.get('server-timing') ?? '');
      renderTiming.current = { request_id: id, generation: current, start: started, dispatch, received, parsed: performance.now(), gateway_ms: gateway ? Number(gateway[1]) : undefined };
      selections.current = answer.data.selections; setEpoch(answer.data.knowledge_epoch);
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', text: answer.data.summary, answer: answer.data }]);
      lifecycle('query-complete');
    } catch (e) { if (current === generation.current && (timedOut || !controller.signal.aborted)) setError(timedOut ? 'The assistant request timed out. Please retry.' : e instanceof Error ? e.message : 'Assistant unavailable.'); }
    finally {
      clearInterval(progress); clearTimeout(deadline); controller.abort();
      if (current === generation.current && pending.current?.id === id) { pending.current = null; setBusy(false); setStatus(''); }
    }
  };
  const readSource = async (version: string, chunk: string) => {
    sourceController.current?.abort(); const controller = new AbortController(); sourceController.current = controller;
    const current = generation.current; setSource(undefined); setSourceError('');
    try {
      const response = await fetch(`/api/assistant/sources/${encodeURIComponent(version)}/${encodeURIComponent(chunk)}`, { headers: headers(), cache: 'no-store', signal: controller.signal });
      if (current !== generation.current || controller.signal.aborted) return;
      if ([401,403].includes(response.status)) { close(); setEnabled(false); setAuthRequired(true); return; }
      const body: { data?: unknown } = await response.json(); const parsed = assistantSourceSchema.safeParse(body.data);
      if (!response.ok || !parsed.success) throw new Error('This published source is no longer available.');
      if (current === generation.current && !controller.signal.aborted) setSource(parsed.data);
    } catch (e) { if (current === generation.current && !controller.signal.aborted) setSourceError(e instanceof Error ? e.message : 'Source unavailable.'); }
  };
  if ((!enabled && !authRequired) || blocked) return null;
  return <>
    <Button ref={launcher} variant="primary" aria-label={authRequired ? 'Sign in again to use DeskAtlas Assistant' : 'Open DeskAtlas Assistant'} aria-haspopup={authRequired ? undefined : 'dialog'} aria-expanded={open}
      onClick={() => authRequired ? (onReauthenticate ? onReauthenticate() : window.location.assign('/manage/login')) : void show()} style={{ position: 'fixed', right: 'max(20px, env(safe-area-inset-right))', bottom: 'max(20px, env(safe-area-inset-bottom))', zIndex: 45, width: authRequired ? 'auto' : '56px', height: '56px', borderRadius: authRequired ? 'var(--da-radius-md, 8px)' : '50%', padding: authRequired ? '0 16px' : 0, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
      <MessageCircle size={24} aria-hidden="true" />
      {authRequired && 'Sign in again'}
    </Button>
    {open && <AssistantPanel role={role} messages={messages} value={value} busy={busy} status={status} error={error} epoch={epoch} source={source} sourceError={sourceError}
      onValue={setValue} onSubmit={() => void send(value)} onRetry={() => void send(last.current, true)} onClose={close}
      onSource={(version, chunk) => void readSource(version, chunk)} onDismissSource={() => { sourceController.current?.abort(); sourceController.current = null; setSource(undefined); setSourceError(''); }} />}
  </>;
}
