import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { AssistantDiagnostics } from '../apps/admin-portal/src/server/assistant/diagnostics';

// MS54-TC01/04/05/06/08: precise outcomes at the authenticated gateway seam.
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
    RAG_DIAGNOSTICS_ENABLED: 'true', RAG_ENABLED: 'true', KB_ENABLED: 'true', RAG_SERVICE_URL: 'http://127.0.0.1:8000', RAG_SERVICE_TOKEN: randomUUID(),
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
it('distinguishes post-retrieval coverage rejection from missing retrieval for natural and heading queries', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/answer')
    ? Promise.resolve(Response.json({ quotes: [{ chunk_id: sources[0].chunk_id, quote: sources[0].content }] })) : original(url, init));
  for (const question of ['Can employees suggest improvements to the SOP?', 'Explain the SOP improvement section.']) {
    const response = await assistantQuery(request(question));
    const diagnostics = JSON.parse(response.headers.get('X-RAG-Diagnostics')!);
    expect(diagnostics.counts.candidate_count).toBe(1);
    expect(diagnostics.counts.closure_count).toBeGreaterThan(1);
    expect(diagnostics.failures).toContainEqual({ stage: 'grounding', reason: 'INCOMPLETE_COVERAGE', category: 'verification_failure' });
    expect((await response.json()).data.citations).toHaveLength(0);
    expect(JSON.stringify(diagnostics)).not.toContain(sources[0].content);
    expect(diagnostics.ranked_units).toHaveLength(1);
  }
});
it.each(['CONTEXT_BUDGET', 'REPROCESS_REQUIRED', 'UNRESOLVED_CONTEXT'])('attributes %s to closure independently of generation', async reason => {
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name, args) => name === 'assistant_expand_evidence'
    ? Promise.resolve({ error: null, data: { complete: false, reason, sources: [] } }) : original(name, args));
  const response = await assistantQuery(request());
  const diagnostics = JSON.parse(response.headers.get('X-RAG-Diagnostics')!);
  expect(diagnostics.failures).toContainEqual({ stage: 'expand', reason,
    category: reason === 'CONTEXT_BUDGET' ? 'overflow' : 'unresolved_context' });
});
it.each(['OUTPUT_BUDGET_EXCEEDED', 'CONTEXT_BUDGET_EXCEEDED', 'INVALID_MODEL_OUTPUT', 'MODEL_TIMEOUT'])('preserves the precise upstream %s reason', async reason => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith('/v1/answer')
    ? Promise.resolve(Response.json({ detail: reason }, { status: 503 })) : original(url, init));
  const response = await assistantQuery(request());
  const diagnostics = JSON.parse(response.headers.get('X-RAG-Diagnostics')!);
  expect(diagnostics.failures.some((failure: { reason: string; stage: string }) => failure.reason === reason && failure.stage === 'answer')).toBe(true);
  expect(diagnostics.counts.candidate_count).toBe(1);
});
it('retains the independent final source verification and reports a changed epoch', async () => {
  const original = db.rpc.getMockImplementation()!;
  db.rpc.mockImplementation((name, args) => name === 'assistant_read_source'
    ? Promise.resolve({ error: null, data: { ...sources[0], epoch: 2 } }) : original(name, args));
  const response = await assistantQuery(request());
  expect(response.status).toBe(409);
  const diagnostics = JSON.parse(response.headers.get('X-RAG-Diagnostics')!);
  expect(diagnostics.failures).toContainEqual({ stage: 'evidence', reason: 'KNOWLEDGE_CHANGED', category: 'knowledge_identity_change' });
  expect((await response.json()).data).toBeUndefined();
});
it('emits no diagnostics when disabled or before successful authorization', async () => {
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'false');
  expect((await assistantQuery(request())).headers.has('X-RAG-Diagnostics')).toBe(false);
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true'); db.active = false;
  expect((await assistantQuery(request())).headers.has('X-RAG-Diagnostics')).toBe(false);
});
it('bounds content-free metadata and rejects arbitrary error text', () => {
  const diagnostics = new AssistantDiagnostics(true); diagnostics.authorize();
  for (let i = 0; i < 100; i++) diagnostics.error(new Error('private secret source body'));
  diagnostics.units('ranked', Array.from({ length: 20 }, () => randomUUID()));
  const raw = diagnostics.finish(Response.json({})).headers.get('X-RAG-Diagnostics')!;
  expect(raw).not.toContain('private');
  expect(JSON.parse(raw).failures).toHaveLength(12);
  expect(JSON.parse(raw).ranked_units).toHaveLength(6);
  expect(raw.length).toBeLessThan(3000);
});
