import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { assistantQuery, groundedQuotes } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { assistantContextSelectionSchema } from '../packages/validation/src/assistantSchema';
import { assistantEvidenceBudget } from '../packages/validation/src/assistantEvidenceBudget';

// MS56-TC01..10 / QAD-TC44: authenticated orchestration over controlled evidence.
const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1, active: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => {
    const result = () => ({ data: table === 'staff_profiles' ? { role: 'ADMIN', is_active: db.active }
      : table === 'business_settings' ? { timezone: 'Asia/Manila' } : { epoch: db.epoch, active_embedding_fingerprint: 'synthetic' }, error: null });
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const source = (content: string) => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(),
  title: 'Synthetic rooms', heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT',
  content_hash: createHash('sha256').update(content).digest('hex'), content });
let sources = [source('Rooms have desks.'), source('Rooms are not soundproof.')];
const complete = () => ({ scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [] });
let coverage: { scope: string; outcome: string; gaps: string[]; clarification?: string } = complete();
let candidates = sources;
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
    RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(),
    RAG_CAPABILITY_SECRET: randomUUID(), RAG_SCOPE_ID: 'synthetic', RAG_EMBEDDING_FINGERPRINT: 'synthetic', RAG_MIN_SIMILARITY: '0.5',
    RAG_SOP_FAST_PATH: 'false', RAG_HYBRID_RETRIEVAL: 'false' })) vi.stubEnv(key, value);
  db.epoch = 1; db.active = true; coverage = complete();
  sources = [source('Rooms have desks.'), source('Rooms are not soundproof.')];
  candidates = [sources[0], ...Array.from({ length: 7 }, (_, i) => source(`Unrelated facility topic ${i}.`))];
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === 'assistant_knowledge_availability' ? { enabled: true, knowledge_epoch: db.epoch }
      : name === 'assistant_search_knowledge' ? candidates
        : name === 'assistant_expand_evidence' ? { complete: true, sources,
          groups: sources.map((s, i) => ({ id: `unit${i}`, chunk_ids: [s.chunk_id], requires: i === 0 ? ['unit1'] : ['unit0'] })) }
          : sources.find(s => s.chunk_id === args.p_chunk) }));
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
    if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'Describe rooms and their price.', tools: [] });
    if (String(url).endsWith('/v1/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (String(url).endsWith('/v1/context')) {
      expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_expand_evidence')).toBe(false);
      const payload = JSON.parse(String(init?.body));
      expect(payload.sources).toHaveLength(candidates.length);
      expect(payload.contract_version).toBe(2);
      return Response.json({ chunk_ids: ['COMPLETE', 'PARTIAL_GENERAL'].includes(coverage.outcome) ? [sources[0].chunk_id] : [], ambiguous: coverage.outcome === 'CLARIFY', coverage });
    }
    const payload = JSON.parse(String(init?.body));
    expect(payload.required_chunk_ids).toEqual(sources.map(s => s.chunk_id));
    return Response.json({ quotes: sources.map(s => ({ chunk_id: s.chunk_id, quote: s.content })) });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const query = () => assistantQuery(new Request('http://localhost/api/assistant/query', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
    Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
  body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: 'Describe rooms and their price.' }),
}));
it('MS56-TC01 selects relevant support once before closure and retains a restriction absent from candidates', async () => {
  const response = await query();
  const answer = (await response.json()).data;
  expect(answer.summary).toContain('Rooms are not soundproof.');
  expect(answer.summary).not.toContain('Unrelated');
  const calls = db.rpc.mock.calls.filter(([name]) => name === 'assistant_expand_evidence');
  expect(calls).toHaveLength(1);
  expect(calls[0][1].p_chunks).toEqual([sources[0].chunk_id]);
});
it('MS56-TC03 labels safe partial general gaps only with a verified answer', async () => {
  coverage = { scope: 'MULTI_PART', outcome: 'PARTIAL_GENERAL', gaps: ['Room price'] };
  const answer = (await (await query()).json()).data;
  expect(answer.summary).toContain('Rooms have desks.');
  expect(answer.limitations.join()).toContain('PARTIAL_GENERAL: Not verified from retrieved passages: Room price');
});
it('MS56-TC04 rejects partial procedures at the gateway boundary', async () => {
  coverage = { scope: 'COMPLETE_PROCEDURE', outcome: 'PARTIAL_GENERAL', gaps: ['Required approval'] };
  const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('INVALID_MODEL_OUTPUT');
  expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_expand_evidence')).toBe(false);
});
it('MS56-TC05 independently rejects dropped contrary closure even if answer selection ignores it', () => {
  const groups = sources.map((s, i) => ({ id: `unit${i}`, chunk_ids: [s.chunk_id], requires: [] }));
  expect(groundedQuotes({ quotes: [{ chunk_id: sources[0].chunk_id, quote: sources[0].content }] }, sources,
    'Describe rooms.', groups, undefined, sources.map(s => s.chunk_id)).summary).toBe('');
});
it.each(['CONFLICT', 'INSUFFICIENT', 'CLARIFY'])('MS56-TC06 preserves %s as a distinct result', async outcome => {
  coverage = { scope: 'FACTUAL', outcome, gaps: outcome === 'INSUFFICIENT' ? ['Room details'] : [],
    ...(outcome === 'CLARIFY' ? { clarification: 'Do you mean interview rooms or shared desks?' } : {}) };
  const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]);
  if (outcome === 'CLARIFY') expect(answer.summary).toBe('Do you mean interview rooms or shared desks?');
  if (outcome === 'INSUFFICIENT') expect(answer.limitations.join()).toContain('Room details');
  expect(answer.limitations.join()).toContain(outcome === 'CONFLICT' ? 'CONFLICTING_SOURCES' : outcome === 'CLARIFY' ? 'AMBIGUOUS_SCOPE' : 'NO_RELEVANT_SOURCE');
});
it('MS56-TC08 rejects oversized joint comparison without silent truncation or independent batches', async () => {
  candidates = [sources[0], source('Unrelated. '.repeat(1400))];
  const answer = (await (await query()).json()).data;
  expect(answer.limitations.join()).toContain('Candidate comparison exceeds');
  expect(answer.limitations.join()).not.toContain('NO_RELEVANT_SOURCE');
  expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_expand_evidence')).toBe(false);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/context'))).toBe(false);
});
it('MS56-TC09 rejects revocation before emission', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const result = await original(url, init);
    if (String(url).endsWith('/v1/answer')) db.active = false;
    return result;
  });
  expect((await query()).status).toBe(403);
});
it('MS56-TC07 retains legacy schema compatibility but rejects invented or duplicate support', () => {
  expect(assistantContextSelectionSchema.safeParse({ chunk_ids: [sources[0].chunk_id], ambiguous: false }).success).toBe(true);
  expect(assistantContextSelectionSchema.safeParse({ chunk_ids: [sources[0].chunk_id, sources[0].chunk_id], ambiguous: false }).success).toBe(false);
  expect(assistantEvidenceBudget.request_bytes).toBe(12000);
});
it('MS56-TC07 prevents scoped partial answers from falling back to unreviewed structure', async () => {
  coverage = { scope: 'MULTI_PART', outcome: 'PARTIAL_GENERAL', gaps: ['Room price'] };
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name, args) => name === 'assistant_expand_evidence'
    ? Promise.resolve({ data: { complete: true, sources }, error: null }) : original(name, args));
  const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('review or reprocess');
  expect(answer.limitations.join()).not.toContain('PARTIAL_GENERAL');
});
it('MS56-TC04 does not accept a selector claim as reviewed document-wide coverage', async () => {
  coverage = { scope: 'DOCUMENT_WIDE', outcome: 'COMPLETE', gaps: [] };
  const answer = (await (await query()).json()).data;
  expect(answer.citations).toEqual([]);
  expect(answer.limitations.join()).toContain('Document-wide coverage has not been verified');
});
