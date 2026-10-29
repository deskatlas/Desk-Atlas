// MS77-TC01/02/05/10/11/12/15: real gateway with isolated provider/storage seams.
import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const seams = vi.hoisted(() => ({ rpc: vi.fn(), candidates: vi.fn(), availability: vi.fn(), prices: vi.fn(), catalog: vi.fn(), resolveContext: vi.fn(), overview: vi.fn(), workspaceTypes: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: seams.rpc }) }));
vi.mock('../apps/customer-website/src/server/customer-assistant/spots', () => ({ publicSpotRepository: () => ({ candidates: seams.candidates, availability: seams.availability, prices: seams.prices }), resolvePublicWorkspaceContext: seams.resolveContext, publicWorkspaceOverview: seams.overview, publicWorkspaceTypes: seams.workspaceTypes }));
vi.mock('../apps/customer-website/src/server/customer-assistant/catalog', () => ({ readCustomerDiscoveryCatalog: seams.catalog }));
import { customerAssistantQuery, customerAssistantSession, customerAssistantSource } from '../apps/customer-website/src/server/customer-assistant/gateway';

const content = 'Guest reservations require first name, last name and email.';
const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Guest booking', heading_path: 'Booking', source_page: null,
  epoch: 2, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content };
let cookie: string;
const req = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3001/api/customer-assistant/query', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body),
});
const query = (message = 'Explain the booking process') => ({ conversation_contract: 'constraints-v1', message, session_id: randomUUID(), request_id: randomUUID(), generation: randomUUID() });
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
  seams.resolveContext.mockReset(); seams.overview.mockReset();
  seams.workspaceTypes.mockReset().mockResolvedValue([]);
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

// PRD-F26 / QAD-TC44/46: regressions from the October 29 public browser audit.
it('resolves an anaphoric follow-up against the latest topic instead of older payment and cancellation topics', async () => {
  const response = await customerAssistantQuery(req({ ...query('Okay, what happens after that?'),
    user_turns: ['How do I pay online?', 'Can I cancel?', 'Do you have Wi-Fi?', 'Can I walk in without reserving first?'] }));
  expect(response.status).toBe(200);
  const planned = JSON.parse(String(provider.mock.calls[0][1].body)) as { message: string; user_turns: string[] };
  expect(planned.user_turns).toEqual(['Can I walk in without reserving first?']);
  const documentCall = provider.mock.calls.find(([url]) => String(url).endsWith('/document-support'))!;
  expect(JSON.parse(String(documentCall[1].body)).query).toContain('Can I walk in without reserving first?');
});

it('resolves a repeated continuation to the latest named topic without adding model calls', async () => {
  const response = await customerAssistantQuery(req({ ...query('Okay, what happens after that?'),
    user_turns: ['Can I cancel online?', 'Can I walk in without reserving first?', 'Okay, what happens after that?'] }));
  expect(response.status).toBe(200);
  const planned = JSON.parse(String(provider.mock.calls[0][1].body)) as { message: string; user_turns: string[] };
  expect(planned.message).toContain('Active customer channel: on-site walk-in at the kiosk.');
  expect(planned.user_turns).toEqual(['Can I walk in without reserving first?']);
  expect(provider.mock.calls.filter(([url]) => String(url).endsWith('/plan'))).toHaveLength(1);
  expect(provider.mock.calls.filter(([url]) => String(url).endsWith('/document-support'))).toHaveLength(1);
});

it.each(['WORKSPACE', 'KNOWLEDGE'])('supplies and revalidates current capacities for recommendations classified as %s', async kind => {
  const facts = [{ template_id: randomUUID(), name: 'Sky Booth', capacity: 1, hourly_rate: 100 }];
  seams.workspaceTypes.mockResolvedValue(facts);
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/plan')
    ? Response.json({ kind, ...(kind === 'WORKSPACE' ? { workspace_mode: 'GUIDANCE' } : {}), operations: [{ name: 'customer_knowledge' }, { name: 'public_workspace' }] }) : original(url, init));
  const response = await customerAssistantQuery(req(query('What do you recommend for study and video calls?')));
  expect(response.status).toBe(200);
  const documentCall = provider.mock.calls.find(([url]) => String(url).endsWith('/document-support'))!;
  expect(JSON.parse(String(documentCall[1].body)).workspace_catalog).toEqual(facts);
  expect(seams.workspaceTypes).toHaveBeenCalledTimes(2);
  expect(provider.mock.calls.filter(([url]) => String(url).endsWith('/document-support'))).toHaveLength(1);
});

it('withdraws a recommendation if current capacity changes before release', async () => {
  const facts = [{ template_id: randomUUID(), name: 'Sky Booth', capacity: 1, hourly_rate: 100 }];
  seams.workspaceTypes.mockResolvedValueOnce(facts).mockResolvedValueOnce([{ ...facts[0], capacity: 2 }]);
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/plan')
    ? Response.json({ kind: 'WORKSPACE', workspace_mode: 'GUIDANCE', operations: [{ name: 'customer_knowledge' }, { name: 'public_workspace' }] }) : original(url, init));
  const response = await customerAssistantQuery(req(query('Recommend a room for a video call')));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe('KNOWLEDGE_CHANGED');
});

it.each(['INVALID_MODEL_OUTPUT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'])('preserves a safe classified upstream failure: %s', async code => {
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/document-support')
    ? Response.json({ detail: code }, { status: code === 'MODEL_TIMEOUT' ? 504 : 503 }) : original(url, init));
  const response = await customerAssistantQuery(req(query()));
  expect((await response.json()).error).toBe(code);
  expect(provider.mock.calls.filter(([url]) => String(url).endsWith('/document-support'))).toHaveLength(1);
});

it('retains only allowlisted numeric upstream diagnostic spans', async () => {
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true');
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => {
    const response: Response = await original(url, init);
    response.headers.set('Server-Timing', 'inference;dur=1200.5, queue;dur=2, secret_prompt;dur=99');
    return response;
  });
  const response = await customerAssistantQuery(req(query()));
  expect(response.headers.get('server-timing')).toContain('upstream_document_support_inference;dur=1200.500');
  expect(response.headers.get('server-timing')).not.toContain('secret_prompt');
});

// PRD-F1-F4/F26 / MS77-TC01/05/08/12: audit conversational regressions.
it.each(['It is my first time here. How does booking work, and do I need an account?', 'How do I pay for my booking?'])(
  'keeps general first-person procedures public: %s', async message => {
    const result = await customerAssistantQuery(req(query(message)));
    expect((await result.json()).kind).toBe('ANSWER');
    expect(provider).toHaveBeenCalled();
  });
it('does not treat model search wording as a customer demand for live availability', async () => {
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => String(url).endsWith('/plan')
    ? Response.json({ kind: 'WORKSPACE', search_query: 'Which quiet desks are available?', operations: [{ name: 'public_workspace' }] }) : original(url, init));
  seams.candidates.mockResolvedValue({ spots: [], has_more: true });
  const result = await customerAssistantQuery(req(query('Hi! I need somewhere quiet to work today. What would you recommend?')));
  expect((await result.json()).kind).toBe('ANSWER');
});
it('asks only for missing duration after applying conversational schedule constraints', async () => {
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }],
    constraints: { relative_date: 'TODAY', start_time: '07:00', preferences: { group_size: 1 } } }));
  const result = await customerAssistantQuery(req(query('Just me, 7am today. Any desks available?')));
  const answer = await result.json();
  expect(result.status).toBe(200);
  expect(answer.summary).toMatch(/how long|duration/i);
  expect(answer.summary).not.toMatch(/which.*date.*start time/i);
  expect(answer.discovery.start_time).toBe('07:00');
  expect(answer.discovery.preferences.group_size).toBe(1);
  expect(seams.availability).not.toHaveBeenCalled();
});
it('resolves Focus Pod into a template before checking the candidate bound', async () => {
  const template_id = randomUUID();
  seams.resolveContext.mockImplementation(async context => ({ context: { ...context, template_id } }));
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }], workspace_mode: 'LIVE',
    constraints: { template_name: 'Focus Pod', relative_date: 'TODAY', start_time: '07:00', duration_minutes: 120, preferences: { group_size: 1 } } }));
  const result = await customerAssistantQuery(req(query('Just me, 7am for two hours today. A Focus Pod please.')));
  expect(result.status).toBe(200);
  expect(seams.candidates).toHaveBeenCalledWith(expect.objectContaining({ template_id, start_time: '07:00', duration_minutes: 120, preferences: { group_size: 1 } }));
});
it('answers type/rate overviews from the current public map and refuses changed snapshots', async () => {
  provider.mockImplementation(async () => Response.json({ kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }], workspace_mode: 'CATALOG' }));
  seams.overview.mockResolvedValue('Published Focus Pod: PHP 100 per hour.');
  let result = await customerAssistantQuery(req(query('What kinds of workspaces do you have, and roughly how much do they cost?')));
  expect((await result.json()).summary).toContain('PHP 100');
  seams.overview.mockResolvedValueOnce('old rate').mockResolvedValueOnce('new rate');
  result = await customerAssistantQuery(req(query('What types and rates?')));
  expect(result.status).toBe(409);
});
it('offers inert exact map labels when the scoped live catalog still exceeds twelve', async () => {
  const template_id = randomUUID(), floor_id = randomUUID();
  seams.resolveContext.mockImplementation(async context => ({ context, offered_names: ['Focus Pod Spot 1', 'Focus Pod Spot 2'] }));
  seams.candidates.mockResolvedValue({ spots: [], has_more: true });
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', workspace_mode: 'LIVE', operations: [{ name: 'public_workspace' }] }));
  const result = await customerAssistantQuery(req({ ...query('Which Focus Pods are available?'), discovery: {
    template_id, floor_id, date: '2026-11-01', start_time: '07:00', duration_minutes: 120 } }));
  const answer = await result.json();
  expect(answer.offered_names).toEqual(['Focus Pod Spot 1', 'Focus Pod Spot 2']);
  expect(answer.summary).toContain('availability not checked');
  expect(answer.suggestions).toEqual([]);
  expect(seams.availability).not.toHaveBeenCalled();
});
it('does not emit new response fields to an older strict ms77 browser', async () => {
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }],
    constraints: { relative_date: 'TODAY', start_time: '07:00' } }));
  const result = await customerAssistantQuery(req({ message: '7am today, any desks?', session_id: randomUUID(), request_id: randomUUID(), generation: randomUUID() }));
  const answer = await result.json();
  expect(result.status).toBe(200);
  expect(answer).not.toHaveProperty('discovery');
  expect(answer).not.toHaveProperty('offered_names');
});

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
// PRD-F26 / MS77-TC05/08: saved constraints apply to conversational suggestions.
it.each([false, true])('sends saved preferences to discovery and narrows instead of generic guidance (catalog=%s)', async catalog => {
  vi.stubEnv('CUSTOMER_ASSISTANT_CATALOG_DISCOVERY', String(catalog));
  const discovery = { preferences: { group_size: 10 } };
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async (url: URL, init: RequestInit) => {
    if (String(url).endsWith(catalog ? '/catalog-plan' : '/plan')) {
      expect(JSON.parse(String(init.body)).discovery).toEqual(discovery);
      const plan = { kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }] };
      return Response.json(catalog ? { plan, chunk_ids: [] } : plan);
    }
    return original(url, init);
  });
  seams.candidates.mockResolvedValue({ spots: [], has_more: true });
  const response = await customerAssistantQuery(req({ ...query('What is a good spot for us?'), discovery }));
  const answer = await response.json();
  expect(response.status).toBe(200);
  expect(answer.kind).toBe('CLARIFY');
  expect(answer.summary).toContain('10');
  expect(provider).toHaveBeenCalledOnce();
});
it.each([false, true])('filters small spots for a saved group of ten (schedule=%s)', async scheduled => {
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }] }));
  const large = { workspace_id: randomUUID(), template_id: randomUUID(), floor_id: randomUUID(), map_version_id: randomUUID(),
    name: 'Group room', capacity: 10, hourly_rate: 100 };
  const small = { ...large, workspace_id: randomUUID(), name: 'Single desk', capacity: 1 };
  seams.candidates.mockResolvedValue({ spots: [small, large], has_more: false });
  seams.availability.mockResolvedValue(new Set([small.workspace_id, large.workspace_id]));
  seams.prices.mockResolvedValue(new Map([[large.workspace_id, 200]]));
  const discovery = { preferences: { group_size: 10 }, ...(scheduled ? { date: '2026-11-01', start_time: '09:00', duration_minutes: 120 } : {}) };
  const response = await customerAssistantQuery(req({ ...query('What is a good spot for us?'), discovery }));
  expect(response.status).toBe(200);
  const answer = await response.json();
  expect(answer.suggestions.map((spot: { name: string }) => spot.name)).toEqual(['Group room']);
  expect(answer.summary).toContain('10');
  expect(answer.suggestions[0].availability).toBe(scheduled ? 'AVAILABLE' : 'NOT_CHECKED');
});
it('explains when no published spot fits the saved group size even without a schedule', async () => {
  provider.mockImplementation(async () => Response.json({ kind: 'WORKSPACE', operations: [{ name: 'public_workspace' }] }));
  seams.candidates.mockResolvedValue({ spots: [{ workspace_id: randomUUID(), template_id: randomUUID(), floor_id: randomUUID(), map_version_id: randomUUID(),
    name: 'Single desk', capacity: 1, hourly_rate: 100 }], has_more: false });
  const response = await customerAssistantQuery(req({ ...query('What is a good spot for us?'), discovery: { preferences: { group_size: 10 } } }));
  const answer = await response.json();
  expect(answer.suggestions).toEqual([]);
  expect(answer.summary).toContain('No spots could be confirmed for your group of 10');
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
