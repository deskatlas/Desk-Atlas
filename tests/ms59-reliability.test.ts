import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';

// MS59-TC01/09/10/11/13: real gateway, controlled DB/model boundaries.
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
it('MS59-TC10 retries the joint selection once and answers with complete evidence', async () => {
  const answer = await query();
  expect(answer.summary).toContain('Escalate repeated violations');
  expect(answer.citations).toHaveLength(1);
  expect(answer.presentation.version).toBe('ms59-v1');
  expect(selections).toBe(2); expect(expansions).toBe(2);
});
it('MS59-TC11 exhausted selection does not claim inherently excessive user scope', async () => {
  alwaysOverflow = true;
  const answer = await query();
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('SELECTION_EXHAUSTED');
  expect(selections).toBe(2); expect(expansions).toBe(2);
});
it('MS59-TC12 never retries unresolved required context', async () => {
  unsafe = true;
  const answer = await query();
  expect(answer.citations).toEqual([]);
  expect(selections).toBe(1); expect(expansions).toBe(1);
});
it('MS59-TC07 uses bounded semantic aids without requiring the hybrid SQL contract', async () => {
  const read = db.rpc.getMockImplementation()!;
  let searches = 0;
  db.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'assistant_search_knowledge' && ++searches === 1
    ? Promise.resolve({ error: null, data: [] }) : read(name, args));
  const fetchModel = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'A customer keeps being noisy. What should I do?', tools: [], search: { version: 'ms55-v1', original: 'A customer keeps being noisy. What should I do?', standalone: 'Repeated noise complaint response', alternatives: [] } });
    if (String(url).endsWith('/v1/embed-queries')) {
      const request = JSON.parse(String(init?.body));
      expect(request.queries.length).toBeGreaterThanOrEqual(1);
      expect(request.queries.length).toBeLessThanOrEqual(3);
      expect(request.queries.every((query: string) => query.startsWith('A customer keeps being noisy. What should I do?'))).toBe(true);
      return Response.json({ embeddings: request.queries.map(() => ({ vector: [1, ...Array(1023).fill(0)] })) });
    }
    return fetchModel(url, init);
  });
  const answer = await query();
  expect(answer.summary).toContain('Escalate repeated violations');
  expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_search_hybrid')).toBe(false);
});
it('MS59-TC14 unknown evidence admission version fails safely', async () => {
  vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'future');
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', { method: 'POST' }));
  expect(response.status).toBe(503);
});
it('MS59-TC14 old clients receive only the legacy answer fields', async () => {
  const answer = await query(true);
  expect(answer.summary).toContain('Escalate repeated violations');
  expect(answer.presentation).toBeUndefined();
});
