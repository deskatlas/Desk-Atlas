// MS78-TC03/05/12/16: real gateway, private auth and projection with isolated storage seams.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
const seams = vi.hoisted(() => ({ services: vi.fn(), rpc: vi.fn() }));
vi.mock('../apps/customer-website/src/app/api/customer/_services', () => ({
  getCustomerServices: seams.services,
  getBearerToken: (request: Request) => /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: seams.rpc }) }));
import { CustomerMemoryRepository, CustomerService, RateLimiterService,
  CustomerAssistanceSupabaseRepository, type Customer } from '@deskatlas/domain';
import { customerAssistantQuery, customerAssistantControl, customerAssistantSource } from '../apps/customer-website/src/server/customer-assistant/gateway';

let customer: Customer;
let service: CustomerService;
let token: string;
const bookingId = randomUUID();
const now = new Date();
const sourceText = 'Present your booking QR at the reception scanner.';
const source = { version_id: randomUUID(), chunk_id: randomUUID(), document_id: randomUUID(),
  heading_path: 'Check-in', source_page: null, extraction_method: 'TEXT',
  title: 'Check-in', content: sourceText, content_hash: createHash('sha256').update(sourceText).digest('hex'), epoch: 7 };
function request(body: unknown, credential: string | null = token) {
  return new Request('http://localhost/api/customer-assistant/query', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body) });
}
function input(id = bookingId) {
  return { request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(), message: 'Explain my reservation', selected_reservation_id: id };
}
beforeEach(async () => {
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true'); vi.stubEnv('CUSTOMER_ASSISTANT_VERIFIED_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_ASSISTANT_ALLOWED_ORIGINS', 'http://localhost');
  vi.stubEnv('RAG_CAPABILITY_SECRET', 'ms78-fixture-signing-key-'.repeat(3));
  vi.stubEnv('RAG_SCOPE_ID', 'test'); vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'a'.repeat(64));
  vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  const repo = new CustomerMemoryRepository(); service = new CustomerService(repo);
  customer = await repo.createCustomer({ customerCode: 'ABC238', email: 'private@example.test', firstName: 'Private', lastName: 'Guest', firstConfirmedReservationId: randomUUID() });
  token = (await service.createAccessChallenge(customer.customerCode, customer.email, 'REWARDS_AND_ASSISTANT_ACCESS')).accessToken;
  seams.services.mockReturnValue({ customerService: service, rateLimiterService: new RateLimiterService(repo, 'test-hmac-secret') });
  seams.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'customer_assistant_control') return { data: { stage: 'checking', cancelled: false }, error: null };
    if (name === 'customer_knowledge_availability') return { data: { enabled: false, knowledge_epoch: 7 }, error: null };
    if (name === 'customer_read_source') return { data: source, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  vi.spyOn(CustomerAssistanceSupabaseRepository.prototype, 'read').mockImplementation(async (owner, id) => owner === customer.id && id === bookingId ? {
    id: bookingId, reference: 'SAFE-REF', status: 'CONFIRMED', channel: 'WEB',
    start_at: new Date(now.getTime() + 86400000 * 3).toISOString(), end_at: new Date(now.getTime() + 86400000 * 3 + 3600000).toISOString(),
    workspace: 'Desk 1', assigned: true, checked_in_at: null, checked_out_at: null, payment_status: 'APPROVED',
    reschedule_count: 0, closure_pending: false, timezone: 'Asia/Manila', reschedule_cutoff_hours: 24,
    cancellation_cutoff_value: 12, cancellation_cutoff_unit: 'HOURS',
  } : null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('MS78 integrated gateway', () => {
  it('answers a simple owned-record lookup without spending policy inference or timing out on documents', async () => {
    const original = seams.rpc.getMockImplementation()!;
    seams.rpc.mockImplementation(async (name: string) => name === 'customer_knowledge_availability'
      ? { data: { enabled: true, knowledge_epoch: 7 }, error: null } : original(name));
    const model = vi.fn(); vi.stubGlobal('fetch', model);
    const response = await customerAssistantQuery(request({ ...input(), message: 'Show my reservation' }));
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer.booking_context.facts.status).toBe('CONFIRMED');
    expect(answer.limitations.join(' ')).not.toContain('policy guidance is unavailable');
    expect(model).not.toHaveBeenCalled();
  });
  it('returns only owned exact facts and approved actions under shared admission', async () => {
    const response = await customerAssistantQuery(request(input()));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.booking_result).toBe('CONTEXT');
    expect(result.booking_context.facts).toMatchObject({ status: 'CONFIRMED', payment_status: 'APPROVED', cancel: true });
    expect(result.booking_context.actions).toContain('REVIEW_CANCELLATION');
    expect(JSON.stringify(result)).not.toMatch(/private@example|Private|access_token|proof_path/);
    expect(seams.rpc).toHaveBeenCalledWith('customer_assistant_control', expect.objectContaining({ p_operation: 'claim', p_principal: 'VERIFIED_CUSTOMER' }));
    expect(seams.rpc).toHaveBeenCalledWith('customer_assistant_control', expect.objectContaining({ p_operation: 'release' }));
  });
  it('foreign and missing selected pointers return the same response without booking hints', async () => {
    const one = await (await customerAssistantQuery(request(input(randomUUID())))).json();
    const two = await (await customerAssistantQuery(request(input(randomUUID())))).json();
    expect(one.booking_result).toBe('RESERVATION_UNAVAILABLE');
    expect(one.summary).toBe(two.summary);
    expect(one.booking_context).toBeUndefined();
    expect(JSON.stringify(one)).not.toContain('SAFE-REF');
    const malformed = await (await customerAssistantQuery(request(input('not-a-booking-id')))).json();
    expect(malformed.booking_result).toBe('RESERVATION_UNAVAILABLE');
    expect(malformed.summary).toBe(one.summary);
  });
  it.each(['query', 'source', 'progress', 'cancel'] as const)('rewards-only purpose cannot authorize private %s', async operation => {
    const legacy = (await service.createAccessChallenge(customer.customerCode, customer.email)).accessToken;
    const response = operation === 'query' ? await customerAssistantQuery(request(input(), legacy))
      : operation === 'source' ? await customerAssistantSource(request({ version_id: source.version_id, chunk_id: source.chunk_id }, legacy))
      : await customerAssistantControl(request({ request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID() }, legacy), operation);
    expect(response.status).toBe(403);
    expect(seams.rpc).not.toHaveBeenCalled();
  });
  it('revoked credentials fail every protected source read', async () => {
    await service.revokeAccessToken(token);
    const response = await customerAssistantSource(request({ version_id: source.version_id, chunk_id: source.chunk_id }));
    expect(response.status).toBe(401);
    expect(seams.rpc).not.toHaveBeenCalled();
  });
  it('revocation during the booking read prevents private answer emission', async () => {
    const read = vi.mocked(CustomerAssistanceSupabaseRepository.prototype.read);
    const original = read.getMockImplementation();
    read.mockImplementationOnce(async (owner, id) => { const result = await original(owner, id); await service.revokeAccessToken(token); return result; });
    const response = await customerAssistantQuery(request(input()));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('SAFE-REF');
  });
  it('capacity failure rejects before the owned booking adapter is called', async () => {
    seams.rpc.mockResolvedValue({ data: null, error: { message: 'RATE_LIMITED' } });
    const response = await customerAssistantQuery(request(input()));
    expect(response.status).toBe(429);
    expect(CustomerAssistanceSupabaseRepository.prototype.read).not.toHaveBeenCalled();
  });
  it('combined-mode sources recheck audience, current publication, and token at release', async () => {
    const response = await customerAssistantSource(request({ version_id: source.version_id, chunk_id: source.chunk_id }));
    expect(response.status).toBe(200);
    expect((await response.json()).excerpt).toBe(sourceText);
    expect(seams.rpc).toHaveBeenCalledWith('customer_read_source', expect.objectContaining({ p_principal: 'VERIFIED_CUSTOMER' }));
    expect(seams.rpc).toHaveBeenCalledWith('customer_knowledge_availability', expect.objectContaining({ p_principal: 'VERIFIED_CUSTOMER' }));
  });
  it('policy and exact owned facts pass through separate classes of evidence with no customer credentials sent to Python', async () => {
    vi.stubEnv('RAG_SERVICE_URL', 'http://127.0.0.1:8000'); vi.stubEnv('RAG_SERVICE_TOKEN', 'test-provider-token');
    vi.stubEnv('RAG_GOOGLE_AUTH', ''); vi.stubEnv('RAG_MIN_SIMILARITY', '0.5');
    seams.rpc.mockImplementation(async (name: string) => ({ error: null, data:
      name === 'customer_assistant_control' ? { stage: 'checking', cancelled: false } :
      name === 'customer_knowledge_availability' ? { enabled: true, knowledge_epoch: 7 } :
      name === 'customer_search_knowledge' ? [source] :
      name === 'customer_document_evidence' ? { contract: 'ms65-v1', epoch: 7, sources: [source] } : source,
    }));
    const model = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] });
      expect(String(url)).toContain('/document-support');
      return Response.json({ contract: 'ms65-v1', binding: createHash('sha256').update(String(init.body)).digest('hex'),
        outcome: 'COMPLETE', clarification: null,
        spans: [{ chunk_id: source.chunk_id, quote: sourceText, start: 0, end: sourceText.length }],
        synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [],
          blocks: [{ kind: 'text', text: 'Generated text is not emitted as permission.', support: [0] }] },
        counts: { bundles: 1, calls: 1, units: 1 },
      });
    });
    vi.stubGlobal('fetch', model);
    const response = await customerAssistantQuery(request(input()));
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer.knowledge_epoch).toBe(7);
    expect(answer.policy_excerpts).toEqual([{ chunk_id: source.chunk_id, quote: sourceText }]);
    expect(answer.booking_context.facts.cancel).toBe(true);
    expect(answer.citations[0].chunk_id).toBe(source.chunk_id);
    const outbound = JSON.stringify(model.mock.calls);
    expect(outbound).not.toContain(token); expect(outbound).not.toContain('private@example.test');
    expect(outbound).not.toContain('SAFE-REF');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('publication changes at the final private boundary reject the complete mixed response', async () => {
    let epochs = 0;
    seams.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'customer_assistant_control'
      ? { stage: 'checking', cancelled: false } : { enabled: false, knowledge_epoch: ++epochs === 1 ? 7 : 8 } }));
    const response = await customerAssistantQuery(request(input()));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('SAFE-REF');
  });
});
