import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AssistantError, executeAssistantTool, businessDate, currentOperationalPlan, assistantToolNarrative, type AssistantActor, type AssistantRepository, type AssistantToolResult } from '@deskatlas/domain';
import { assistantAvailabilitySchema, assistantKnowledgeAvailabilitySchema, assistantAnswerSchema, assistantCancelSchema, assistantExtractSchema, assistantPlanSchema, assistantQuerySchema, assistantSearchSchema, assistantSourceSchema, assistantIdSchema, assistantSourcesSchema, assistantToolResultSchema, type AssistantAnswer, type AssistantQuery, type AssistantSource } from '../../../../../packages/validation/src/assistantSchema';
import { verifyAdminSession } from '../../app/api/admin/auth/_lib/adminSession';
import { verifyStaffAssistantSession } from './session';
import { proceduralDocumentPlan } from '@deskatlas/domain';
import { AssistantTiming } from './timing';

// SPEC-4: SDD-C20/C21/C22. This module is imported only by server route adapters.
const noStore = { 'Cache-Control': 'no-store, private', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff' };
type Verified = { actor: AssistantActor; client: SupabaseClient };
type Active = { actor: AssistantActor; session: string; controller: AbortController; capability: string; expires: number; stage: 'waiting' | 'retrieving' | 'preparing'; timezone?: string; asOf: string; callbacks: number };
// No transcript or facts in shared state: only bounded, short-lived cancellation/admission metadata.
const state = globalThis as typeof globalThis & { deskAtlasAssistantActive?: Map<string, Active> };
const active = state.deskAtlasAssistantActive ??= new Map<string, Active>();

function config(name: string): string {
  const value = process.env[name];
  if (!value) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  return value;
}
function boundedConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant resource configuration is invalid.', 503);
  return value;
}
function client(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL || config('NEXT_PUBLIC_SUPABASE_URL'), config('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) },
  });
}
export async function authorizeAssistant(request: Request): Promise<Verified> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || token.length > 4096) throw new AssistantError('AUTH_REQUIRED', 'Sign in again to use the assistant.', 401);
  const db = client();
  let userId: string | null = null;
  if (token.startsWith('da_admin_v1.')) userId = verifyAdminSession(token, config('SUPABASE_SERVICE_ROLE_KEY'));
  else if (token.startsWith('da_staff_v1.')) userId = verifyStaffAssistantSession(token, config('SUPABASE_SERVICE_ROLE_KEY'));
  else if (!token.startsWith('da_')) {
    const { data, error } = await db.auth.getUser(token);
    if (!error) userId = data.user?.id ?? null;
  }
  if (!userId) throw new AssistantError('AUTH_REQUIRED', 'Sign in again to use the assistant.', 401);
  const { data, error } = await db.from('staff_profiles').select('role,is_active').eq('user_id', userId).maybeSingle();
  if (error) throw new AssistantError('DATA_UNAVAILABLE', 'Unable to verify current access.', 503);
  if (!data?.is_active || !['ADMIN', 'STAFF'].includes(data.role)) throw new AssistantError('FORBIDDEN', 'Account is not authorized or is deactivated.', 403);
  return { actor: { id: userId, role: data.role }, client: db };
}
async function recheck(db: SupabaseClient, actor: AssistantActor): Promise<void> {
  const { data, error } = await db.from('staff_profiles').select('role,is_active').eq('user_id', actor.id).maybeSingle();
  if (error) throw new AssistantError('DATA_UNAVAILABLE', 'Unable to verify current access.', 503);
  if (!data?.is_active || data.role !== actor.role) throw new AssistantError('FORBIDDEN', 'Account permissions changed. Sign in again.', 403);
}
function sameOrigin(request: Request): void {
  const url = new URL(request.url);
  // PRD-F26 / SDD-C20: Next.js may use the bind address in request.url.
  // Match the incoming Host, retaining protocol/port checks and cross-site denial.
  const host = request.headers.get('host') ?? url.host;
  if (request.headers.get('origin') !== `${url.protocol}//${host}` || request.headers.get('sec-fetch-site') === 'cross-site') throw new AssistantError('FORBIDDEN', 'Same-origin request required.', 403);
}
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AssistantError('INVALID_REQUEST', 'Expected JSON.', 400);
  if (Number(request.headers.get('content-length')) > 24000) throw new AssistantError('INVALID_REQUEST', 'Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantError('INVALID_REQUEST', 'Expected a request body.');
  const decoder = new TextDecoder(); let size = 0, body = '';
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 10000);
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 24000) throw new AssistantError('INVALID_REQUEST', 'Request is too large.', 413); body += decoder.decode(part.value, { stream: true }); }
    if (expired) throw new AssistantError('REQUEST_TIMEOUT', 'Request body timed out.', 408);
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch (error) { if (error instanceof AssistantError) throw error; throw new AssistantError('INVALID_REQUEST', 'Invalid JSON.'); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
function enabled(): void { if (process.env.RAG_ENABLED !== 'true') throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant is not enabled.', 503); }
function toolResult(input: unknown): AssistantToolResult {
  const parsed = assistantToolResultSchema.safeParse(input);
  if (!parsed.success) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid aggregate result.', 503);
  return { tables: parsed.data.tables!, interpretation: parsed.data.interpretation!, limitations: parsed.data.limitations! };
}
export function assistantFailure(error: unknown): Response {
  const e = error instanceof AssistantError ? error : new AssistantError('DATA_UNAVAILABLE', 'Assistant is temporarily unavailable. Retry shortly.', 503);
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { ...noStore, ...(['CAPACITY_BUSY', 'RATE_LIMITED'].includes(e.code) ? { 'Retry-After': '5' } : {}) } });
}
async function epoch(db: SupabaseClient, signal: AbortSignal): Promise<number> {
  if (process.env.KB_ENABLED !== 'true') return 0;
  const { data, error } = await db.from('kb_catalog').select('epoch,active_embedding_fingerprint').eq('scope_id', config('RAG_SCOPE_ID')).abortSignal(signal).maybeSingle();
  if (error || !data || data.active_embedding_fingerprint !== config('RAG_EMBEDDING_FINGERPRINT')) throw new AssistantError('DATA_UNAVAILABLE', 'Published knowledge configuration is unavailable.', 503);
  const value = Number(data.epoch);
  if (!Number.isSafeInteger(value) || value < 0) throw new AssistantError('DATA_UNAVAILABLE', 'Published knowledge configuration is unavailable.', 503);
  return value;
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const { data, error } = await db.rpc(name, args).abortSignal(signal);
  if (error) {
    const code = ['FORBIDDEN','UNSUPPORTED_REPORT','UNSUPPORTED_HISTORY'].find(c => error.message.includes(c));
    throw new AssistantError(code ?? 'DATA_UNAVAILABLE', code === 'FORBIDDEN' ? 'This request is not permitted.' : code ? 'Unsupported metric, filters, or result size. Use a smaller range or coarser grouping.' : 'Verified data is unavailable.', code === 'FORBIDDEN' ? 403 : code ? 400 : 503);
  }
  return data as unknown;
}
// MS-45: one actor-scoped snapshot, without embedding or model inference.
async function availability(verified: Verified, signal: AbortSignal) {
  if (process.env.RAG_ENABLED !== 'true' || process.env.KB_ENABLED !== 'true') return { enabled: false, knowledge_epoch: 0 };
  const base = new URL(config('RAG_SERVICE_URL'));
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  if (config('RAG_SERVICE_TOKEN').length < 32 || config('RAG_CAPABILITY_SECRET').length < 32) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  const minimum = Number(config('RAG_MIN_SIMILARITY'));
  if (!Number.isFinite(minimum) || minimum < -1 || minimum > 1) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  boundedConfig('RAG_CAPACITY',5,1,5); boundedConfig('RAG_REQUEST_DEADLINE_MS',55000,1000,55000);
  const value = assistantKnowledgeAvailabilitySchema.safeParse(await rpc(verified.client, 'assistant_knowledge_availability', {
    p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'),
  }, signal));
  if (!value.success) throw new AssistantError('DATA_UNAVAILABLE', 'Assistant availability cannot be verified.', 503);
  return value.data;
}
async function requireKnowledge(verified: Verified, signal: AbortSignal) {
  const result = await availability(verified, signal);
  if (!result.enabled) throw new AssistantError('NO_RELEVANT_SOURCE', 'Assistant is unavailable. Ask an administrator.', 503);
  return result.knowledge_epoch;
}
function capability(actor: AssistantActor, requestId: string, generation: string): string {
  const secret = config('RAG_CAPABILITY_SECRET');
  if (secret.length < 32) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: actor.id, role: actor.role, request_id: requestId, scope: config('RAG_SCOPE_ID'), ops: actor.role === 'ADMIN' ? ['search','tools','answer'] : ['search','operational_snapshot','workspace_availability','answer'], iat: now, exp: now + 60, generation })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
async function model(path: string, payload: unknown, cap: string, signal: AbortSignal, timing?: AssistantTiming): Promise<unknown> {
  const base = new URL(config('RAG_SERVICE_URL'));
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant requires a private authenticated transport.', 503);
  const serviceSecret = config('RAG_SERVICE_TOKEN');
  if (serviceSecret.length < 32) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  try {
    const res = await fetch(new URL(path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceSecret}`, 'X-Request-Capability': cap }, body: JSON.stringify(payload), cache: 'no-store', signal });
    const stage = path.slice(4);
    if (stage === 'plan' || stage === 'embed' || stage === 'answer') timing?.upstream(stage, res.headers.get('server-timing'), res.headers.get('x-rag-input-tokens'), res.headers.get('x-rag-output-tokens'));
    if (res.status === 403) throw new AssistantError('FORBIDDEN', 'Historical and financial reports require administrator access.', 403);
    if (!res.ok) throw new AssistantError(res.status === 429 ? 'CAPACITY_BUSY' : 'MODEL_UNAVAILABLE', res.status === 429 ? 'Assistant is at capacity. Retry shortly.' : 'Local model is unavailable.', res.status === 429 ? 429 : 503);
    return await res.json() as unknown;
  } catch (e) { if (signal.aborted || e instanceof AssistantError) throw e; throw new AssistantError('MODEL_UNAVAILABLE', 'Local model is unavailable.', 503); }
}
function checkSensitive(input: AssistantQuery): void {
  const text = [input.message, ...(input.recent_context?.user_turns ?? [])].join(' ');
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[a-f0-9]{32,}\b|\b(?:\+?\d[\s()-]*){9,}\b/i.test(text) || /\b(guest|customer|booking|reservation)\s+(token|email|phone|contact|proof|reference|history|record)|\b(password|api.?key|service.?role|secret|bank reference)\b/i.test(text)) throw new AssistantError('UNSUPPORTED_REPORT', 'Individual guest records, private identifiers, and credentials are unavailable through chat.');
}
export function groundedQuotes(value: unknown, sources: AssistantSource[]): { summary: string; sources: AssistantSource[]; conflicting?: boolean } {
  const parsed = assistantExtractSchema.safeParse(value);
  if (!parsed.success) return { summary: '', sources: [] };
  if (parsed.data.conflicting_sources) return { summary: '', sources: [], conflicting: true };
  const used: AssistantSource[] = [], quotes: string[] = [];
  for (const q of parsed.data.quotes) {
    const source = sources.find(s => s.chunk_id === q.chunk_id);
    if (!source || !source.content.includes(q.quote)) return { summary: '', sources: [] };
    if (!used.some(s => s.chunk_id === source.chunk_id)) used.push(source);
    quotes.push(q.quote);
  }
  return { summary: quotes.join('\n\n'), sources: used };
}
export async function assistantQuery(request: Request): Promise<Response> {
  const timing = new AssistantTiming();
  const finish = (response: Response) => timing.finish(response, requestId);
  let entry: Active | undefined, requestId = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    sameOrigin(request); const verified = await timing.measure('auth', () => authorizeAssistant(request)); enabled();
    await timing.measure('catalog', () => requireKnowledge(verified, request.signal));
    const parsed = assistantQuerySchema.safeParse(await timing.measure('validate', () => jsonBody(request)));
    if (!parsed.success) throw new AssistantError('INVALID_REQUEST', 'Invalid assistant request.');
    const input = parsed.data; requestId = input.request_id; checkSensitive(input);
    for (const [key, value] of active) if (value.expires < Date.now()) { value.controller.abort(); active.delete(key); }
    if (active.has(requestId) || [...active.values()].filter(v => v.actor.id === verified.actor.id).length >= 1 || active.size >= boundedConfig('RAG_CAPACITY',5,1,5)) throw new AssistantError('CAPACITY_BUSY', 'Assistant is at capacity. Retry shortly.', 429);
    const controller = new AbortController();
    entry = { actor: verified.actor, session: input.session_id, controller, capability: capability(verified.actor, requestId, randomUUID()), expires: Date.now() + 60000, stage: 'waiting', asOf: new Date().toISOString(), callbacks: 0 };
    active.set(requestId, entry);
    onAbort = () => controller.abort(); request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    timer = setTimeout(() => controller.abort(new Error('deadline')), boundedConfig('RAG_REQUEST_DEADLINE_MS',55000,1000,55000));
    const signal = controller.signal;
    const asOf = entry.asOf;
    const settings = await timing.measure('settings', async () => await verified.client.from('business_settings').select('timezone').eq('id', 1).abortSignal(signal).single());
    if (settings.error || !settings.data?.timezone) throw new AssistantError('DATA_UNAVAILABLE', 'Business timezone is unavailable.', 503);
    const timezone = String(settings.data.timezone);
    entry.timezone = timezone;
    let knowledgeEpoch = await timing.measure('catalog', () => epoch(verified.client, signal));
    const fastPlan = process.env.RAG_SOP_FAST_PATH === 'true' ? proceduralDocumentPlan(input.message, input.recent_context) : undefined;
    const planResult = assistantPlanSchema.safeParse(await timing.measure('plan', async () => fastPlan ?? currentOperationalPlan(input.message) ?? await model('/v1/plan', { message: input.message, recent_context: input.recent_context ?? { user_turns: [] }, business_date: businessDate(asOf, timezone), timezone }, entry!.capability, signal, timing)));
    if (!planResult.success) throw new AssistantError('MODEL_UNAVAILABLE', 'The model returned an invalid plan. Retry or specify the metric and dates.', 503);
    const plan = planResult.data;
    entry.stage = 'retrieving';
    const tables: AssistantAnswer['tables'] = [], interpretation: string[] = [], limitations: string[] = [], narratives: string[] = [];
    const repo: AssistantRepository = { execute: async (actor, tool, period, frozen) => {
      // Revalidate before each tool. SQL also checks the current profile in its snapshot.
      await recheck(verified.client, actor);
      const result = assistantToolResultSchema.safeParse(await rpc(verified.client, 'assistant_read_tool', { p_actor: actor.id, p_tool: tool.name, p_args: tool.args, p_start: period.start, p_end: period.end, p_as_of: frozen }, signal));
      if (!result.success) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid aggregate result.', 503);
      return toolResult(result.data);
    } };
    // Reject the whole staff report plan before running any part, including mixed requests.
    if (verified.actor.role === 'STAFF' && (plan.kind === 'REPORT' || plan.tools.some(t => !['operational_snapshot','workspace_availability'].includes(t.name)))) throw new AssistantError('FORBIDDEN', 'Historical and financial reports require administrator access.', 403);
    for (const tool of plan.tools) {
      try {
        const result = await timing.measure('tools', () => executeAssistantTool(repo, verified.actor, tool, timezone, asOf));
        tables.push(...result.tables); interpretation.push(...result.interpretation); limitations.push(...result.limitations);
        narratives.push(assistantToolNarrative(tool.name,result));
      } catch (e) { if (!(e instanceof AssistantError) || e.status === 403) throw e; limitations.push(`${e.code}: ${e.message}`); }
    }
    let sources: AssistantSource[] = [], summary = '';
    if (['DOCUMENT', 'MIXED'].includes(plan.kind)) {
      if (process.env.KB_ENABLED !== 'true') limitations.push('NO_RELEVANT_SOURCE: Published knowledge is not enabled. Ask an administrator.');
      else {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const embedding = assistantSearchSchema.safeParse(await timing.measure('embed', () => model('/v1/embed', { query: plan.query || input.message }, entry!.capability, signal, timing)));
            if (!embedding.success) throw new AssistantError('MODEL_UNAVAILABLE', 'Embedding configuration mismatch.', 503);
            const candidates = assistantSourcesSchema.parse(await timing.measure('retrieve', () => rpc(verified.client, 'assistant_search_knowledge', { p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_vector: embedding.data.vector, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')) }, signal)));
            const query = plan.query || input.message;
            const evidence: AssistantSource[] = [];
            for (const candidate of candidates) {
              if (evidence.length === 6) break;
              // UTF-8 bytes conservatively bound tokenizer input. Keep complete chunks.
              if (Buffer.byteLength(JSON.stringify({ query, sources: [...evidence, candidate] }), 'utf8') <= 12000) evidence.push(candidate);
            }
            // Prior assistant facts and report rows never enter the model context.
            entry.stage = 'preparing';
            const selected = evidence.length ? groundedQuotes(await timing.measure('answer', () => model('/v1/answer', { query: plan.query || input.message, sources: evidence }, entry!.capability, signal, timing)), evidence) : { summary: '', sources: [], conflicting: false };
            summary = selected.summary; sources = selected.sources;
            if (!summary) limitations.push(selected.conflicting ? 'CONFLICTING_SOURCES: Published sources disagree. Ask an administrator to reconcile the rule.' : 'NO_RELEVANT_SOURCE: No validated answer was found in published documents. Ask an administrator.');
          } catch (e) {
            if (e instanceof AssistantError && e.status === 403) throw e;
            if (signal.aborted) throw e;
            limitations.push('MODEL_UNAVAILABLE: Document evidence could not be prepared. Verified tables remain available.'); sources = []; summary = '';
          }
          const current = await timing.measure('catalog', () => epoch(verified.client, signal));
          if (current === knowledgeEpoch) break;
          sources = []; summary = ''; knowledgeEpoch = current;
          if (attempt === 1) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
        }
      }
    }
    // Final source and actor checks happen before returning even one byte of evidence.
    const finalIdentity = await timing.measure('auth', () => authorizeAssistant(request));
    if (finalIdentity.actor.id !== verified.actor.id || finalIdentity.actor.role !== verified.actor.role) throw new AssistantError('FORBIDDEN', 'Account permissions changed.', 403);
    for (const source of sources) {
      const current = await timing.measure('evidence', () => rpc(verified.client, 'assistant_read_source', { p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_version: source.version_id, p_chunk: source.chunk_id }, signal));
      const checked = assistantSourceSchema.safeParse(current);
      if (!checked.success || checked.data.content_hash !== source.content_hash || checked.data.epoch !== knowledgeEpoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
    }
    if (await timing.measure('catalog', () => requireKnowledge(finalIdentity, signal)) !== knowledgeEpoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
    if (signal.aborted) throw new AssistantError('REQUEST_CANCELLED', 'Request cancelled.', 499);
    const answer = assistantAnswerSchema.parse({ kind: plan.kind,
      summary: [summary,...narratives].filter(Boolean).join('\n\n') || (tables.length ? 'Verified results are shown below. Review the filters and coverage limitations.' : plan.kind === 'CLARIFY' ? 'Please specify the metric, date range, or workspace you want to examine.' : plan.kind === 'UNSUPPORTED' ? 'This assistant supports published documentation and read-only aggregate inquiries. It cannot execute business changes or look up individual guests.' : 'No verified answer is available. Ask an administrator or retry with a specific metric and dates.'),
      tables, citations: sources.map(({ content: _content, ...metadata }) => metadata), interpretation: [...new Set(interpretation)], as_of: asOf,
      limitations: [...new Set(limitations)], knowledge_epoch: knowledgeEpoch, request_id: requestId, selections: plan.tools[0] });
    return finish(await timing.measure('serialize', async () => Response.json({ data: answer }, { headers: noStore })));
  } catch (e) {
    if (entry?.controller.signal.aborted) return finish(assistantFailure(new AssistantError(entry.controller.signal.reason instanceof Error && entry.controller.signal.reason.message === 'deadline' ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED', 'Request ended. Retry if needed.', 408)));
    return finish(assistantFailure(e));
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
    if (entry && active.get(requestId) === entry) active.delete(requestId);
  }
}
export async function assistantCancel(request: Request): Promise<Response> {
  try {
    sameOrigin(request); const { actor } = await authorizeAssistant(request);
    const parsed = assistantCancelSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new AssistantError('INVALID_REQUEST', 'Invalid cancellation.');
    const item = active.get(parsed.data.request_id);
    if (item?.actor.id === actor.id && item.session === parsed.data.session_id) item.controller.abort();
    return Response.json({ data: { cancelled: true } }, { headers: noStore });
  } catch (e) { return assistantFailure(e); }
}
export async function assistantStatus(request: Request): Promise<Response> {
  try {
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new AssistantError('FORBIDDEN', 'Same-origin request required.', 403);
    const verified = await authorizeAssistant(request);
    const result = await availability(verified, request.signal);
    await recheck(verified.client, verified.actor);
    return Response.json({ data: assistantAvailabilitySchema.parse({ ...result, identity: verified.actor }) }, { headers: noStore });
  }
  catch (e) { return assistantFailure(e); }
}
export async function assistantProgress(request: Request): Promise<Response> {
  try {
    sameOrigin(request); const { actor } = await authorizeAssistant(request);
    const parsed = assistantCancelSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new AssistantError('INVALID_REQUEST', 'Invalid progress request.');
    const item = active.get(parsed.data.request_id);
    const stage = item?.actor.id === actor.id && item.session === parsed.data.session_id ? item.stage : 'waiting';
    return Response.json({ data: { stage } }, { headers: noStore });
  } catch (e) { return assistantFailure(e); }
}
function constantEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function assistantInternal(request: Request, operation: 'tools' | 'search'): Promise<Response> {
  try {
    enabled();
    if (!constantEqual(request.headers.get('authorization') ?? '', `Bearer ${config('RAG_SERVICE_TOKEN')}`)) throw new AssistantError('AUTH_REQUIRED', 'Service authentication required.', 401);
    const cap = request.headers.get('x-request-capability') ?? '';
    const item = [...active.values()].find(v => constantEqual(v.capability, cap));
    if (!item || item.expires <= Date.now() || item.controller.signal.aborted || !item.timezone || item.callbacks >= 3) throw new AssistantError('FORBIDDEN', 'Live request capability required.', 403);
    const db = client(); await recheck(db, item.actor); item.callbacks++;
    const input = await jsonBody(request);
    if (operation === 'tools') {
      const result = await executeAssistantTool({ execute: async (actor, tool, period, asOf) => toolResult(await rpc(db, 'assistant_read_tool', { p_actor: actor.id, p_tool: tool.name, p_args: tool.args, p_start: period.start, p_end: period.end, p_as_of: asOf }, item.controller.signal)) }, item.actor, input, item.timezone, item.asOf);
      await recheck(db, item.actor);
      return Response.json({ data: result }, { headers: noStore });
    }
    const parsed = assistantSearchSchema.safeParse(input);
    if (!parsed.success || process.env.KB_ENABLED !== 'true') throw new AssistantError('INVALID_REQUEST', 'Invalid search request.');
    const before = await epoch(db, item.controller.signal);
    const sources = assistantSourcesSchema.parse(await rpc(db, 'assistant_search_knowledge', { p_actor: item.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_vector: parsed.data.vector, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')) }, item.controller.signal));
    await recheck(db, item.actor);
    if (before !== await epoch(db, item.controller.signal)) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed.', 409);
    return Response.json({ data: sources.slice(0, 6) }, { headers: noStore });
  } catch (e) { return assistantFailure(e); }
}
export async function assistantSource(request: Request, version: string, chunk: string): Promise<Response> {
  try {
    const { actor, client: db } = await authorizeAssistant(request); enabled();
    if (!assistantIdSchema.safeParse(version).success || !assistantIdSchema.safeParse(chunk).success || process.env.KB_ENABLED !== 'true') throw new AssistantError('NO_RELEVANT_SOURCE', 'Source is unavailable.', 404);
    const source = assistantSourceSchema.safeParse(await rpc(db, 'assistant_read_source', { p_actor: actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_version: version, p_chunk: chunk }, request.signal));
    if (!source.success) throw new AssistantError('NO_RELEVANT_SOURCE', 'Source is unavailable.', 404);
    const final = await authorizeAssistant(request);
    if (final.actor.id !== actor.id || final.actor.role !== actor.role) throw new AssistantError('FORBIDDEN', 'Account permissions changed.', 403);
    if (await epoch(db, request.signal) !== source.data.epoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Retry.', 409);
    return Response.json({ data: source.data }, { headers: noStore });
  } catch (e) { return assistantFailure(e); }
}
