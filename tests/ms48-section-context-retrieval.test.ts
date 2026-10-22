import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assistantProgress, assistantQuery, groundedQuotes } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { assistantEvidenceSchema } from '../packages/validation/src/assistantSchema';

// MS48-TC02/08/09/12: authenticated gateway outcomes and independent coverage.
// Real parser/SQL expansion is exercised by ms48-postgres-context.py.
const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1, active: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({
    in: (_column: string, ids: string[]) => ({ abortSignal: async () => ({ data: ids.map(id => ({ id, support_contract: null })), error: null }) }),
    eq: () => {
    const result = () => ({ data: table === 'staff_profiles' ? { role: 'ADMIN', is_active: db.active }
      : table === 'business_settings' ? { timezone: 'Asia/Manila' } : { epoch: db.epoch, active_embedding_fingerprint: 'synthetic' }, error: null });
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const source = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic SOP', heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content });
let sources = [source('Employees may suggest improvements.'), source('Only management may approve SOP changes.'), source('The kitchen opens at eight.')];
let groups = [{ id: 'suggest', chunk_ids: [sources[0].chunk_id], requires: ['approve'] },
  { id: 'approve', chunk_ids: [sources[1].chunk_id], requires: [] },
  { id: 'kitchen', chunk_ids: [sources[2].chunk_id], requires: [] }];
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
    RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(),
    RAG_CAPABILITY_SECRET: randomUUID(), RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'synthetic', RAG_MIN_SIMILARITY: '0.5' })) vi.stubEnv(key, value);
  db.epoch = 1; db.active = true;
  sources = [source('Employees may suggest improvements.'), source('Only management may approve SOP changes.'), source('The kitchen opens at eight.')];
  groups = [{ id: 'suggest', chunk_ids: [sources[0].chunk_id], requires: ['approve'] }, { id: 'approve', chunk_ids: [sources[1].chunk_id], requires: [] }, { id: 'kitchen', chunk_ids: [sources[2].chunk_id], requires: [] }];
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === 'assistant_knowledge_availability' ? { enabled: true, knowledge_epoch: db.epoch }
      : name === 'assistant_search_knowledge' ? [sources[0]]
        : name === 'assistant_expand_evidence' ? { complete: true, sources: sources.slice(0, 2), groups: groups.slice(0, 2) }
          : sources.find(s => s.chunk_id === args.p_chunk) }));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'Can employees suggest improvements to the SOP?', tools: [] });
    if (String(url).endsWith('/v1/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (String(url).endsWith('/v1/context')) return Response.json({ chunk_ids: [sources[0].chunk_id], ambiguous: false });
    return Response.json({ quotes: sources.slice(0, 2).map(s => ({ chunk_id: s.chunk_id, quote: s.content })) });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function request(message = 'Can employees suggest improvements to the SOP?') {
  return new Request('http://localhost/api/assistant/query', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
    Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
  body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message }) });
}
it('answers both SOP governance clauses with joint candidate selection and linked authority rules', async () => {
  vi.stubEnv('RAG_SOP_FAST_PATH', 'true');
  sources = [source('Management is responsible for reviewing and updating the SOP.'),
    source('Employees can suggest SOP improvements. Management reviews feedback before revisions.')];
  groups = [{ id: 'owner', chunk_ids: [sources[0].chunk_id], requires: [] },
    { id: 'improvement', chunk_ids: [sources[1].chunk_id], requires: ['owner'] }];
  const originalRpc = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'assistant_search_knowledge'
    ? Promise.resolve({ data: sources, error: null }) : originalRpc(name, args));
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => /\/v1\/plan$/.test(String(url))
    ? Promise.resolve(Response.json({ chunk_ids: [sources[0].chunk_id], ambiguous: false })) : originalFetch(url, init));
  const response = await assistantQuery(request('who can manage the sop and can we improve it?'));
  const answer = (await response.json()).data;
  expect(answer.summary).toContain('responsible for reviewing and updating');
  expect(answer.summary).toContain('Management reviews feedback before revisions');
  expect(answer.citations).toHaveLength(2);
  expect(answer.limitations.join()).not.toMatch(/MODEL_TIMEOUT|NO_RELEVANT_SOURCE|INCOMPLETE/);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => /\/v1\/plan$/.test(String(url)))).toBe(false);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/context'))).toBe(true);
});
it('binds a literal FAQ and compares candidates before expanding reviewed restrictions', async () => {
  const question = 'Where should safety incidents be reported?';
  const heading = `SOP / FAQ: Safety / Q7. ${question}`;
  sources[0] = { ...sources[0], heading_path: heading, content: `${heading}\n\nReport incidents to management.` };
  const originalRpc = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'assistant_search_knowledge') return { error: null, data: sources };
    if (name === 'assistant_expand_evidence') return (args.p_chunks as string[]).length > 1
      ? { error: null, data: { complete: false, reason: 'CONTEXT_BUDGET', sources: [] } }
      : { error: null, data: { complete: true, sources: sources.slice(0, 2), groups: groups.slice(0, 2) } };
    return originalRpc(name, args);
  });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'Planner rewording', tools: [] });
    if (String(url).endsWith('/v1/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (String(url).endsWith('/v1/context')) return Response.json({ chunk_ids: [sources[0].chunk_id], ambiguous: false });
    expect(String(url)).toMatch(/\/v1\/answer$/);
    const payload = JSON.parse(String(init?.body)) as { query: string; exact_faq?: boolean; sources: typeof sources };
    expect(payload.query).toBe(question);
    expect(payload.exact_faq).toBe(true);
    expect(payload.sources).toHaveLength(2);
    return Response.json({ quotes: sources.slice(0, 2).map(item => ({ chunk_id: item.chunk_id, quote: item.content })) });
  }));
  const response = await assistantQuery(request(question));
  const answer = (await response.json()).data;
  expect(response.status).toBe(200);
  expect(answer.summary).toContain('Report incidents to management.');
  expect(answer.summary).toContain('Only management may approve SOP changes.');
  expect(answer.citations).toHaveLength(2);
});
it('keeps approval conditions and excludes an unrelated candidate unit', async () => {
  const response = await assistantQuery(request());
  expect(response.status).toBe(200);
  const answer = (await response.json()).data;
  expect(answer.summary).toContain('Only management'); expect(answer.summary).not.toContain('kitchen');
  expect(answer.citations).toHaveLength(2);
  expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_read_source')).toHaveLength(2);
  expect(groundedQuotes({ quotes: [{ chunk_id: sources[0].chunk_id, quote: sources[0].content }] }, sources, 'Can employees suggest?', groups).summary).toBe('');
});
it.each(['CONTEXT_BUDGET', 'REPROCESS_REQUIRED', 'UNRESOLVED_CONTEXT'])('reports %s without a contradictory no-source claim', async reason => {
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name, args) => name === 'assistant_expand_evidence' ? Promise.resolve({ data: { complete: false, reason, sources: [] }, error: null }) : original(name, args));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.limitations.join()).toContain(reason);
  expect(answer.limitations.join()).not.toContain('NO_RELEVANT_SOURCE');
  expect(answer.summary).not.toContain('No verified answer');
  expect(answer.summary).not.toMatch(/CONTEXT_BUDGET:|REPROCESS_REQUIRED:|UNRESOLVED_CONTEXT:/);
  // MS59 allows one joint reconsideration only for selection-capacity overflow.
  expect(fetch).toHaveBeenCalledTimes(reason === 'CONTEXT_BUDGET' ? 4 : 3);
});
it.each(['CONTEXT_BUDGET_EXCEEDED', 'OUTPUT_BUDGET_EXCEEDED', 'UNRESOLVED_CONTEXT'])('preserves Python %s outcomes', async detail => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/answer') ? Promise.resolve(Response.json({ detail }, { status: 400 })) : original(url, init));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.limitations.join()).toContain(detail === 'UNRESOLVED_CONTEXT' ? 'INCOMPLETE_CONTEXT' : 'INCOMPLETE_EVIDENCE');
  expect(answer.limitations.join()).not.toMatch(/NO_RELEVANT_SOURCE|MODEL_UNAVAILABLE/);
});
it.each(['MANIFEST_INVALID', 'database unavailable'])('keeps %s distinct from model failures', async reason => {
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name, args) => name === 'assistant_expand_evidence' ? Promise.resolve({ data: null, error: { message: reason } }) : original(name, args));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.limitations.join()).toContain(reason === 'MANIFEST_INVALID' ? 'INCOMPLETE_CONTEXT: REPROCESS_REQUIRED' : 'DATA_UNAVAILABLE');
  expect(answer.limitations.join()).not.toContain('MODEL_UNAVAILABLE');
});
it.each(['INVALID_MODEL_OUTPUT', 'MODEL_TIMEOUT', 'REQUEST_TIMEOUT'])('keeps %s distinct from a stopped model', async detail => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/answer')
    ? Promise.resolve(Response.json(detail === 'REQUEST_TIMEOUT' ? { error: detail } : { detail }, { status: 504 })) : original(url, init));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.limitations.join()).toContain(detail);
  expect(answer.limitations.join()).not.toContain('MODEL_UNAVAILABLE');
  expect(answer.citations).toEqual([]);
});
it('rejects incompatible reason/source combinations at the boundary', () => {
  expect(assistantEvidenceSchema.safeParse({ complete: false, reason: 'CONTEXT_BUDGET', sources }).success).toBe(false);
  expect(assistantEvidenceSchema.safeParse({ complete: true, reason: 'CONTEXT_BUDGET', sources: [] }).success).toBe(false);
});
it('discards evidence after an actor is revoked during generation', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => { const response = await original(url, init); if (String(url).endsWith('/v1/answer')) db.active = false; return response; });
  const response = await assistantQuery(request());
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe('FORBIDDEN');
});
it('reduces an oversized candidate union before expanding complete required context', async () => {
  const candidates = [...sources, ...Array.from({ length: 6 }, (_, i) => source(`Unrelated display label ${i}.`))];
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'assistant_search_knowledge') return Promise.resolve({ data: candidates, error: null });
    if (name === 'assistant_expand_evidence' && (args.p_chunks as string[]).length > 1) return Promise.resolve({ data: { complete: false, reason: 'CONTEXT_BUDGET', sources: [] }, error: null });
    return original(name, args);
  });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (!String(url).endsWith('/v1/context')) return originalFetch(url, init);
    const body = JSON.parse(String(init?.body)) as { sources: { chunk_id: string }[] };
    return Promise.resolve(Response.json({ chunk_ids: body.sources.filter(s => s.chunk_id === sources[0].chunk_id).map(s => s.chunk_id), ambiguous: false }));
  });
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.summary).toContain('Only management'); expect(answer.summary).not.toContain('kitchen');
  expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_expand_evidence')).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/v1/context'))).toHaveLength(1);
});
it('reports unverified document-wide coverage without silently narrowing a summary', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/plan')
    ? Promise.resolve(Response.json({ kind: 'DOCUMENT', query: 'Summarize the entire SOP', tools: [] })) : String(url).endsWith('/v1/context')
      ? Promise.resolve(Response.json({ chunk_ids: [], ambiguous: false, coverage: { scope: 'DOCUMENT_WIDE', outcome: 'INSUFFICIENT', gaps: ['Entire SOP coverage'] } })) : original(url, init));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('NO_RELEVANT_SOURCE');
  expect(answer.limitations.join()).not.toContain('AMBIGUOUS_SCOPE');
  expect(fetch).toHaveBeenCalledTimes(3);
});

// MS53-TC01/04: a six-source closure can exceed the wire budget even when
// PostgreSQL's source-count limit passes. Relevance selection must still run.
it('reduces a serialized oversized union before reporting an evidence budget failure', async () => {
  const candidates = [sources[0], ...Array.from({ length: 5 }, (_, i) => source(`Unrelated section ${i}. ` + 'Unrelated descriptive text. '.repeat(40)))];
  const originalRpc = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'assistant_search_knowledge') return Promise.resolve({ data: candidates, error: null });
    if (name === 'assistant_expand_evidence' && (args.p_chunks as string[]).length > 1) return Promise.resolve({ data: { complete: true, sources: candidates,
      groups: candidates.map((s,i) => ({ id: `unit${i}`, chunk_ids: [s.chunk_id], requires: [] })) }, error: null });
    return originalRpc(name, args);
  });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (!String(url).endsWith('/v1/context')) return originalFetch(url, init);
    const body = JSON.parse(String(init?.body)) as { sources: { chunk_id: string }[] };
    expect(Buffer.byteLength(String(init?.body))).toBeLessThanOrEqual(12000);
    return Promise.resolve(Response.json({ chunk_ids: body.sources.filter(s => s.chunk_id === sources[0].chunk_id).map(s => s.chunk_id), ambiguous: false }));
  });
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(answer.summary).toContain('Only management');
  expect(answer.limitations.join()).not.toContain('INCOMPLETE_EVIDENCE');
  expect(answer.business_timezone).toBe('Asia/Manila');
  expect(answer.evidence_spans).toHaveLength(2);
  expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_expand_evidence')).toHaveLength(1);
});

it('compares five near-match candidates coherently before expanding checkout dependencies', async () => {
  sources = [source(Array.from({ length: 8 }, (_, i) => `${i + 1}. Perform checkout step ${i + 1}.`).join('\n')),
    source('Do not charge automatic overtime or collect an unapproved fee. Collect outstanding payments only when applicable.')];
  groups = [{ id: 'checkout', chunk_ids: [sources[0].chunk_id], requires: ['conditions'] },
    { id: 'conditions', chunk_ids: [sources[1].chunk_id], requires: [] }];
  const candidates = [source('Close the facility at the end of the day.'), sources[0], source('Use the online payment checkout.'),
    source('Review the customer feedback procedure.'), source('Complete the end-of-day counter reconciliation.')];
  const originalRpc = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'assistant_search_knowledge') return Promise.resolve({ data: candidates, error: null });
    if (name === 'assistant_expand_evidence' && (args.p_chunks as string[]).some(id => id !== sources[0].chunk_id)) return Promise.resolve({
      data: { complete: false, reason: 'CONTEXT_BUDGET', sources: [] }, error: null });
    return originalRpc(name, args);
  });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (!String(url).endsWith('/v1/context')) return originalFetch(url, init);
    const body = JSON.parse(String(init?.body)) as { sources: { chunk_id: string }[] };
    // The observed live failure selected near matches in fragmented batches.
    // A coherent comparison can distinguish the requested complete procedure.
    return Promise.resolve(Response.json({ chunk_ids: body.sources.length === candidates.length
      ? [sources[0].chunk_id] : body.sources.map(s => s.chunk_id), ambiguous: false }));
  });
  const answer = (await (await assistantQuery(request('how do i checkout a customer'))).json()).data;
  expect(answer.limitations.join()).not.toContain('INCOMPLETE_EVIDENCE');
  expect(answer.summary).toContain('8. Perform checkout step 8.');
  expect(answer.summary).toContain('Do not charge automatic overtime');
  const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/v1/context'));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0][1]?.body)).sources).toHaveLength(5);
});

it('does not claim a missing request is waiting for capacity', async () => {
  const original = request();
  const body = await original.json();
  const response = await assistantProgress(new Request(original.url, { method: 'POST', headers: original.headers,
    body: JSON.stringify({ session_id: body.session_id, request_id: body.request_id }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { stage: 'checking' } });
});

it.each([false, true])('selects a corroborated unique procedure seed and full closure, including when the initial union fits (%s)', async initialFits => {
  sources = [source(Array.from({ length: 8 }, (_, i) => `${i + 1}. ${i === 4 ? 'Record customer check-out.' : `Verify customer session step ${i + 1}.`}`).join('\n')),
    source('Do not charge automatic overtime or collect an unapproved fee. Collect outstanding payments only when applicable.')];
  sources[0].heading_path = 'SOP / 4.2. Customer Check-Out';
  groups = [{ id: 'checkout', chunk_ids: [sources[0].chunk_id], requires: ['conditions'] },
    { id: 'conditions', chunk_ids: [sources[1].chunk_id], requires: [] }];
  const candidates = [source('End-of-day workflow overview.'), sources[0], source('Online payment checkout workflow.')];
  const originalRpc = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'assistant_search_knowledge') return Promise.resolve({ data: candidates, error: null });
    if (!initialFits && name === 'assistant_expand_evidence' && (args.p_chunks as string[]).length > 1) return Promise.resolve({ data: { complete: false, reason: 'CONTEXT_BUDGET', sources: [] }, error: null });
    return originalRpc(name, args);
  });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/context')
    ? Promise.resolve(Response.json({ chunk_ids: [sources[0].chunk_id], ambiguous: false })) : originalFetch(url, init));
  const answer = (await (await assistantQuery(request('how do i checkout a customer'))).json()).data;
  expect(answer.summary).toContain('8. Verify customer session step 8.');
  expect(answer.summary).toContain('Do not charge automatic overtime');
  expect(answer.citations).toHaveLength(2);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/context'))).toBe(true);
  expect(db.rpc.mock.calls.some(([name, args]) => name === 'assistant_expand_evidence' && args.p_chunks.length === 1 && args.p_chunks[0] === sources[0].chunk_id)).toBe(true);
});
