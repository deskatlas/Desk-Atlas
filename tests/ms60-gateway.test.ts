import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

// MS60-TC08/12/15/28: real gateway, controlled DB/model boundaries.
const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1 }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => {
    const result = () => ({ data: table === 'staff_profiles' ? { role: 'ADMIN', is_active: true }
      : table === 'business_settings' ? { timezone: 'Asia/Manila' } : { epoch: db.epoch, active_embedding_fingerprint: 'synthetic' }, error: null });
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const makeSource = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Synthetic SOP', heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content });
let sources = [makeSource('Ask customers to lower their voices. Escalate repeated violations to the manager.')];
let candidates = sources;
let selections = 0, expansions = 0, alwaysOverflow = false, unsafe = false;
beforeEach(() => {
  db.epoch = 1; selections = 0; expansions = 0; alwaysOverflow = false; unsafe = false;
  sources = [makeSource('Ask customers to lower their voices. Escalate repeated violations to the manager.')];
  candidates = [...sources, makeSource('Be professional.'), makeSource('Report concerns.')];
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: randomUUID(), RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(), RAG_CAPABILITY_SECRET: randomUUID(), RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'synthetic', RAG_MIN_SIMILARITY: '0.5', RAG_SYNTHESIS_ENABLED: 'false', RAG_EVIDENCE_CONTRACT: 'ms59-v1' })) vi.stubEnv(key, value);
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === 'assistant_knowledge_availability' ? { enabled: true, knowledge_epoch: db.epoch }
      : name === 'assistant_search_knowledge' ? candidates
        : name === 'assistant_evidence_costs' ? { version: 3, epoch: 1, roots: candidates.map(s => ({ chunk_id: s.chunk_id, complete: true, members: [s.chunk_id], source_count: 1, bytes: 200 })) }
          : name.startsWith('assistant_expand_evidence') ? (++expansions && unsafe ? { complete: false, reason: 'UNRESOLVED_CONTEXT', sources: [] } : expansions === 1 || alwaysOverflow ? { complete: false, reason: 'CONTEXT_BUDGET', sources: [] } : { complete: true, sources, groups: [{ id: 'unit', chunk_ids: [sources[0].chunk_id], requires: [] }] })
            : sources.find(s => s.chunk_id === args.p_chunk) }));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return Response.json({ version: 'ms60-v1', binding: createHash('sha256').update(String(init?.body)).digest('hex'), quote_count: 1, max_quote_utf16: 100, fits: true, reason: null });
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'A customer keeps being noisy. What should I do?', tools: [] });
    if (String(url).endsWith('/v1/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (String(url).endsWith('/v1/context')) {
      selections++;
      const payload = JSON.parse(String(init?.body));
      if (selections === 2) expect(payload.reconsider).toBe(true);
      return Response.json({ chunk_ids: selections === 1 ? candidates.map(s => s.chunk_id) : [sources[0].chunk_id], ambiguous: false, obligations: [{ id: 'o0', request: 'Handle repeated noise', kind: 'RECOMMENDATION', status: 'SUPPORTED', chunk_ids: [sources[0].chunk_id] }], coverage: { scope: 'RECOMMENDATION', outcome: 'COMPLETE', gaps: [] } });
    }
    return Response.json({ quotes: sources.map(s => ({ chunk_id: s.chunk_id, quote: s.content })) });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function query(legacy = false) {
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(!legacy ? { 'X-DeskAtlas-Answer-Contract': 'ms59-v1' } : {}), Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` }, body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: 'A customer keeps being noisy. What should I do?' }) }));
  return (await response.json()).data;
}
it('MS60-TC08 packed overflow shares the existing reconsideration and expansion ceiling', async () => {
  let packing = 0;
  const model = vi.mocked(fetch).getMockImplementation()!;
  const read = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name.startsWith('assistant_expand_evidence')
    ? Promise.resolve({ error: null, data: { complete: true, sources, groups: [{ id: 'unit', chunk_ids: [sources[0].chunk_id], requires: [] }] } }) : read(name, args));
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) {
      packing++;
      return Response.json({ version: 'ms60-v1', binding: createHash('sha256').update(String(init?.body)).digest('hex'), quote_count: packing === 1 ? 7 : 1, max_quote_utf16: 100, fits: packing !== 1, reason: packing === 1 ? 'OUTPUT_BUDGET_EXCEEDED' : null });
    }
    if (String(url).endsWith('/v1/context')) {
      const payload = JSON.parse(String(init?.body));
      expect(payload.reliability_contract).toBe('ms60-v1');
      expect(payload.original_query).toBe('A customer keeps being noisy. What should I do?');
      expect(payload.sources[0].content).toBe(candidates[0].content);
      expect(payload.sources[0].content_hash).toBeUndefined();
    }
    return model(url, init);
  });
  const answer = await query();
  expect(answer.summary).toContain('Escalate');
  expect(packing).toBe(2);
  expect(selections).toBe(2);
});
it('MS60-TC28 mismatched packing binding cannot release evidence', async () => {
  const model = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/evidence-cost')
    ? Promise.resolve(Response.json({ version: 'ms60-v1', binding: '0'.repeat(64), quote_count: 1, max_quote_utf16: 100, fits: true, reason: null })) : model(url, init));
  const answer = await query();
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('INVALID_MODEL_OUTPUT');
});
it('QAD-TC44 malformed model clarification retries within two selection calls', async () => {
  const model = vi.mocked(fetch).getMockImplementation()!;
  const read = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name.startsWith('assistant_expand_evidence')
    ? Promise.resolve({ error: null, data: { complete: true, sources, groups: [{ id: 'unit', chunk_ids: [sources[0].chunk_id], requires: [] }] } }) : read(name, args));
  let calls = 0;
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith('/v1/context')) {
      calls++;
      return Promise.resolve(Response.json(calls === 1
        ? { chunk_ids: [], ambiguous: true, coverage: { scope: 'FACTUAL', outcome: 'CLARIFY', gaps: [], clarification: 'The user wants guidance.' } }
        : { chunk_ids: [sources[0].chunk_id], ambiguous: false, coverage: { scope: 'RECOMMENDATION', outcome: 'COMPLETE', gaps: [] }, obligations: [{ id: 'o0', request: 'Noise guidance', kind: 'RECOMMENDATION', status: 'SUPPORTED', chunk_ids: [sources[0].chunk_id] }] }));
    }
    return model(url, init);
  });
  const result = await query();
  expect(calls).toBe(2);
  expect(result.summary).toContain('Escalate');
  expect(result.summary).not.toContain('The user');
});
it('MS60-TC12 expansion retry followed by packed overflow never gets a third selection', async () => {
  const model = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/evidence-cost')
    ? Promise.resolve(Response.json({ version: 'ms60-v1', binding: createHash('sha256').update(String(init?.body)).digest('hex'), quote_count: 7, max_quote_utf16: 100, fits: false, reason: 'OUTPUT_BUDGET_EXCEEDED' })) : model(url, init));
  const answer = await query();
  expect(answer.citations).toEqual([]);
  expect(selections).toBe(2);
  expect(expansions).toBe(2);
  expect(answer.limitations.join()).toContain('SELECTION_EXHAUSTED');
});
