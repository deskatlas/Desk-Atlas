import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

// MS57-TC01/07/08/09/11/12/13 / QAD-TC44/45: authenticated full orchestration.
const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1, active: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => {
    const result = () => ({ data: table === 'staff_profiles' ? { role: 'ADMIN', is_active: db.active }
      : table === 'business_settings' ? { timezone: 'Asia/Manila' } : { epoch: db.epoch, active_embedding_fingerprint: 'synthetic' }, error: null });
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const source = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Rooms',
  heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content });
let sources = [source('Rooms have desks.'), source('Rooms are not soundproof.')];
let behavior = 'accept';
let scope = 'FACTUAL';
let outcome = 'COMPLETE';
let gaps: string[] = [];
let mixed = false;
const calls: string[] = [];
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
    RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(),
    RAG_CAPABILITY_SECRET: randomUUID(), RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'synthetic', RAG_MIN_SIMILARITY: '0.5',
    RAG_SOP_FAST_PATH: 'false', RAG_HYBRID_RETRIEVAL: 'false', RAG_SYNTHESIS_ENABLED: 'true' })) vi.stubEnv(key, value);
  behavior = 'accept'; scope = 'FACTUAL'; outcome = 'COMPLETE'; gaps = []; mixed = false; calls.length = 0;
  db.epoch = 1; db.active = true; sources = [source('Rooms have desks.'), source('Rooms are not soundproof.')];
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === 'assistant_knowledge_availability' ? { enabled: true, knowledge_epoch: db.epoch }
      : name === 'assistant_read_tool' ? { tables: [{ title: 'Operations', columns: ['Bookings'], rows: [[7]] }], interpretation: [], limitations: [] }
      : name === 'assistant_search_knowledge' ? sources
        : name === 'assistant_expand_evidence' ? behavior === 'closure' ? { complete: false, sources: [], reason: 'UNRESOLVED_CONTEXT' }
          : { complete: true, sources, groups: sources.map((s, i) => ({ id: `u${i}`, chunk_ids: [s.chunk_id], requires: [] })) }
          : behavior === 'withdraw' ? null : sources.find(s => s.chunk_id === args.p_chunk) }));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path === '/v1/plan' && behavior.startsWith('clarify')) return Response.json({ kind: 'CLARIFY', query: '', tools: [],
      ...(behavior === 'clarify-specific' ? { clarification: 'Which procedure are you referring to?' } : {}) });
    if (path === '/v1/plan') return Response.json({ kind: mixed ? 'MIXED' : 'DOCUMENT', query: 'Describe rooms.', tools: mixed ? [{ name: 'operational_snapshot', args: {} }] : [] });
    if (path === '/v1/embed') return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (path === '/v1/embed-queries') return Response.json({ embeddings:
      (JSON.parse(String(init?.body)) as { queries: string[] }).queries.map(() => ({ vector: [1, ...Array(1023).fill(0)] })) });
    if (path === '/v1/context') return Response.json({ chunk_ids: outcome === 'CONFLICT' ? [] : sources.map(s => s.chunk_id), ambiguous: false, coverage: { scope, outcome, gaps } });
    if (path === '/v1/answer') return Response.json({ quotes: behavior === 'bad-exact' ? [] : sources.map(s => ({ chunk_id: s.chunk_id, quote: s.content })) });
    const payload = JSON.parse(String(init?.body));
    expect(payload.sources).toEqual(sources);
    expect(payload.spans.map((s: { quote: string }) => s.quote)).toEqual(sources.map(s => s.content));
    expect(payload).not.toHaveProperty('tables');
    if (path === '/v1/synthesis') {
      if (behavior === 'projection-capacity') return Response.json({ detail: 'OUTPUT_BUDGET_EXCEEDED' }, { status: 400 });
      if (behavior === 'service-failure') return Response.json({ detail: 'MODEL_UNAVAILABLE' }, { status: 503 });
      if (behavior === 'main-projection') return Response.json({ version: 'ms57-v1', scope, outcome, gaps,
        blocks: sources.map((s, i) => ({ kind: 'text', text: s.content, support: [i] })),
        main_blocks: [{ kind: 'text', text: 'Rooms have desks and are not soundproof.', support: [0, 1], actions: [] }] });
      if (behavior === 'hang') return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      if (behavior === 'timeout') return Response.json({ detail: 'MODEL_TIMEOUT' }, { status: 504 });
      if (behavior === 'disable-inflight') vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'false');
      return Response.json({ version: 'ms57-v1', scope, outcome, gaps, blocks: [
        { kind: 'text', text: 'The rooms provide desks.', support: [0] },
        { kind: 'text', text: behavior === 'price' ? 'They are not soundproof and cost 500 pesos.' : 'They are not soundproof.', support: [1] },
      ] });
    }
    if (path === '/v1/support') {
      if (behavior === 'support-schema') return Response.json({ supported: 'invalid' });
      if (behavior === 'support-timeout') return Response.json({ detail: 'MODEL_TIMEOUT' }, { status: 504 });
      if (behavior === 'revoke') db.active = false;
      if (behavior === 'epoch') db.epoch++;
      return Response.json({ supported: behavior === 'main-projection' ? [true] : [true, behavior !== 'reject'], complete: behavior !== 'incomplete', consistent: behavior !== 'contradiction', evidence_safe: behavior !== 'unsafe-evidence' });
    }
    throw new Error('Unexpected path');
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const query = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => assistantQuery(new Request('http://localhost/api/assistant/query', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
    ...headers,
    Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
  body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: 'Describe rooms.', ...extra }),
}));
it.each([
  ['reject', 'SUPPORT_REJECTED', 'SUPPORT'],
  ['support-schema', 'SUPPORT_SCHEMA_REJECTED', 'SUPPORT'],
  ['price', 'SCHEMA_REJECTED', 'SYNTHESIS'],
  ['timeout', 'TIMEOUT', 'SYNTHESIS'],
  ['support-timeout', 'TIMEOUT', 'SUPPORT'],
  ['service-failure', 'SERVICE_FAILURE', 'SYNTHESIS'],
  ['projection-capacity', 'BUDGET_NOT_ADMITTED', 'SYNTHESIS'],
])('MS62-TC05 attributes %s without leaking prose or changing exact proof', async (mode, reason, stage) => {
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true'); behavior = mode;
  const response = await query({}, { 'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1' });
  const answer = (await response.json()).data;
  expect(answer.answer_mode).toBe('EXACT');
  expect(answer.summary).toBe(sources.map(source => source.content).join('\n\n'));
  expect(answer.evidence_spans.map((span: { quote: string }) => span.quote)).toEqual(sources.map(source => source.content));
  const diagnostics = response.headers.get('X-RAG-Diagnostics')!;
  expect(JSON.parse(diagnostics)).toMatchObject({ fallback_reason: reason, fallback_stage: stage,
    exact_presentation: { status: 'ORIGINAL_EXACT', omitted_atoms: 0, visible_atoms: 2, acceptance: 'PENDING' } });
  expect(diagnostics).not.toContain('Rooms');
  expect(calls.filter(path => path === '/v1/synthesis')).toHaveLength(1);
  expect(calls.filter(path => path === '/v1/support').length).toBeLessThanOrEqual(1);
  if (mode === 'projection-capacity') expect(JSON.parse(diagnostics).failures).toContainEqual(
    expect.objectContaining({ stage: 'synthesis', reason: 'OUTPUT_BUDGET_EXCEEDED' }));
});
it('MS62-TC05 disabled synthesis retains safe exact presentation with truthful diagnostics', async () => {
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true'); vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'false');
  const response = await query({}, { 'X-DeskAtlas-Answer-Contract': 'ms59-v1' });
  expect(JSON.parse(response.headers.get('X-RAG-Diagnostics')!)).toMatchObject({ fallback_reason: 'DISABLED', fallback_stage: 'ADMISSION' });
  expect((await response.json()).data.answer_mode).toBe('EXACT');
  expect(calls).not.toContain('/v1/synthesis');
});

it('PRD-F4 witnessed inventory selection still requires independent final evidence verification', async () => {
  behavior = 'bad-exact';
  sources = [source('No inventory holds: selecting a desk does not reserve inventory. Allocation occurs only on authorized payment confirmation.'),
    source('Seats are held as soon as they are picked.')];
  const response = await query({ message: "They've chosen a desk. Is that enough to secure it?" },
    { 'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1' });
  const answer = (await response.json()).data;
  expect(calls).not.toContain('/v1/context');
  expect(calls).toContain('/v1/answer');
  const expansion = db.rpc.mock.calls.find(([name]) => name === 'assistant_expand_evidence');
  expect(expansion?.[1].p_chunks).toEqual(sources.map(item => item.chunk_id));
  expect(answer.answer_mode).toBe('EVIDENCE_GAP');
  expect(answer.citations).toEqual([]);
  expect(calls).not.toContain('/v1/synthesis');
});
it('MS60 main projection requires explicit negotiation and preserves complete exact proof', async () => {
  behavior = 'main-projection';
  const legacy = (await (await query({}, { 'X-DeskAtlas-Answer-Contract': 'ms59-v1' })).json()).data;
  expect(legacy.answer_mode).toBe('EXACT');
  expect(legacy.synthesis).toBeUndefined();
  expect(calls).not.toContain('/v1/support');
  const modern = (await (await query({}, { 'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1' })).json()).data;
  expect(modern.answer_mode).toBe('SYNTHESIZED');
  expect(modern.summary).toBe('Rooms have desks and are not soundproof.');
  expect(modern.evidence_spans.map((span: { quote: string }) => span.quote)).toEqual(sources.map(s => s.content));
});
it('MS60 unknown main contracts fail before model execution', async () => {
  const response = await query({}, { 'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'unknown' });
  expect(response.status).toBe(400);
  expect(calls).toEqual([]);
});
it('MS57-TC01 accepts generated prose only after one candidate and a separate support pass', async () => {
  const response = await query(); const answer = (await response.json()).data;
  expect(answer.summary).toBe('The rooms provide desks.\n\nThey are not soundproof.');
  expect(answer.answer_mode).toBe('SYNTHESIZED'); expect(answer.synthesis_status).toBe('ACCEPTED');
  expect(answer.evidence_spans.map((s: { quote: string }) => s.quote)).toEqual(sources.map(s => s.content));
  expect(calls.filter(c => ['/v1/synthesis', '/v1/support'].includes(c))).toEqual(['/v1/synthesis', '/v1/support']);
  expect(response.headers.get('server-timing')).toMatch(/synthesis;dur=.*support;dur=/);
});
it.each(['Ano ang gamit ng mga kuwarto?', 'Ano ang features ng rooms?', 'Explain the rooms in Tagalog.', 'Explain the rooms in Taglish.'])('MS61 v2 understands %s while requesting concise English output', async message => {
  behavior = 'main-projection';
  const response = await query({ message }, {
    'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
  });
  const answer = (await response.json()).data;
  expect(response.status).toBe(200);
  expect(answer.answer_mode).toBe('SYNTHESIZED');
  expect(answer.summary).toBe('Rooms have desks and are not soundproof.');
  expect(answer.evidence_spans.map((span: { quote: string }) => span.quote)).toEqual(sources.map(source => source.content));
  expect(calls).toContain('/v1/synthesis');
  expect(calls).toContain('/v1/support');
  const sent = (path: string) => JSON.parse(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith(path))?.[1]?.body)) as { language?: string; query?: string; message?: string };
  expect(sent('/v1/plan').message).toBe(message);
  expect(sent('/v1/synthesis').language).toBe('en');
  expect(sent('/v1/synthesis').query).toContain(message);
  expect(sent('/v1/support').query).toContain(message);
  expect(answer.limitations.join(' ')).not.toMatch(/nasuring salin|reviewed translation|original published language/);
});
it.each(['reject', 'timeout'])('MS61 v2 Tagalog input keeps safe English fallback after %s', async mode => {
  behavior = mode;
  const answer = (await (await query({ message: 'Ano ang gamit ng mga kuwarto?' }, {
    'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
  })).json()).data;
  expect(answer.synthesis).toBeUndefined();
  expect(answer.synthesis_status).toBe('EXACT_FALLBACK');
  expect(answer.summary).toBe(sources.map(source => source.content).join('\n\n'));
  expect(answer.limitations).toContain('Quotations retain the language of the published source.');
});
it('MS61 v2 Taglish unsupported questions use English system copy', async () => {
  behavior = 'clarify-empty';
  const answer = (await (await query({ message: 'Paano ko gagawin ito?' })).json()).data;
  expect(answer.summary).toBe('Could you clarify what you want to know or do?');
});
it('QAD-TC44 clarification fallback never assumes a report was requested', async () => {
  behavior = 'clarify-empty';
  const answer = (await (await query({ message: 'Can we propose a policy improvement?' })).json()).data;
  expect(answer.answer_mode).toBe('CLARIFICATION');
  expect(answer.summary).toBe('Could you clarify what you want to know or do?');
  expect(answer.summary).not.toMatch(/metric|date range|workspace/i);
});
it('QAD-TC44 preserves a focused question supplied by the planner', async () => {
  behavior = 'clarify-specific';
  const answer = (await (await query({ message: 'Can we improve it?' })).json()).data;
  expect(answer.summary).toBe('Which procedure are you referring to?');
});
it.each(['reject', 'incomplete', 'price', 'timeout'])('MS57-TC08/12 %s falls back to independently verified exact evidence', async mode => {
  behavior = mode; const answer = (await (await query()).json()).data;
  expect(answer.summary).toBe(sources.map(s => s.content).join('\n\n'));
  expect(answer.synthesis).toBeUndefined(); expect(answer.synthesis_status).toBe('EXACT_FALLBACK');
  expect(answer.summary).not.toContain('500');
});
it.each(['closure', 'bad-exact'])('MS57-TC09 no synthesis or fallback bypasses %s', async mode => {
  behavior = mode; const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]); expect(calls).not.toContain('/v1/synthesis');
});
it('MS57-TC07 conflicting policies cannot be synthesized', async () => {
  outcome = 'CONFLICT'; const answer = (await (await query()).json()).data;
  expect(answer.answer_mode).toBe('CONFLICT'); expect(answer.citations).toEqual([]); expect(calls).not.toContain('/v1/synthesis');
});
it.each(['contradiction', 'unsafe-evidence'])('MS57-TC09 verifier-detected %s blocks exact fallback too', async mode => {
  behavior = mode; const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]); expect(answer.evidence_spans).toBeUndefined(); expect(answer.synthesis).toBeUndefined();
  expect(answer.summary).not.toContain('Rooms have desks.');
  expect(answer.answer_mode).toBe(mode === 'contradiction' ? 'CONFLICT' : 'FAILURE');
});
it('MS57-TC02 safe partial prose retains explicit verified gaps', async () => {
  scope = 'MULTI_PART'; outcome = 'PARTIAL_GENERAL'; gaps = ['Room price'];
  const answer = (await (await query()).json()).data;
  expect(answer.answer_mode).toBe('PARTIAL_GENERAL'); expect(answer.limitations.join()).toContain('Room price');
});
it.each(['revoke', 'withdraw', 'epoch'])('MS57-TC11 final %s change prevents content emission', async mode => {
  behavior = mode; const response = await query();
  expect(response.status).not.toBe(200); expect(await response.text()).not.toContain('The rooms provide desks.');
});
it('MS57-TC12 off mode keeps retrieval/excerpts and cannot be overridden by clients', async () => {
  vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'false');
  const answer = (await (await query()).json()).data;
  expect(answer.synthesis_status).toBe('DISABLED'); expect(answer.summary).toContain('Rooms have desks.');
  expect(calls).not.toContain('/v1/synthesis');
  expect((await query({ synthesis_enabled: true })).status).toBe(400);
});
it('MS57-TC12 disable affects new admissions while the admitted request uses frozen mode', async () => {
  behavior = 'disable-inflight'; expect((await (await query()).json()).data.synthesis_status).toBe('ACCEPTED');
  expect((await (await query()).json()).data.synthesis_status).toBe('DISABLED');
});
it('MS57-TC13 mixed tools retain verified tables and deterministic arithmetic outside model input', async () => {
  mixed = true; const answer = (await (await query()).json()).data;
  expect(answer.tables[0].rows).toEqual([[7]]); expect(answer.summary).toContain('Bookings: 7.');
  expect(answer.synthesis.blocks.map((b: { text: string }) => b.text).join()).not.toContain('7');
});
it('MS57-TC12 cancels optional inference at its deadline and retains time for exact fallback', async () => {
  vi.useFakeTimers(); behavior = 'hang';
  try {
    const response = query();
    await vi.waitFor(() => expect(calls).toContain('/v1/synthesis'));
    await vi.advanceTimersByTimeAsync(8001);
    const answer = (await (await response).json()).data;
    expect(answer.synthesis_status).toBe('EXACT_FALLBACK'); expect(answer.summary).toContain('Rooms have desks.');
    expect(calls).not.toContain('/v1/support');
  } finally { vi.useRealTimers(); }
});
