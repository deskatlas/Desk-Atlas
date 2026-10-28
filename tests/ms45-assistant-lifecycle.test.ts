import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { issueStaffAssistantSession, verifyStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';

// MS45-TC04/05/08/09/10: execute the real launcher's hooks with deterministic
// browser events and deferred transport. This does not replace browser acceptance.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: unknown[]; cleanup?: () => void };
  const slots: unknown[] = [], effects: Effect[] = [], queued: (() => void)[] = [];
  const state = { cursor: 0, dirty: false, slots, effects, queued };
  const changed = (previous: unknown[] | undefined, next: unknown[] | undefined) => !previous || !next || previous.length !== next.length || next.some((value, i) => !Object.is(value, previous[i]));
  return {
    state,
    useState: (initial: unknown) => {
      const i = state.cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value: unknown) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; state.dirty = true; }];
    },
    useRef: (initial: unknown) => { const i = state.cursor++; return slots[i] ??= { current: initial }; },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const i = state.cursor++, prior = slots[i] as { value: unknown; deps: unknown[] } | undefined;
      if (!prior || changed(prior.deps, deps)) slots[i] = { value: callback, deps };
      return (slots[i] as { value: unknown }).value;
    },
    useEffect: (callback: () => (() => void) | undefined, deps?: unknown[]) => {
      const i = state.cursor++;
      if (changed(effects[i]?.deps, deps)) queued.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; });
    },
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...props as object, children } }),
  };
});
vi.mock('../apps/admin-portal/node_modules/react', () => ({ ...hooks, default: { ...hooks, Fragment: 'fragment' } }));
vi.mock('@deskatlas/ui', () => ({ AssistantPanel: 'panel', Button: 'button' }));
vi.mock('../apps/admin-portal/node_modules/lucide-react', () => ({ MessageCircle: 'icon' }));
import { AssistantLauncher } from '../apps/admin-portal/src/features/assistant/AssistantLauncher';

type Element = { type: unknown; props: Record<string, unknown> & { children: Element[] } };
let tree: Element | null, eligible: boolean, role: string, epoch: number, query: Promise<Response> | undefined;
let doc: EventTarget & { visibilityState: string; querySelector: () => unknown }, browser: EventTarget;
let observerCallback: () => void, blocking: boolean;
let featureToken = 'synthetic-hook-fixture', reauthenticate: (() => void) | undefined;
const fetchMock = vi.fn();
const render = () => {
  hooks.state.cursor = 0; hooks.state.dirty = false;
  tree = AssistantLauncher({ token: featureToken, onReauthenticate: reauthenticate }) as unknown as Element | null;
  for (const effect of hooks.state.queued.splice(0)) effect();
};
async function settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); if (hooks.state.dirty) render(); } }
const panel = () => tree?.props.children.find(child => child && child.type === 'panel');
async function clickOpen() { const button = tree?.props.children.find(child => child && child.type === 'button'); expect(button).toBeDefined(); await (button!.props.onClick as () => Promise<void>)(); await settle(); }
function deferred() { let resolve!: (response: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; }
function answer(requestId: string) {
  return Response.json({ data: { kind: 'DOCUMENT', summary: 'Synthetic verified answer', request_id: requestId, knowledge_epoch: epoch, as_of: new Date().toISOString(), tables: [], citations: [], interpretation: [], limitations: [] } });
}
beforeEach(() => {
  vi.useFakeTimers(); hooks.state.slots.length = 0; hooks.state.effects.length = 0; hooks.state.queued.length = 0;
  tree = null; eligible = false; role = 'ADMIN'; epoch = 1; query = undefined; blocking = false;
  featureToken = 'synthetic-hook-fixture'; reauthenticate = undefined;
  browser = new EventTarget(); doc = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => blocking ? {} : null });
  vi.stubGlobal('window', browser); vi.stubGlobal('document', doc);
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { observerCallback = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => undefined);
  fetchMock.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/cancel')) return Response.json({ data: { cancelled: true } });
    if (init.method === 'POST') return query ?? answer(JSON.parse(String(init.body)).request_id);
    return Response.json({ data: { enabled: eligible, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: epoch } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { for (const effect of hooks.state.effects) effect?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('MS45 ephemeral launcher lifecycle', () => {
  it('QAD-TC44 retains a failed request beside its question on the next submission', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    query = Promise.resolve(Response.json({ error: { code: 'MODEL_UNAVAILABLE', message: 'The answer service is temporarily unavailable.' } }, { status: 503 }));
    (panel()!.props.onValue as (value: string) => void)('First question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    expect(panel()!.props.error).toContain('temporarily unavailable');
    query = deferred().promise;
    (panel()!.props.onValue as (value: string) => void)('Second question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    const messages = panel()!.props.messages as { role: string; text: string }[];
    expect(messages.map(message => message.text)).toEqual(['First question', 'The answer service is temporarily unavailable.', 'Second question']);
  });
  it('QAD-TC44 expiry clears conversation and exposes sign-in recovery instead of disappearing', async () => {
    const secret = randomUUID(), start = Date.now();
    featureToken = issueStaffAssistantSession('00000000-0000-4000-8000-000000000001', secret, start);
    reauthenticate = vi.fn();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => !verifyStaffAssistantSession(featureToken, secret)
      ? Promise.resolve(Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 })) : original(url, init));
    eligible = true; render(); await settle(); await clickOpen();
    (panel()!.props.onValue as (value: string) => void)('Private draft'); await settle();
    vi.setSystemTime(start + 60 * 60 * 1000);
    browser.dispatchEvent(new Event('focus')); await settle();
    expect(panel()).toBeUndefined();
    const recovery = tree?.props.children.find(child => child?.type === 'button');
    expect(recovery?.props['aria-label']).toBe('Sign in again to use DeskAtlas Assistant');
    (recovery!.props.onClick as () => void)();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });
  it('MS58-TC06 keeps source withdrawal separate from answer retry', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => url.includes('/sources/') ? Response.json({ error: {} }, { status: 404 }) : original(url, init));
    (panel()!.props.onSource as (version: string, chunk: string) => void)('version', 'chunk'); await settle();
    expect(panel()!.props.source).toBeUndefined();
    expect(panel()!.props.sourceError).toContain('no longer available');
    expect(panel()!.props.error).toBe('');
    expect(fetchMock.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });
  it('MS58-TC07 dismissing an in-flight excerpt prevents late disclosure', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    const late = deferred();
    fetchMock.mockImplementation(async () => late.promise);
    (panel()!.props.onSource as (version: string, chunk: string) => void)('version', 'chunk'); await settle();
    const signal = fetchMock.mock.calls.at(-1)![1].signal;
    (panel()!.props.onDismissSource as () => void)(); await settle();
    expect(signal.aborted).toBe(true);
    late.resolve(Response.json({ data: { document_id: '00000000-0000-4000-8000-000000000001', version_id: '00000000-0000-4000-8000-000000000001', chunk_id: '00000000-0000-4000-8000-000000000001', title: 'Withdrawn', heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: 'Stale private text' } }));
    await settle(); expect(panel()!.props.source).toBeUndefined(); expect(panel()!.props.sourceError).toBe('');
  });
  it('MS53 follow-up: an unknown progress stage cannot claim capacity waiting', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    (panel()!.props.onValue as (value: string) => void)('First question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    const waiting = deferred(); query = waiting.promise;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/progress')) return Response.json({ data: { stage: 'checking' } });
      if (init.method === 'POST') return query;
      return Response.json({ data: { enabled: true, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: epoch } });
    });
    (panel()!.props.onValue as (value: string) => void)('Second question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(panel()!.props.busy).toBe(true);
    expect(panel()!.props.status).not.toContain('Waiting for capacity');
  });
  it('MS53 follow-up: a stalled query ends with retry and cancels server work at the client deadline', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    (panel()!.props.onValue as (value: string) => void)('First question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/cancel')) return Response.json({ data: { cancelled: true } });
      if (url.endsWith('/progress')) return Response.json({ data: { stage: 'waiting' } });
      if (init.method === 'POST') return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      return Response.json({ data: { enabled: true, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: epoch } });
    });
    (panel()!.props.onValue as (value: string) => void)('Second question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    expect(panel()!.props.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(64000); await settle();
    expect(panel()!.props.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); await settle();
    expect(panel()!.props.busy).toBe(false);
    expect(panel()!.props.status).toBe('');
    expect(panel()!.props.error).toMatch(/timed out.*retry/i);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/cancel'))).toBe(true);
  });
  it('MS53 follow-up: late progress cannot restore waiting after answer completion', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    const pendingAnswer = deferred(), pendingProgress = deferred();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/progress')) return pendingProgress.promise;
      if (init.method === 'POST') return pendingAnswer.promise;
      return Response.json({ data: { enabled: true, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: epoch } });
    });
    (panel()!.props.onValue as (value: string) => void)('Question'); await settle();
    (panel()!.props.onSubmit as () => void)(); await settle();
    await vi.advanceTimersByTimeAsync(1500); await settle();
    await vi.advanceTimersByTimeAsync(4500); await settle();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/progress'))).toHaveLength(1);
    const sent = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/query') && init.method === 'POST')!;
    pendingAnswer.resolve(answer(JSON.parse(String(sent[1].body)).request_id)); await settle();
    expect(panel()!.props.busy).toBe(false); expect(panel()!.props.status).toBe('');
    pendingProgress.resolve(Response.json({ data: { stage: 'waiting' } })); await settle();
    expect(panel()!.props.status).toBe('');
  });
  it('reveals first publication while hidden and withdraws while closed via visible polling', async () => {
    render(); await settle(); expect(tree).toBeNull();
    eligible = true; await vi.advanceTimersByTimeAsync(10000); await settle(); expect(tree).not.toBeNull();
    eligible = false; await vi.advanceTimersByTimeAsync(10000); await settle(); expect(tree).toBeNull();
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); const count = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000); expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it('does not open when the pre-open check loses eligibility', async () => {
    eligible = true; render(); await settle(); eligible = false;
    await clickOpen(); expect(tree).toBeNull(); expect(panel()).toBeUndefined();
  });
  it('clears drafts and rejects a late answer after close and reopen', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    (panel()!.props.onValue as (value: string) => void)('Paano mag check-in?'); await settle();
    const late = deferred(); query = late.promise; (panel()!.props.onSubmit as () => void)(); await settle();
    const sent = fetchMock.mock.calls.find(([, init]) => init.method === 'POST' && String(init.body).includes('message'))!;
    const requestId = JSON.parse(String(sent[1].body)).request_id;
    (panel()!.props.onClose as () => void)(); await settle(); await clickOpen();
    late.resolve(answer(requestId)); await settle();
    expect(panel()!.props.messages).toEqual([]); expect(panel()!.props.value).toBe('');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/cancel'))).toBe(true);
  });
  it('MS60-TC21/22 clears on identity change but keeps the same-session panel on transient failure', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    role = 'STAFF'; browser.dispatchEvent(new Event('focus')); await settle();
    expect(tree).toBeNull(); expect(panel()).toBeUndefined();
    browser.dispatchEvent(new Event('focus')); await settle(); await clickOpen();
    fetchMock.mockRejectedValue(new Error('offline')); browser.dispatchEvent(new Event('focus')); await settle();
    expect(panel()).toBeDefined();
    expect(panel()!.props.error).toMatch(/temporarily unavailable/i);
  });
  it('never overlaps availability reads and discards a response after unmount', async () => {
    const late = deferred(); fetchMock.mockReturnValue(late.promise); render();
    browser.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10000); expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const effect of hooks.state.effects) effect?.cleanup?.(); hooks.state.dirty = false;
    late.resolve(Response.json({ data: { enabled: true, identity: { id: '00000000-0000-4000-8000-000000000001', role }, knowledge_epoch: 1 } }));
    await settle(); expect(tree).toBeNull(); expect(hooks.state.dirty).toBe(false);
  });
  it('keeps a panel open on catalog replacement while clearing old context and prioritizes urgent dialogs', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    epoch++; browser.dispatchEvent(new Event('focus')); await settle(); expect(panel()!.props.epoch).toBe(2);
    blocking = true; observerCallback(); await settle(); expect(tree).toBeNull();
    blocking = false; observerCallback(); await settle(); await clickOpen(); expect(panel()!.props.messages).toEqual([]);
  });
});
