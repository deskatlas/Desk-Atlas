import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const fetchMock = vi.fn();
const render = () => {
  hooks.state.cursor = 0; hooks.state.dirty = false;
  tree = AssistantLauncher({ token: 'synthetic-hook-fixture' }) as unknown as Element | null;
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
  it('closes and clears an open panel on failure or verified identity change', async () => {
    eligible = true; render(); await settle(); await clickOpen();
    role = 'STAFF'; browser.dispatchEvent(new Event('focus')); await settle();
    expect(tree).toBeNull(); expect(panel()).toBeUndefined();
    browser.dispatchEvent(new Event('focus')); await settle(); await clickOpen();
    fetchMock.mockRejectedValue(new Error('offline')); browser.dispatchEvent(new Event('focus')); await settle(); expect(tree).toBeNull();
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
