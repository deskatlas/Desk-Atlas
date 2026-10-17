import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

const db = vi.hoisted(() => ({ rpc: vi.fn(), active: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => {
    const result = () => ({ data: table === 'staff_profiles' ? { role: 'ADMIN', is_active: db.active }
      : table === 'business_settings' ? { timezone: 'Asia/Manila' } : { epoch: 1, active_embedding_fingerprint: 'synthetic' }, error: null });
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const message = 'How do I checkout a customer?';
const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic SOP', heading_path: 'SOP / Customer Check-Out',
  source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: '1. Verify the customer reservation.\n2. Record customer check-out.' };
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
    RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_HYBRID_RETRIEVAL: 'true', RAG_SOP_FAST_PATH: 'false',
    RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(), RAG_CAPABILITY_SECRET: randomUUID(),
    RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'synthetic', RAG_MIN_SIMILARITY: '0.5' })) vi.stubEnv(key, value);
  db.active = true;
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === 'assistant_knowledge_availability' ? { enabled: true, knowledge_epoch: 1 }
      : name === 'assistant_search_hybrid' ? { semantic: [[], []], lexical: [[source], [source]] }
        : name === 'assistant_expand_evidence' ? { complete: true, sources: [source], groups: [{ id: 'steps', chunk_ids: [source.chunk_id], requires: [] }] }
          : args.p_chunk === source.chunk_id ? source : null }));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: message, tools: [],
      search: { version: 'ms55-v1', original: message, standalone: 'Customer check out', alternatives: [] } });
    if (String(url).endsWith('/v1/embed-queries')) return Response.json({ embeddings: body.queries.map(() => ({ vector: [1, ...Array(1023).fill(0)] })) });
    return Response.json({ quotes: [{ chunk_id: source.chunk_id, quote: source.content }] });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function request() {
  return new Request('http://localhost/api/assistant/query', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
    Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
  body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message }) });
}
it('MS55-TC05/07: lexical-only evidence reaches excerpt verification and final authorization', async () => {
  const response = await assistantQuery(request());
  const answer = (await response.json()).data;
  expect(response.status).toBe(200); expect(answer.summary).toBe(source.content); expect(answer.citations).toHaveLength(1);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls.filter(([url]) => String(url).endsWith('/v1/plan'))).toHaveLength(1);
  expect(calls.filter(([url]) => String(url).endsWith('/v1/embed-queries'))).toHaveLength(1);
  expect(calls.some(([url]) => String(url).endsWith('/v1/embed'))).toBe(false);
  const retrieval = db.rpc.mock.calls.filter(([name]) => name === 'assistant_search_hybrid');
  expect(retrieval).toHaveLength(1);
  expect(retrieval[0][1].p_queries.every((query: string) => query.startsWith(message))).toBe(true);
  expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_read_source')).toBe(true);
  expect(JSON.parse(String(calls.find(([url]) => String(url).endsWith('/v1/answer'))?.[1]?.body)).query).toBe(message);
});
it('MS55-TC08: branch outage is unavailable, never an empty knowledge result', async () => {
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'assistant_search_hybrid'
    ? Promise.resolve({ data: null, error: { message: 'private database detail' } }) : original(name, args));
  const result = await (await assistantQuery(request())).json();
  expect(result.data.citations).toEqual([]);
  expect(result.data.limitations.join()).toContain('DATA_UNAVAILABLE');
  expect(JSON.stringify(result)).not.toMatch(/private database detail|NO_RELEVANT_SOURCE/);
});
it('MS55-TC06/09: revocation after lexical retrieval withholds every source', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => { const response = await original(url, init); if (String(url).endsWith('/v1/answer')) db.active = false; return response; });
  expect((await assistantQuery(request())).status).toBe(403);
});
it('MS55-TC03: returns one focused clarification without searching ambiguous intent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'CLARIFY', query: '', tools: [], clarification: 'Do you mean guest departure or online payment checkout?' })));
  const response = await assistantQuery(request());
  const answer = (await response.json()).data;
  expect(answer.summary).toBe('Do you mean guest departure or online payment checkout?');
  expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_search_hybrid')).toBe(false);
});

it('QAD-TC44: a nonempty weak semantic hit cannot suppress bounded search aids', async () => {
  vi.stubEnv('RAG_HYBRID_RETRIEVAL', 'false');
  const unrelated = { ...source, chunk_id: randomUUID(), heading_path: 'SOP / Supplies', content: 'Replenish pantry supplies.' };
  const rpc = db.rpc.getMockImplementation()!;
  let searches = 0;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'assistant_search_knowledge'
    ? Promise.resolve({ data: ++searches === 1 ? [unrelated] : [source], error: null }) : rpc(name, args));
  const model = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/embed')
    ? Promise.resolve(Response.json({ vector: [1, ...Array(1023).fill(0)] }))
    : String(url).endsWith('/v1/context') ? Promise.resolve(Response.json({ chunk_ids: [source.chunk_id], ambiguous: false,
      coverage: { scope: 'COMPLETE_PROCEDURE', outcome: 'COMPLETE', gaps: [] } })) : model(url, init));
  const answer = (await (await assistantQuery(request())).json()).data;
  expect(searches).toBe(2);
  expect(answer.summary).toBe(source.content);
  const calls = vi.mocked(fetch).mock.calls;
  const batch = calls.find(([url]) => String(url).endsWith('/v1/embed-queries'));
  expect(batch).toBeDefined();
  expect(JSON.parse(String(batch?.[1]?.body)).queries.every((query: string) => query.startsWith(message))).toBe(true);
});
