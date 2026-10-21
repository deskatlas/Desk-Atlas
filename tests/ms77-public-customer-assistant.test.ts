import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { customerActionSchema, customerDiscoveryContextSchema, publicCustomerQuerySchema } from '../packages/validation/src';
import { decidePublicSpots, type PublicSpot, type SpotDecisionRepository, type ApprovedCharacteristic } from '../packages/domain/src/services/publicSpotDecisionService';
import { customerRequestBody, publicVisitor, trustedClientIp } from '../apps/customer-website/src/server/customer-assistant/security';

const id = () => randomUUID();
const scheduled = { date: '2027-01-10', start_time: '09:00', duration_minutes: 120 };
const spot = (workspace_id = id()): PublicSpot => ({ workspace_id, template_id: id(), floor_id: id(), map_version_id: id(), name: 'Spot', capacity: 2, hourly_rate: 50 });
function repository(spots: PublicSpot[]): SpotDecisionRepository {
  return { candidates: async () => ({ spots, has_more: false }), availability: async s => new Set(s.map(v => v.workspace_id)),
    prices: async s => new Map(s.map(v => [v.workspace_id, 100])) };
}
const query = () => ({ session_id: id(), request_id: id(), generation: id(), message: 'Help me choose a spot' });

describe('MS77-TC05/06/10/13 bounded inert request contracts', () => {
  it('rejects forged role/channel/time/scope and excessive comparison/history', () => {
    for (const field of ['role', 'mode', 'nowIso', 'channel', 'scope', 'minimumLeadMinutes']) expect(publicCustomerQuerySchema.safeParse({ ...query(), [field]: 'forged' }).success).toBe(false);
    expect(publicCustomerQuerySchema.safeParse({ ...query(), user_turns: Array(5).fill('old') }).success).toBe(false);
    expect(customerDiscoveryContextSchema.safeParse({ compared_ids: [id(), id(), id(), id()] }).success).toBe(false);
  });
  it('rejects impossible dates and non-booking times/durations', () => {
    for (const value of [{ date: '2026-02-30' }, { start_time: '24:00' }, { duration_minutes: 0 }, { preferences: { group_size: 0 } }]) expect(customerDiscoveryContextSchema.safeParse(value).success).toBe(false);
  });
  it('cannot execute arbitrary URLs, callback names or extra action fields', () => {
    for (const value of [{ id: 'NAVIGATE', url: 'javascript:alert(1)' }, { id: 'VIEW_SPOT', workspace_id: id(), floor_id: id(), map_version_id: id(), url: 'https://evil.test' }]) expect(customerActionSchema.safeParse(value).success).toBe(false);
  });
});

describe('MS77-TC07/08/09 deterministic read-only spot decisions', () => {
  it('narrows candidate overflow before availability or price work', async () => {
    let reads = 0; const repo = repository(Array.from({ length: 13 }, () => spot()));
    repo.availability = async () => { reads++; return new Set(); };
    expect((await decidePublicSpots(repo, scheduled, [])).narrow).toBe(true); expect(reads).toBe(0);
  });
  it('never asserts schedule availability or quotes without complete inputs', async () => {
    const s = spot(); let reads = 0; const repo = repository([s]); repo.availability = async () => { reads++; return new Set(); };
    const result = await decidePublicSpots(repo, {}, []);
    expect(result.suggestions[0].availability).toBe('NOT_CHECKED'); expect(result.suggestions[0].quote).toBeUndefined(); expect(reads).toBe(0);
  });
  it('uses only approved matches; unknown names contribute zero and ties use stable IDs', async () => {
    const a = spot('00000000-0000-4000-8000-000000000001'), b = spot('00000000-0000-4000-8000-000000000002');
    const evidence: ApprovedCharacteristic[] = [{ workspace_id: b.workspace_id, dimension: 'focus', value: true, chunk_id: id(), quote: 'Approved focused work.' }];
    expect((await decidePublicSpots(repository([b, a]), { ...scheduled, preferences: { focus: true } }, [])).suggestions.map(s => s.workspace_id)).toEqual([a.workspace_id, b.workspace_id]);
    const result = await decidePublicSpots(repository([a, b]), { ...scheduled, preferences: { focus: true } }, evidence);
    expect(result.suggestions[0].workspace_id).toBe(b.workspace_id); expect(result.suggestions[0].score).toBe(1);
  });
  it('contradictory characteristics never score or become reasons', async () => {
    const s = spot(); const fact = { workspace_id: s.workspace_id, dimension: 'calls' as const, chunk_id: id(), quote: 'Calls rule.' };
    const result = await decidePublicSpots(repository([s]), { ...scheduled, preferences: { calls: true } }, [{ ...fact, value: true }, { ...fact, value: false }]);
    expect(result.suggestions[0].score).toBe(0); expect(result.suggestions[0].reasons).toEqual([]);
  });
  it('enforces group and quoted budget constraints and caps suggestions at three', async () => {
    const spots = Array.from({ length: 8 }, () => spot()); spots[0].capacity = 1;
    const result = await decidePublicSpots(repository(spots), { ...scheduled, preferences: { group_size: 2, budget: 100 } }, []);
    expect(result.suggestions).toHaveLength(3); expect(result.suggestions.every(s => s.capacity >= 2)).toBe(true);
    expect((await decidePublicSpots(repository(spots), { ...scheduled, preferences: { budget: 90 } }, [])).suggestions).toHaveLength(0);
  });
  it('omits unknown quotes, and unknown quotes cannot pass a hard budget', async () => {
    const repo = repository([spot()]); repo.prices = async () => new Map();
    expect((await decidePublicSpots(repo, scheduled, [])).suggestions[0].quote).toBeUndefined();
    expect((await decidePublicSpots(repo, { ...scheduled, preferences: { budget: 100 } }, [])).suggestions).toHaveLength(0);
  });
  it('drops changed maps and concurrent unavailability with only two availability and one price batches', async () => {
    const s = spot(); let candidates = 0, availability = 0, prices = 0;
    const repo: SpotDecisionRepository = { candidates: async () => ({ has_more: false, spots: [++candidates === 1 ? s : { ...s, map_version_id: id() }] }),
      availability: async () => { availability++; return new Set([s.workspace_id]); }, prices: async () => { prices++; return new Map([[s.workspace_id, 100]]); } };
    const result = await decidePublicSpots(repo, scheduled, []);
    expect(result.changed).toBe(true); expect(result.suggestions).toEqual([]); expect([availability, prices]).toEqual([2, 1]);
    expect(Object.keys(repo).sort()).toEqual(['availability', 'candidates', 'prices']);
  });
});

describe('MS77-TC11/13/15 origin, trusted IP and signed visitor boundaries', () => {
  beforeEach(() => { process.env.RAG_CAPABILITY_SECRET = 'ms77-test-key-'.repeat(4); process.env.CUSTOMER_ASSISTANT_ALLOWED_ORIGINS = 'http://localhost:3001'; });
  afterEach(() => { delete process.env.CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER; delete process.env.RAG_CAPABILITY_SECRET; delete process.env.CUSTOMER_ASSISTANT_ALLOWED_ORIGINS; });
  const request = (headers: Record<string, string> = {}, body = '{}') => new Request('http://localhost:3001/api/customer-assistant/query', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  it('rejects cross-origin/nonJSON and streaming oversized bodies, accepts missing Origin for quota admission', async () => {
    await expect(customerRequestBody(request({ origin: 'https://evil.test' }))).rejects.toMatchObject({ status: 403 });
    await expect(customerRequestBody(request({ 'content-type': 'text/plain' }))).rejects.toMatchObject({ status: 415 });
    await expect(customerRequestBody(request({}, 'x'.repeat(32769)))).rejects.toMatchObject({ status: 413 });
    await expect(customerRequestBody(request())).resolves.toEqual({});
  });
  it('accepts the allowlisted public host when Next.js binds to all interfaces', async () => {
    const bound = new Request('http://0.0.0.0:3001/api/customer-assistant/session', {
      method: 'POST', headers: { host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/json' }, body: '{}',
    });
    await expect(customerRequestBody(bound)).resolves.toEqual({});
    await expect(customerRequestBody(request({ host: 'evil.test', origin: 'http://localhost:3001' }))).rejects.toMatchObject({ status: 403 });
  });
  it('never trusts spoofed x-forwarded-for; only explicitly configured single ingress IP', () => {
    expect(trustedClientIp(request({ 'x-forwarded-for': '9.9.9.9' }))).toBe('127.0.0.1');
    expect(trustedClientIp(new Request('http://0.0.0.0:3001/api/customer-assistant/query'))).toBe('127.0.0.1');
    process.env.CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER = 'x-real-ip';
    expect(() => trustedClientIp(request({ 'x-real-ip': '1.2.3.4, 5.6.7.8' }))).toThrow();
    expect(trustedClientIp(request({ 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4');
  });
  it('cancels a stalled body read when the request aborts', async () => {
    const abort = new AbortController();
    const stalled = new Request('http://localhost:3001/api/customer-assistant/query', { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: abort.signal,
      body: new ReadableStream<Uint8Array>({ start() {} }), duplex: 'half',
    } as RequestInit & { duplex: string });
    const reading = customerRequestBody(stalled); abort.abort();
    await expect(reading).rejects.toMatchObject({ status: 408 });
  });
  it('requires signed server-issued visitor identities; UUIDs/session IDs grant no authority', () => {
    const visitor = publicVisitor(request());
    expect(visitor.cookie).toContain('HttpOnly; SameSite=Strict');
    expect(publicVisitor(request({ cookie: visitor.cookie!.split(';')[0] }), true).id).toBe(visitor.id);
    expect(() => publicVisitor(request({ cookie: `da_assistant_visitor=${id()}` }))).toThrow();
    expect(() => publicVisitor(request(), true)).toThrow();
    expect(() => publicVisitor(request({ cookie: visitor.cookie!.split(';')[0] + 'forged' }), true)).toThrow();
  });
  it('renews an authentic expired guest cookie at session bootstrap without customer verification', () => {
    const visitor = publicVisitor(request());
    const cookie = visitor.cookie!.split(';')[0];
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3601000);
    try {
      expect(() => publicVisitor(request({ cookie }), true)).toThrow();
      const renewed = publicVisitor(request({ cookie }));
      expect(renewed.cookie).toContain('HttpOnly; SameSite=Strict');
      expect(renewed.id).not.toBe(visitor.id);
      expect(() => publicVisitor(request({ cookie: cookie + 'forged' }))).toThrow();
    } finally { vi.restoreAllMocks(); }
  });
});

