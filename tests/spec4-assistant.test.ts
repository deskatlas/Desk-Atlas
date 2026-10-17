import { admittedPacking } from './fixtures/assistantPacking';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { authorizeAssistantTool, executeAssistantTool, resolveAssistantPeriod, assistantComparison, localMidnight, unionMilliseconds, percentChange, currentOperationalPlan, type AssistantRepository } from '@deskatlas/domain';
import { assistantQuerySchema, assistantToolSchema, assistantSearchSchema } from '../packages/validation/src/assistantSchema';
import { issueStaffAssistantSession, verifyStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { assistantQuery, assistantInternal, assistantSource, assistantCancel, groundedQuotes } from '../apps/admin-portal/src/server/assistant/gateway';

// QAD-TC44: SPEC4-TC02/03/05/08/09/10/11/12/15/17/18/20.
const db = vi.hoisted(() => ({ role: 'ADMIN', active: true, valid: true, rpc: vi.fn(), getUser: vi.fn(), fetches: 0, epoch: 1 }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: db.getUser },
  rpc: (...args: unknown[]) => ({ abortSignal: () => args[0] === 'assistant_knowledge_availability'
    ? Promise.resolve({ data: { enabled: true, knowledge_epoch: db.epoch }, error: null }) : db.rpc(...args) }),
  from: (table: string) => ({ select: () => ({ eq: () => {
    const result = () => {
      if (table === 'staff_profiles') { db.fetches++; return { data: { role: db.role, is_active: db.active }, error: null }; }
      if (table === 'business_settings') return { data: { timezone: 'Asia/Manila' }, error: null };
      return { data: { epoch: db.epoch, active_embedding_fingerprint: 'test-fingerprint' }, error: null };
    };
    return { maybeSingle: async () => result(), abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }) };
  } }) }),
}) }));
const user = '123e4567-e89b-42d3-a456-426614174000';
const admin = { id: user, role: 'ADMIN' as const }, staff = { id: user, role: 'STAFF' as const };
const asOf = '2026-10-14T04:30:00.000Z';
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;
const tool = (name: string, args: Record<string, unknown> = {}) => assistantToolSchema.parse({ name, args });
const source = () => ({ document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'Procedure', heading_path: 'Overview', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64), content: 'Guest bookings require first name, last name and email.' });
const result = { tables: [{ title: 'Verified requests', columns: ['Count'], rows: [[7]] }], limitations: [], interpretation: ['Current business day'] };
function request(token: string, message = 'Give me the current snapshot.', override: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/assistant/query', { method: 'POST', headers: { Origin: 'http://localhost', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message, ...override }) });
}
beforeEach(() => {
  vi.stubEnv('RAG_SOP_FAST_PATH', 'false');
  vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', randomUUID());
  vi.stubEnv('RAG_ENABLED', 'true'); vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('RAG_SERVICE_URL', 'http://127.0.0.1:8000');
  vi.stubEnv('RAG_SERVICE_TOKEN', randomUUID()); vi.stubEnv('RAG_CAPABILITY_SECRET', randomUUID()); vi.stubEnv('RAG_SCOPE_ID', 'test-scope');
  vi.stubEnv('RAG_EMBEDDING_FINGERPRINT', 'test-fingerprint'); vi.stubEnv('RAG_MIN_SIMILARITY', '0.5');
  db.role = 'ADMIN'; db.active = true; db.valid = true; db.fetches = 0; db.epoch = 1;
  db.getUser.mockImplementation(async () => ({ data: { user: db.valid ? { id: user } : null }, error: null }));
  db.rpc.mockImplementation(async () => ({ data: result, error: null }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'OPERATIONAL', query: '', tools: [tool('operational_snapshot')] })));
});

describe('MS44-TC01/02/03/04/06/09: SOP gateway experiment', () => {
  function documentFixture() {
    vi.stubEnv('RAG_SOP_FAST_PATH', 'true'); vi.stubEnv('KB_ENABLED', 'true'); db.role = 'STAFF';
    const s = { ...source(), content: 'Before check-in, verify the booking QR. Do not approve online payment proofs as staff. Only admins may approve them, except counter payments handled by staff.' };
    db.rpc.mockImplementation(async (name: string) => ({ data: name === 'assistant_search_knowledge' ? [s] : name === 'assistant_expand_evidence' ? { complete: true, sources: [s] } : s, error: null }));
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(init);
      if (String(url).endsWith('/v1/plan')) return Response.json({ kind: 'DOCUMENT', query: 'How do I check in a guest?', tools: [] }, { headers: { 'Server-Timing': 'queue;dur=0, total;dur=3' } });
      if (String(url).endsWith('/v1/embed')) return Response.json({ vector: [1, ...Array(1023).fill(0)] }, { headers: { 'Server-Timing': 'queue;dur=2, inference;dur=4, total;dur=7' } });
      if (String(url).endsWith('/v1/context')) return Response.json({ chunk_ids: [s.chunk_id], ambiguous: false }, { headers: { 'Server-Timing': 'queue;dur=0, total;dur=1' } });
      return Response.json({ quotes: [{ chunk_id: s.chunk_id, quote: s.content }] }, { headers: { 'Server-Timing': 'queue;dur=0, total;dur=2' } });
    });
    return s;
  }
  it.each(['false', 'true'])('preserves exact restrictions and final source validation with flag %s', async flag => {
    const s = documentFixture(); vi.stubEnv('RAG_SOP_FAST_PATH', flag);
    const response = await assistantQuery(request(issueStaffAssistantSession(user, key()), 'How do I check in a guest?'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.summary).toBe(s.content); expect(body.data.citations[0].version_id).toBe(s.version_id);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/plan'))).toBe(flag === 'false');
    expect(db.rpc).toHaveBeenCalledWith('assistant_read_source', expect.objectContaining({ p_version: s.version_id }));
    expect(response.headers.get('server-timing')).toContain('python_embed_queue;dur=2.000');
    expect(response.headers.get('x-rag-queue-ms')).toBe('2.000');
    expect(response.headers.get('server-timing')).not.toContain(s.content);
  });
  it('returns an evidence gap without answer generation when published search is empty', async () => {
    documentFixture(); db.rpc.mockResolvedValue({ data: [], error: null });
    const response = await assistantQuery(request(issueStaffAssistantSession(user, key()), 'How do I check in a guest?'));
    const body = await response.json();
    expect(body.data.citations).toEqual([]); expect(body.data.limitations.join()).toContain('NO_RELEVANT_SOURCE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains staff report denial for a mixed procedural request', async () => {
    documentFixture();
    vi.mocked(fetch).mockResolvedValue(Response.json({ kind: 'MIXED', query: 'procedure', tools: [tool('payment_report')] }));
    const response = await assistantQuery(request(issueStaffAssistantSession(user, key()), 'How do I check in a guest and report revenue?'));
    expect(response.status).toBe(403); expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([{}, { quotes: [] }, { quotes: [{ chunk_id: randomUUID(), quote: 'fabricated' }] }, { quotes: [], conflicting_sources: true }])('does not treat invalid or empty selection as a grounded answer', async selection => {
    const s = documentFixture();
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/v1/evidence-cost') ? admittedPacking(init) : String(url).endsWith('/v1/embed') ? Response.json({ vector: [1, ...Array(1023).fill(0)] }) : String(url).endsWith('/v1/context') ? Response.json({ chunk_ids: [s.chunk_id], ambiguous: false }) : Response.json(selection));
    const body = await (await assistantQuery(request(issueStaffAssistantSession(user, key()), 'How do I check in a guest?'))).json();
    expect(body.data.citations).toEqual([]);
    const expected = 'conflicting_sources' in selection ? 'CONFLICTING_SOURCES' : 'quotes' in selection && selection.quotes.length === 0 ? 'NO_RELEVANT_SOURCE' : 'INVALID_MODEL_OUTPUT';
    expect(body.data.limitations.join()).toContain(expected);
    expect(body.data.limitations.length).toBeGreaterThan(0);
  });
  it('blocks a source revoked during the fast path final evidence check', async () => {
    const s = documentFixture();
    db.rpc.mockImplementation(async (name: string) => ({ data: name === 'assistant_search_knowledge' ? [s] : name === 'assistant_expand_evidence' ? { complete: true, sources: [s] } : null, error: null }));
    const response = await assistantQuery(request(issueStaffAssistantSession(user, key()), 'How do I check in a guest?'));
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain(s.content);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('SPEC4-TC02/03: verified role and tool boundary', () => {
  it('denies unsigned synthetic staff credentials and caller actor fields', async () => {
    const response = await assistantQuery(request(`da_session_123_${user}`, 'today', { role: 'ADMIN' }));
    expect(response.status).toBe(401); expect(db.rpc).not.toHaveBeenCalled();
  });
  it('supports signed custom admin and signed staff tokens', async () => {
    expect((await assistantQuery(request(issueAdminSession(user,key())))).status).toBe(200);
    db.role = 'STAFF';
    expect((await assistantQuery(request(issueStaffAssistantSession(user,key())))).status).toBe(200);
  });
  it('denies expired, tampered and deactivated sessions', async () => {
    expect((await assistantQuery(request(issueStaffAssistantSession(user,key(), Date.now()-3600001)))).status).toBe(401);
    expect(verifyStaffAssistantSession(issueStaffAssistantSession(user,key())+'x',key())).toBeNull();
    db.active = false; expect((await assistantQuery(request(issueAdminSession(user,key())))).status).toBe(403);
  });
  it('denies staff reports before executing mixed-plan tools', async () => {
    db.role = 'STAFF';
    vi.mocked(fetch).mockResolvedValue(Response.json({ kind: 'MIXED', query: 'history', tools: [tool('operational_snapshot'),tool('payment_report')] }));
    expect((await assistantQuery(request(issueStaffAssistantSession(user,key()), 'Magkano noong Setyembre?'))).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('revalidates current role before releasing a response', async () => {
    db.rpc.mockImplementation(async () => { db.active = false; return { data: result, error: null }; });
    expect((await assistantQuery(request(issueAdminSession(user,key())))).status).toBe(403);
  });
  it('denies cross-origin and direct internal calls', async () => {
    const incoming = request(issueAdminSession(user,key())); incoming.headers.set('origin','http://attacker.invalid');
    expect((await assistantQuery(incoming)).status).toBe(403);
    expect((await assistantInternal(request(issueAdminSession(user,key())),'tools')).status).toBe(401);
    const internal = request(process.env.RAG_SERVICE_TOKEN!); internal.headers.set('x-request-capability','invented');
    expect((await assistantInternal(internal,'search')).status).toBe(403);
  });
  it.each([3000, 3003])('accepts the browser host when Next.js binds to 0.0.0.0 on port %i', async port => {
    const incoming = request(issueAdminSession(user,key()));
    incoming.headers.set('host', `localhost:${port}`);
    incoming.headers.set('origin', `http://localhost:${port}`);
    incoming.headers.set('sec-fetch-site', 'same-origin');
    const bound = new Request(`http://0.0.0.0:${port}/api/assistant/query`, incoming);
    expect((await assistantQuery(bound)).status).toBe(200);
  });
  it.each([
    { origin: 'http://attacker.invalid:3003' },
    { origin: 'http://localhost:3000' },
    { origin: 'https://localhost:3003' },
    { origin: 'null' },
    { origin: '' },
    { origin: 'http://localhost:3003', site: 'cross-site' },
  ])('rejects mismatched or missing browser origins with an incoming host: %j', async ({ origin, site }) => {
    const incoming = request(issueAdminSession(user,key()));
    incoming.headers.set('host', 'localhost:3003');
    if (origin) incoming.headers.set('origin', origin); else incoming.headers.delete('origin');
    if (site) incoming.headers.set('sec-fetch-site', site);
    incoming.headers.set('x-forwarded-host', 'attacker.invalid:3003');
    const bound = new Request('http://0.0.0.0:3003/api/assistant/query', incoming);
    const response = await assistantQuery(bound);
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe('Same-origin request required.');
    expect(db.getUser).not.toHaveBeenCalled();
  });
  it('rejects unknown tools/filters and prohibits individual guest lookups', async () => {
    expect(() => authorizeAssistantTool(admin,{ name: 'sql', args: { query: 'select *' } })).toThrow();
    expect(() => authorizeAssistantTool(admin,{ name: 'booking_report', args: { email: 'someone' } })).toThrow();
    expect(() => authorizeAssistantTool(staff,tool('operational_snapshot',{ period: 'last30' }))).toThrow();
    expect((await assistantQuery(request(issueAdminSession(user,key()), 'Lookup guest@example.test'))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe('SPEC4-TC09/10/11/12: deterministic metrics and time', () => {
  it('routes clear multilingual current-day counts without depending on a model', () => {
    for (const text of ['How many bookings today?','Ilang kumpirmadong booking ngayong araw?','Ilan ang bookings today sa current operations?']) expect(currentOperationalPlan(text)?.tools[0].name).toBe('operational_snapshot');
    expect(currentOperationalPlan('Compare bookings today with last month')).toBeUndefined();
  });
  it('uses half-open inclusive local dates and DST rather than 24-hour arithmetic', () => {
    const spring = resolveAssistantPeriod(tool('booking_report',{start_date:'2026-03-08',end_date:'2026-03-08'}).args,'America/New_York',asOf);
    expect(spring.start).toBe('2026-03-08T05:00:00.000Z'); expect(spring.end).toBe('2026-03-09T04:00:00.000Z');
    const fall = resolveAssistantPeriod(tool('booking_report',{start_date:'2026-11-01',end_date:'2026-11-01'}).args,'America/New_York',asOf);
    expect(Date.parse(fall.end)-Date.parse(fall.start)).toBe(25*3600000);
    expect(() => localMidnight('2026-02-29','Asia/Manila')).toThrow();
    expect(localMidnight('2028-02-29','Asia/Manila')).toBe('2028-02-28T16:00:00.000Z');
  });
  it('last7 includes today and previous six dates; incomplete comparison has equal elapsed calendar portion', () => {
    const filters = tool('booking_report',{period:'last7',compare:'previous_period'}).args;
    const period = resolveAssistantPeriod(filters,'Asia/Manila',asOf);
    expect(period.start).toBe('2026-10-07T16:00:00.000Z');
    const compared = assistantComparison(filters,period,'Asia/Manila',asOf);
    expect(compared.current.end).toBe(asOf); expect(compared.previous.start).toBe('2026-09-30T16:00:00.000Z');
    expect(compared.previous.end).toBe('2026-10-07T04:30:00.000Z');
  });
  it('unions/clips overlapping intervals and returns N/A relative change on zero baseline', () => {
    expect(unionMilliseconds([[0,20],[10,30],[30,40],[60,70]],5,65)).toBe(40);
    expect(percentChange(7,0)).toBeNull(); expect(percentChange(15,10)).toBe(50);
  });
  it('does not guess unavailable historical occupancy or attendance', async () => {
    const repo: AssistantRepository = { execute: vi.fn() };
    await expect(executeAssistantTool(repo,admin,tool('workspace_usage_report',{metric:'booked_occupancy'}),'Asia/Manila',asOf)).rejects.toMatchObject({code:'UNSUPPORTED_HISTORY'});
    expect(repo.execute).not.toHaveBeenCalled();
  });
  it('compares money with exact cents and discloses independent snapshots', async () => {
    let calls = 0;
    const repo: AssistantRepository = { execute: async () => ({tables:[{title:'Payments',columns:['Period','Currency','Amount','Records'],rows:[['2026-10','PHP',++calls===1?'0.30':'0.10',1]]}],limitations:[],interpretation:[]}) };
    const value = await executeAssistantTool(repo,admin,tool('payment_report',{period:'this_month',compare:'previous_month'}),'Asia/Manila',asOf);
    expect(value.tables[2].rows).toEqual([['PHP','0.30','0.10','0.20','200%']]);
    expect(value.limitations.join(' ')).toContain('separate database snapshot');
  });
});
describe('SPEC4-TC05/08/17/18: evidence integrity and failures', () => {
  it('re-retrieves once on epoch change and releases only current authorized sources', async () => {
    vi.stubEnv('KB_ENABLED','true');
    const old=source(), current={...source(),epoch:2}; let answers=0;
    db.rpc.mockImplementation(async (name:string) => ({data:name==='assistant_search_knowledge'?[db.epoch===1?old:current]:name==='assistant_expand_evidence'?{complete:true,sources:[db.epoch===1?old:current]}:current,error:null}));
    vi.mocked(fetch).mockImplementation(async (url,_options) => {
      if (String(url).endsWith('/v1/evidence-cost')) return admittedPacking(_options);
      if (String(url).endsWith('/v1/plan')) return Response.json({kind:'DOCUMENT',query:'policy',tools:[]});
      if (String(url).endsWith('/v1/embed')) return Response.json({vector:[1,...Array(1023).fill(0)]});
      if (String(url).endsWith('/v1/context')) return Response.json({chunk_ids:[(db.epoch===1?old:current).chunk_id],ambiguous:false});
      const selected=++answers===1?old:current;
      db.epoch=2;
      return Response.json({quotes:[{chunk_id:selected.chunk_id,quote:selected.content}]});
    });
    const response=await assistantQuery(request(issueAdminSession(user,key()),'How do bookings work?'));
    const body=await response.json(); expect(response.status).toBe(200); expect(answers).toBe(2);
    expect(body.data.citations.map((s:{chunk_id:string})=>s.chunk_id)).toEqual([current.chunk_id]);
  });
  it('checks role again on a source view and suppresses revoked content', async () => {
    vi.stubEnv('KB_ENABLED','true'); const s=source();
    db.rpc.mockImplementation(async () => {db.role='STAFF';return {data:s,error:null};});
    const response=await assistantSource(request(issueAdminSession(user,key())),s.version_id,s.chunk_id);
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain(s.content);
  });
  it('cancels request buffers and prevents a late model result from releasing an answer', async () => {
    let release:(response:Response)=>void=()=>undefined;
    vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const ids={session_id:randomUUID(),request_id:randomUUID()}, token=issueAdminSession(user,key());
    const running=assistantQuery(request(token,'How many today?',ids));
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    const cancelling=new Request('http://localhost/api/assistant/cancel',{method:'POST',headers:{Origin:'http://localhost',Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(ids)});
    expect((await assistantCancel(cancelling)).status).toBe(200);
    release(Response.json({kind:'OPERATIONAL',query:'',tools:[]}));
    const response=await running; expect(response.status).toBe(408); expect((await response.json()).error.code).toBe('REQUEST_CANCELLED');
  });
  it('rejects assistant prose/rows in history and non-normalized vectors', () => {
    expect(assistantQuerySchema.safeParse({session_id:randomUUID(),request_id:randomUUID(),message:'Question',recent_context:{assistant_rows:[['secret']]}}).success).toBe(false);
    expect(assistantSearchSchema.safeParse({vector:Array(1024).fill(1)}).success).toBe(false);
  });
  it('accepts only exact authorized excerpts, never fabricated IDs or model arithmetic', () => {
    const s=source();
    expect(groundedQuotes({quotes:[{chunk_id:s.chunk_id,quote:'Bookings hold inventory.'}]},[s]).summary).toBe('');
    expect(groundedQuotes({quotes:[{chunk_id:randomUUID(),quote:s.content}]},[s]).sources).toEqual([]);
    expect(groundedQuotes({quotes:[{chunk_id:s.chunk_id,quote:s.content}]},[s]).summary).toBe(s.content);
    expect(groundedQuotes({quotes:[{chunk_id:s.chunk_id,quote:s.content}],conflicting_sources:true},[s])).toMatchObject({summary:'',sources:[],conflicting:true});
  });
  it('keeps deterministic tables when document inference fails', async () => {
    vi.stubEnv('KB_ENABLED','true');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({kind:'MIXED',query:'rules',tools:[tool('operational_snapshot')]})).mockResolvedValueOnce(new Response('',{status:503}));
    const response = await assistantQuery(request(issueAdminSession(user,key()))); const body = await response.json();
    expect(response.status).toBe(200); expect(body.data.tables[0].rows).toEqual([[7]]); expect(body.data.limitations.join(' ')).toContain('MODEL_UNAVAILABLE');
  });
  it('reports database failure as unavailable, not zero', async () => {
    db.rpc.mockResolvedValue({data:null,error:{message:'connection failed'}});
    const body = await (await assistantQuery(request(issueAdminSession(user,key())))).json();
    expect(body.data.tables).toEqual([]); expect(body.data.limitations.join(' ')).toContain('DATA_UNAVAILABLE');
  });
  it('refuses a revoked source without returning metadata', async () => {
    vi.stubEnv('KB_ENABLED','true'); db.rpc.mockResolvedValue({data:null,error:null});
    const response = await assistantSource(request(issueAdminSession(user,key())),randomUUID(),randomUUID());
    expect(response.status).toBe(404); expect(JSON.stringify(await response.json())).not.toContain('Procedure');
  });
  it('no-store responses and no assistant diagnostics or persistent browser stores', async () => {
    expect((await assistantQuery(request(issueAdminSession(user,key())))).headers.get('cache-control')).toContain('no-store');
    const gateway=readFileSync('apps/admin-portal/src/server/assistant/gateway.ts','utf8');
    const launcher=readFileSync('apps/admin-portal/src/features/assistant/AssistantLauncher.tsx','utf8');
    expect(gateway).not.toMatch(/console\.(log|error|warn)/); expect(launcher).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});
