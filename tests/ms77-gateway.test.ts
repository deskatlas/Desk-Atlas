// MS77-TC01/02/05/10/11/12/15: real gateway with isolated provider/storage seams.
import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const seams = vi.hoisted(() => ({ rpc: vi.fn(), candidates: vi.fn(), availability: vi.fn(), prices: vi.fn(), catalog: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: seams.rpc }) }));
vi.mock('../apps/customer-website/src/server/customer-assistant/spots', () => ({ publicSpotRepository: () => ({ candidates: seams.candidates, availability: seams.availability, prices: seams.prices }) }));
vi.mock('../apps/customer-website/src/server/customer-assistant/catalog', () => ({ readCustomerDiscoveryCatalog: seams.catalog }));
import { customerAssistantQuery, customerAssistantSession, customerAssistantSource } from '../apps/customer-website/src/server/customer-assistant/gateway';

const content = 'Guest reservations require first name, last name and email.';
const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Guest booking', heading_path: 'Booking', source_page: null,
  epoch: 2, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content };
let cookie: string;
const req = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3001/api/customer-assistant/query', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body),
});
const query = (message = 'Explain the booking process') => ({ message, session_id: randomUUID(), request_id: randomUUID(), generation: randomUUID() });
let provider: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.stubEnv('CUSTOMER_ASSISTANT_CATALOG_DISCOVERY', 'false');
  seams.catalog.mockReset().mockResolvedValue({ sources: [source], headings: [['Booking']] });
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true'); vi.stubEnv('CUSTOMER_ASSISTANT_ALLOWED_ORIGINS', 'http://localhost:3001');
  vi.stubEnv('RAG_CAPABILITY_SECRET', 'ms77-unit-secret-'.repeat(4)); vi.stubEnv('RAG_SCOPE_ID', 'test');
  vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'f'.repeat(64)); vi.stubEnv('RAG_SERVICE_URL', 'http://127.0.0.1:8000');
  vi.stubEnv('RAG_SERVICE_TOKEN', 'ms77-test-provider-token-'.repeat(2)); vi.stubEnv('RAG_MIN_SIMILARITY', '0.5'); vi.stubEnv('RAG_GOOGLE_AUTH', '');
  vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  seams.rpc.mockReset().mockImplementation(async (name: string) => ({ error: null, data:
    name === 'customer_assistant_control' ? { stage: 'checking', cancelled: false } :
    name === 'admit_public_assistant' ? { allowed: true } :
    name === 'customer_knowledge_availability' ? { enabled: true, knowledge_epoch: 2 } :
    name === 'customer_search_knowledge' ? [source] :
    name === 'customer_document_evidence' ? { contract: 'ms65-v1', epoch: 2, sources: [source] } : source,
  }));
  seams.candidates.mockResolvedValue({ spots: [], has_more: false });
  provider = vi.fn(async (url: URL, init: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/plan')) return Response.json({ kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }] });
    if (path.endsWith('/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
    if (path.endsWith('/knowledge-selection')) return Response.json({ chunk_ids: [source.chunk_id] });
    if (path.endsWith('/document-support')) return Response.json({ contract: 'ms65-v1', binding: createHash('sha256').update(String(init.body)).digest('hex'),
      outcome: 'COMPLETE', clarification: null, spans: [{ chunk_id: source.chunk_id, quote: content, start: 0, end: content.length }],
      synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', blocks: [{ kind: 'text', text: content, support: [0] }], gaps: [] }, counts: { bundles: 1, calls: 1, units: 1 } });
    throw new Error('Unexpected provider operation');
  });
  vi.stubGlobal('fetch', provider);
  cookie = '';
  const session = await customerAssistantSession(req({})); expect(session.status).toBe(200);
  cookie = session.headers.get('Set-Cookie')!.split(';')[0];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('answers public knowledge with no Customer ID and only CUSTOMER authority at every read', async () => {
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  const answer = await response.json(); expect(answer.summary).toBe(content); expect(answer.citations[0].chunk_id).toBe(source.chunk_id);
  expect(seams.rpc.mock.calls.filter(([name]) => name.startsWith('customer_') && name !== 'customer_assistant_control').every(([, args]) => args.p_principal === 'PUBLIC_VISITOR')).toBe(true);
  for (const [, init] of provider.mock.calls) {
    const cap = JSON.parse(Buffer.from(String(init.headers['X-Request-Capability']).split('.')[0], 'base64url').toString());
    expect(cap.principal).toBe('PUBLIC_VISITOR'); expect(cap.audiences).toEqual(['CUSTOMER']); expect(cap.ops).not.toContain('owned_bookings');
  }
});

it('revalidates all inspected originals in one snapshot, including uncited context', async () => {
  const context = { ...source, chunk_id: randomUUID(), content: 'Uncited decision-changing condition.',
    content_hash: createHash('sha256').update('Uncited decision-changing condition.').digest('hex') };
  const original = seams.rpc.getMockImplementation()!;
  let snapshots = 0;
  seams.rpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === 'customer_document_evidence') {
      snapshots++;
      return { error: null, data: { contract: 'ms65-v1', epoch: 2,
        sources: snapshots === 1 ? [source, context] : [source, { ...context, content: 'Changed condition.' }] } };
    }
    return original(name, args);
  });
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'KNOWLEDGE_CHANGED' });
  expect(snapshots).toBe(2);
});

it('uses one final document snapshot instead of a round trip per citation', async () => {
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(200);
  expect(seams.rpc.mock.calls.filter(([name]) => name === 'customer_document_evidence')).toHaveLength(2);
  expect(seams.rpc.mock.calls.filter(([name]) => name === 'customer_read_source')).toHaveLength(0);
});

it('preserves upstream customer capacity rejection and its bounded retry interval', async () => {
  provider.mockImplementation(async () => Response.json({ error: 'CAPACITY_BUSY' }, { status: 429, headers: { 'Retry-After': '7' } }));
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('7');
  expect(await response.json()).toEqual({ error: 'CAPACITY_BUSY' });
});
it('discovers current customer documents without embedding while preserving full evidence and release checks', async () => {
  vi.stubEnv('CUSTOMER_ASSISTANT_CATALOG_DISCOVERY', 'true');
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true');
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/catalog-plan')
    ? Response.json({ plan: { kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }] }, chunk_ids: [source.chunk_id] }) : original(url, init));
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(200); expect((await response.json()).summary).toBe(content);
  expect(seams.catalog).toHaveBeenCalledOnce();
  expect(provider.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v1/customer/catalog-plan', '/v1/customer/document-support']);
  expect(seams.rpc.mock.calls.some(([name]) => name === 'customer_document_evidence')).toBe(true);
  expect(seams.rpc.mock.calls.some(([name]) => name === 'customer_search_knowledge')).toBe(false);
  expect(response.headers.get('server-timing')).toContain('model_catalog_plan;dur=');
  expect(response.headers.get('server-timing')).not.toContain(content);
});
it('rejects a catalog selector that invents a source or a forbidden operation', async () => {
  vi.stubEnv('CUSTOMER_ASSISTANT_CATALOG_DISCOVERY', 'true');
  provider.mockImplementation(async () => Response.json({ plan: { kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }] }, chunk_ids: [randomUUID()] }));
  let response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(503);
  expect(seams.rpc.mock.calls.some(([name]) => name === 'customer_document_evidence')).toBe(false);
  provider.mockImplementation(async () => Response.json({ plan: { kind: 'KNOWLEDGE', operations: [{ name: 'payment_report' }] }, chunk_ids: [source.chunk_id] }));
  response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(400);
});
it('answers broad suitability from approved knowledge when the physical catalog is too large to rank', async () => {
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/plan')
    ? Response.json({ kind: 'WORKSPACE', operations: [{ name: 'customer_knowledge' }, { name: 'public_workspace' }] }) : original(url, init));
  seams.candidates.mockResolvedValue({ spots: [], has_more: true });
  const response = await customerAssistantQuery(req(query('Solo lang ako, may online interview ako. Saan okay?')));
  const answer = await response.json();
  expect(answer.kind).toBe('ANSWER'); expect(answer.summary).toBe(content);
  expect(answer.suggestions).toEqual([]);
  expect(answer.limitations.join(' ')).toContain('general workspace-type guidance');
});
it('still narrows an explicit live availability request rather than ranking a truncated catalog', async () => {
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }] }));
  seams.candidates.mockResolvedValue({ spots: [], has_more: true });
  const response = await customerAssistantQuery(req(query('Which desks are available?')));
  expect((await response.json()).kind).toBe('CLARIFY'); expect(provider).toHaveBeenCalledTimes(1);
});
it('private questions trigger verification before knowledge lookup or provider spend, without echoing identifiers', async () => {
  const response = await customerAssistantQuery(req(query('Explain my reservation reference code SECRET-REF')));
  const answer = await response.json(); expect(answer.kind).toBe('VERIFY_REQUIRED'); expect(JSON.stringify(answer)).not.toContain('SECRET-REF');
  expect(provider).not.toHaveBeenCalled(); expect(seams.rpc.mock.calls.some(([name]) => name.includes('knowledge'))).toBe(false);
});
it.each(['What is a Customer ID?', 'Where is the reference code used?'])('answers general policy questions without verification: %s', async message => {
  const response = await customerAssistantQuery(req(query(message)));
  expect(response.status).toBe(200);
  const answer = await response.json();
  expect(answer.kind).toBe('ANSWER'); expect(answer.summary).toBe(content);
});
it.each(['UNRESOLVED_CONTEXT', 'CONFLICTING_SOURCES', 'CONTEXT_BUDGET_EXCEEDED', 'OUTPUT_BUDGET_EXCEEDED'])('explains a knowledge evidence gap without claiming a service outage: %s', async code => {
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/document-support')
    ? Response.json({ detail: code }, { status: 400 }) : original(url, init));
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(200);
  const answer = await response.json();
  expect(answer.kind).toBe('CLARIFY');
  expect(answer.summary).not.toMatch(/temporarily unavailable/i);
  expect(answer.citations).toEqual([]);
  expect(answer.summary.length).toBeGreaterThan(20);
});
it('rejects shared quotas and capacity before invoking providers, with Retry-After', async () => {
  const original = seams.rpc.getMockImplementation()!;
  seams.rpc.mockImplementation(async (name: string, args: unknown) => name === 'admit_public_assistant' ? { data: { allowed: false, retry_after: 113 }, error: null } : original(name, args));
  let response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('113'); expect(provider).not.toHaveBeenCalled();
  seams.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'customer_assistant_control' && args.p_operation === 'claim'
    ? { data: null, error: { message: 'RATE_LIMITED' } } : name === 'admit_public_assistant' ? { data: { allowed: true }, error: null } : original(name, args));
  response = await customerAssistantQuery(req(query())); expect(response.status).toBe(429); expect(provider).not.toHaveBeenCalled();
});
it('asks for schedule or narrower candidate scope before embeddings and composition', async () => {
  const original = seams.rpc.getMockImplementation()!;
  seams.rpc.mockImplementation(async (name: string, args: unknown) => name === 'customer_knowledge_availability' ? { error: null, data: { enabled: false, knowledge_epoch: 2 } } : original(name, args));
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }] }));
  const response = await customerAssistantQuery(req(query('Help me choose a spot')));
  expect((await response.json()).kind).toBe('CLARIFY'); expect(provider).toHaveBeenCalledTimes(1);
  expect(seams.availability).not.toHaveBeenCalled(); expect(seams.prices).not.toHaveBeenCalled();
});
it('withdrawn publications invalidate the complete response at release', async () => {
  let reads = 0; const original = seams.rpc.getMockImplementation()!;
  seams.rpc.mockImplementation(async (name: string, args: unknown) => name === 'customer_knowledge_availability'
    ? { error: null, data: { enabled: true, knowledge_epoch: ++reads === 1 ? 2 : 3 } } : original(name, args));
  const response = await customerAssistantQuery(req(query())); expect(response.status).toBe(409); expect(await response.text()).not.toContain(content);
});
it('source views recheck publication and return inert sanitized excerpts without original file URLs', async () => {
  const response = await customerAssistantSource(req({ version_id: source.version_id, chunk_id: source.chunk_id }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ excerpt: content, title: source.title, knowledge_epoch: 2 });
  expect(seams.rpc).toHaveBeenCalledWith('customer_read_source', expect.objectContaining({ p_principal: 'PUBLIC_VISITOR' }));
});
it('rejects a source selector introducing a chunk outside authorized search results', async () => {
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/knowledge-selection')
    ? Response.json({ chunk_ids: [randomUUID()] }) : original(url, init));
  const response = await customerAssistantQuery(req(query()));
  expect(response.status).toBe(503);
  expect(seams.rpc.mock.calls.some(([name]) => name === 'customer_document_evidence')).toBe(false);
});
it('rejects forged cookies and forbidden tool escalation before protected reads', async () => {
  let response = await customerAssistantQuery(req(query(), { cookie: `da_assistant_visitor=${randomUUID()}` }));
  expect(response.status).toBe(401); expect(provider).not.toHaveBeenCalled();
  provider.mockImplementation(async () => Response.json({ kind: 'KNOWLEDGE', operations: [{ name: 'payment_report' }] }));
  response = await customerAssistantQuery(req(query())); expect(response.status).toBe(400);
  expect(seams.rpc.mock.calls.some(([name]) => name === 'customer_search_knowledge')).toBe(false);
});
