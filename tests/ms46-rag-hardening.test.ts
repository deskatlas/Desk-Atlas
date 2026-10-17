import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestBudget } from '../apps/admin-portal/src/server/assistant/budget';
import { assistantQuery, groundedQuotes } from '../apps/admin-portal/src/server/assistant/gateway';
import { KnowledgeClaimSchema, KnowledgeCompleteSchema } from '../packages/validation/src/knowledgeSchema';
import { assistantLanguage, assistantCopy } from '../packages/domain/src/services/assistantLanguage';
import { assistantToolNarrative } from '../packages/domain/src/services/assistantService';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { POST } from '../apps/admin-portal/src/app/api/internal/knowledge/jobs/[[...path]]/route';

// MS46-TC06..10/15/21; QAD-TC44/45/46. Synthetic boundary controls.
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), profile: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: (...args: unknown[]) => {
    const result = fixture.rpc(...args);
    return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve), abortSignal: () => result };
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: fixture.profile }) }) }),
  storage: { from: () => ({ remove: fixture.remove, list: fixture.list }) },
}) }));

beforeEach(() => {
  vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('KB_SCOPE_ID', 'synthetic');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', randomUUID());
  vi.stubEnv('KB_WORKER_TOKEN', randomUUID());
  vi.stubEnv('RAG_ENABLED', 'true'); vi.stubEnv('RAG_SERVICE_URL', 'http://127.0.0.1:8000');
  vi.stubEnv('RAG_SERVICE_TOKEN', randomUUID()); vi.stubEnv('RAG_CAPABILITY_SECRET', randomUUID());
  vi.stubEnv('RAG_SCOPE_ID', 'synthetic'); vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'a'.repeat(64));
  vi.stubEnv('RAG_MIN_SIMILARITY', '0.5');
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  fixture.profile.mockResolvedValue({ data: { kind: 'PURGE', role: 'ADMIN', is_active: true }, error: null });
  fixture.remove.mockResolvedValue({ error: null }); fixture.list.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function worker(path: string[], body: unknown = {}) {
  return POST(new Request(`http://localhost/api/internal/knowledge/jobs/${path.join('/')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.KB_WORKER_TOKEN}` }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ path }) });
}

describe('MS46-TC08/09/10: strict claim and verified physical cleanup', () => {
  it('accepts no work, rejects a terminal receipt masquerading as a claim', async () => {
    expect((await worker(['claim'])).status).toBe(200);
    expect(KnowledgeClaimSchema.safeParse({ job_id: randomUUID(), accepted: true }).success).toBe(false);
    fixture.rpc.mockResolvedValue({ data: { job_id: randomUUID(), accepted: true }, error: null });
    const response = await worker(['claim']);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('MANIFEST_INVALID');
    expect(fixture.remove).not.toHaveBeenCalled();
  });
  it('keeps errors recoverable and cannot accept a caller-supplied storage attestation', async () => {
    const lease = { lease_token: randomUUID(), generation: 2 };
    expect(KnowledgeCompleteSchema.safeParse({ ...lease, storage_verified: true }).success).toBe(false);
    fixture.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      error: null, data: args.p_operation === 'purge_targets'
        ? { source_object_key: 'synthetic/version/source', preview_object_key: null } : { accepted: true },
    }));
    fixture.list.mockResolvedValue({ data: [{ name: 'source' }], error: null });
    expect((await worker([randomUUID(), 'complete'], lease)).status).toBe(200);
    expect(fixture.rpc).toHaveBeenLastCalledWith('kb_worker_command', expect.objectContaining({ p_data: expect.objectContaining({ error_code: 'STORAGE_FAILED', retryable: true }) }));
    fixture.list.mockResolvedValue({ data: [], error: null });
    expect((await worker([randomUUID(), 'complete'], lease)).status).toBe(200);
    expect(fixture.rpc).toHaveBeenLastCalledWith('kb_worker_command', expect.objectContaining({ p_data: expect.objectContaining({ storage_verified: true }) }));
  });
  it('represents skipped pages and deterministic content failures without transient retries', () => {
    const data = KnowledgeCompleteSchema.parse({ lease_token: randomUUID(), generation: 1,
      error_code: 'CONTENT_LIMIT', warning_codes: ['BLANK_PAGE_SKIPPED'],
      extraction_manifest: [{ heading: '', page: 3, method: 'TEXT', outcome: 'SKIPPED_BLANK' }],
    });
    expect(data.retryable).toBe(false);
    expect(data.extraction_manifest[0].page).toBe(3);
  });
});

describe('MS46-TC06/07: completeness and fixed language copy', () => {
  it('refuses an exact answer that omits a separate exception', () => {
    const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(),
      title: 'Synthetic', heading_path: 'Counter', source_page: null, epoch: 1, extraction_method: 'TEXT',
      content_hash: 'a'.repeat(64), content: 'Staff may confirm counter payments.\n\nExcept online proofs: only admins approve them.' };
    expect(groundedQuotes({ quotes: [{ chunk_id: source.chunk_id, quote: source.content.split('\n\n')[0] }] }, [source], 'Who approves?').summary).toBe('');
    expect(groundedQuotes({ quotes: [{ chunk_id: source.chunk_id, quote: source.content }] }, [source], 'Who approves?').summary).toBe(source.content);
  });
  it.each([['How does it work?', 'en'], ['Paano ito gumagana?', 'tl'], ['Can staff approve ba?', 'taglish']] as const)('uses fixed copy for %s', (message, language) => {
    expect(assistantLanguage(message)).toBe(language);
    expect(assistantCopy(language).sourceLanguage).toBeTruthy();
    const narrative = assistantToolNarrative('workspace_availability', {
      tables: [{ title: 'Availability', columns: ['Desk', 'Name', 'Status'], rows: [['A', 'Desk A', 'AVAILABLE'], ['B', 'Desk B', 'OCCUPIED']] }],
      limitations: [], interpretation: [],
    }, language);
    expect(narrative).toContain('1'); expect(narrative).toContain('2');
  });
});

describe('MS46-TC15/16: arrival deadline includes ingress work', () => {
  it('deducts earlier time and promptly cancels a stage that ignores abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const budget = new RequestBudget(new AbortController().signal, 1000, performance.now() - 900);
    const pending = budget.run(() => new Promise<never>(() => undefined));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await rejected; expect(budget.signal.aborted).toBe(true); budget.close();
  });
  it('classifies client cancellation separately and releases listeners', async () => {
    const incoming = new AbortController(); const budget = new RequestBudget(incoming.signal, 1000);
    incoming.abort(); await expect(budget.run(async () => 1)).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    budget.close();
  });
  it('times out slow authentication before starting availability or inference', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubEnv('RAG_REQUEST_DEADLINE_MS', '1000');
    fixture.profile.mockImplementation(() => new Promise<never>(() => undefined));
    const pending = assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` }, body: '{}',
    }));
    await vi.advanceTimersByTimeAsync(1001);
    const response = await pending; expect(response.status).toBe(408);
    expect((await response.json()).error.code).toBe('REQUEST_TIMEOUT');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each(['availability', 'body'])('includes slow %s in the arrival budget', async stage => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubEnv('RAG_REQUEST_DEADLINE_MS', '1000');
    fixture.rpc.mockImplementation(() => stage === 'availability' ? new Promise<never>(() => undefined)
      : Promise.resolve({ data: { enabled: true, knowledge_epoch: 1 }, error: null }));
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } });
    const options: RequestInit & { duplex: 'half' } = { method: 'POST', duplex: 'half', body,
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` } };
    const pending = assistantQuery(new Request('http://localhost/api/assistant/query', options));
    await vi.advanceTimersByTimeAsync(1001);
    const response = await pending;
    expect((await response.json()).error.code).toBe('REQUEST_TIMEOUT');
    if (stage === 'body') expect(cancelled).toBe(true);
  });
});
