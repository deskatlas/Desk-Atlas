import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AssistantError, assistantAnswerLanguage, assistantCopy, executeAssistantTool, businessDate, currentOperationalPlan, guidanceDocumentPlan, assistantToolNarrative, type AssistantActor, type AssistantRepository, type AssistantToolResult } from '@deskatlas/domain';
import { assistantAvailabilitySchema, assistantContextSelectionSchema, assistantEvidenceSchema, assistantKnowledgeAvailabilitySchema, assistantAnswerSchema, assistantCancelSchema, assistantExtractSchema, assistantPlanSchema, assistantQuerySchema, assistantSearchSchema, assistantSourceSchema, assistantIdSchema, assistantSourcesSchema, assistantToolResultSchema, type AssistantAnswer, type AssistantQuery, type AssistantSource } from '../../../../../packages/validation/src/assistantSchema';
import { verifyAdminSession } from '../../app/api/admin/auth/_lib/adminSession';
import { verifyStaffAssistantSession } from './session';
import { proceduralDocumentPlan, assistantContextualQuestion, assistantRetrievalQuery, assistantSearchQueries, fuseAssistantCandidates, selectProcedureSeed, selectGovernanceSeeds, selectFaqSeed, selectBookingGuaranteeSeeds } from '@deskatlas/domain';
import { assistantEmbeddingBatchSchema, assistantHybridCandidatesSchema } from '../../../../../packages/validation/src/assistantSchema';
import { AssistantTiming } from './timing';
import { RequestBudget } from './budget';
import { assistantEvidenceBudget as evidenceBudget } from '../../../../../packages/validation/src/assistantEvidenceBudget';
import type { AssistantCoverage } from '../../../../../packages/validation/src/assistantSchema';
import { AssistantDiagnostics, type DiagnosticReason } from './diagnostics';
import { validateAssistantSynthesis, assistantSynthesisSupported, assistantSynthesisLanguageAdmitted } from '@deskatlas/domain';
import type { AssistantSynthesis } from '../../../../../packages/validation/src/assistantSchema';
import { assistantSupportVerdictSchema } from '../../../../../packages/validation/src/assistantSchema';
import { assistantOutcome } from '@deskatlas/domain';
import { exactAssistantPresentation, exactAssistantMainAtoms } from '@deskatlas/domain';
import { assistantEvidenceCostsSchema, assistantPackingCostSchema } from '../../../../../packages/validation/src/assistantSchema';
import type { AssistantObligation } from '../../../../../packages/validation/src/assistantSchema';
import { createCloudRunIdentity, type CloudRunIdentity } from './cloudRun';
import { assistantDocumentEvidenceSchema } from '../../../../../packages/validation/src/assistantSchema';
import { validateDocumentSupport } from '../../../../../packages/domain/src/services/assistantDocumentSupport';
import { readPreparedSupport } from './preparedReader';
import { preparedSupportEvidenceSchema } from '@deskatlas/validation';
import { knowledgeValidation as z } from '@deskatlas/validation';
import { readInternalDiscoveryCatalog } from './catalog';

// SPEC-4: SDD-C20/C21/C22. This module is imported only by server route adapters.
const noStore = { 'Cache-Control': 'no-store, private', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff' };
type Verified = { actor: AssistantActor; client: SupabaseClient };
type Active = { actor: AssistantActor; session: string; controller: AbortController; capability: string; expires: number; stage: 'checking' | 'retrieving' | 'preparing'; timezone?: string; asOf: string; callbacks: number };
// No transcript or facts in shared state: only bounded, short-lived cancellation/admission metadata.
const state = globalThis as typeof globalThis & { deskAtlasAssistantActive?: Map<string, Active> };
const active = state.deskAtlasAssistantActive ??= new Map<string, Active>();

function config(name: string): string {
  const value = process.env[name];
  if (!value) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  return value;
}
// PRD-F26/F27 / payment audit: production readers must be chosen deliberately.
function validateEvidenceContract(value: string | undefined): void {
  if (process.env.NODE_ENV === 'production' && !value) throw new AssistantError('MODEL_UNAVAILABLE', 'The assistant document reader is not configured. Ask an administrator to check evidence compatibility before enabling the assistant.', 503);
  if (!['legacy', 'ms59-v1', 'ms65-v1'].includes(value ?? 'legacy')) throw new AssistantError('MODEL_UNAVAILABLE', 'Unsupported evidence contract.', 503);
}

async function checkRejectedReader(db: SupabaseClient, versions: string[], signal: AbortSignal): Promise<void> {
  // IDs come only from actor/scoped retrieval. No source text is read or released.
  const { data, error } = await db.from('kb_document_versions').select('id,support_contract').in('id', versions).abortSignal(signal);
  const rows: unknown = data;
  if (error || !Array.isArray(rows) || rows.length !== versions.length || rows.some(row => !row || typeof row !== 'object' || !('id' in row) || !versions.includes(String(row.id)) || !('support_contract' in row))) throw new AssistantError('DATA_UNAVAILABLE', 'Evidence compatibility could not be verified.', 503);
  if (rows.some(row => row.support_contract === 'ms65-v1')) throw new AssistantError('MODEL_UNAVAILABLE', 'READER_INCOMPATIBLE: The assistant document reader is incompatible with this published version. Ask an administrator to update the assistant configuration. This compatibility error does not require replacing the document.', 503);
}
function boundedConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant resource configuration is invalid.', 503);
  return value;
}
function client(signal?: AbortSignal): SupabaseClient {
  return createClient(process.env.SUPABASE_URL || config('NEXT_PUBLIC_SUPABASE_URL'), config('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), ...(signal ? [signal] : []), AbortSignal.timeout(10000)]) }) },
  });
}
export async function authorizeAssistant(request: Request, signal: AbortSignal = request.signal): Promise<Verified> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || token.length > 4096) throw new AssistantError('AUTH_REQUIRED', 'Sign in again to use the assistant.', 401);
  const db = client(signal);
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
async function jsonBody(request: Request, signal: AbortSignal = request.signal): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AssistantError('INVALID_REQUEST', 'Expected JSON.', 400);
  if (Number(request.headers.get('content-length')) > 24000) throw new AssistantError('INVALID_REQUEST', 'Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AssistantError('INVALID_REQUEST', 'Expected a request body.');
  const decoder = new TextDecoder(); let size = 0, body = '';
  let expired = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 10000);
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 24000) throw new AssistantError('INVALID_REQUEST', 'Request is too large.', 413); body += decoder.decode(part.value, { stream: true }); }
    if (signal.aborted) throw new AssistantError('REQUEST_CANCELLED', 'Request cancelled.', 408);
    if (expired) throw new AssistantError('REQUEST_TIMEOUT', 'Request body timed out.', 408);
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch (error) { if (error instanceof AssistantError) throw error; throw new AssistantError('INVALID_REQUEST', 'Invalid JSON.'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); reader.releaseLock(); }
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
    if (error.message.includes('CONTEXT_BUDGET_EXCEEDED')) throw new AssistantError('INCOMPLETE_EVIDENCE', 'CONTEXT_BUDGET: This request exceeds the verified document inspection capacity. Ask about one narrower task.', 400);
    if (error.message.includes('UNRESOLVED_CONTEXT')) throw new AssistantError('INCOMPLETE_CONTEXT', 'Reviewed source context could not be verified. Ask an administrator to review the applicable source structure.', 400);
    if (error.message.includes('MANIFEST_INVALID')) throw new AssistantError('INCOMPLETE_CONTEXT', 'REPROCESS_REQUIRED: Stored evidence integrity could not be verified. Ask an administrator to review or reprocess the document.', 400);
    if (error.message.includes('KNOWLEDGE_CHANGED')) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
    const code = ['FORBIDDEN','UNSUPPORTED_REPORT','UNSUPPORTED_HISTORY'].find(c => error.message.includes(c));
    throw new AssistantError(code ?? 'DATA_UNAVAILABLE', code === 'FORBIDDEN' ? 'This request is not permitted.' : code ? 'Unsupported metric, filters, or result size. Use a smaller range or coarser grouping.' : 'Verified data is unavailable.', code === 'FORBIDDEN' ? 403 : code ? 400 : 503);
  }
  return data as unknown;
}
// MS-45: one actor-scoped snapshot, without embedding or model inference.
async function availability(verified: Verified, signal: AbortSignal, statusOnly = false) {
  if (process.env.RAG_ENABLED !== 'true' || process.env.KB_ENABLED !== 'true') return { enabled: false, knowledge_epoch: 0 };
  validateEvidenceContract(process.env.RAG_EVIDENCE_CONTRACT);
  const base = new URL(config('RAG_SERVICE_URL'));
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  if (config('RAG_SERVICE_TOKEN').length < 32 || config('RAG_CAPABILITY_SECRET').length < 32) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  const minimum = Number(config('RAG_MIN_SIMILARITY'));
  if (!Number.isFinite(minimum) || minimum < -1 || minimum > 1) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  boundedConfig('RAG_CAPACITY',5,1,5); boundedConfig('RAG_REQUEST_DEADLINE_MS',55000,1000,55000);
  const value = assistantKnowledgeAvailabilitySchema.safeParse(await rpc(verified.client, statusOnly ? 'assistant_knowledge_status' : 'assistant_knowledge_availability', {
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
async function model(path: string, payload: unknown, cap: string, signal: AbortSignal, timing?: AssistantTiming, budget?: RequestBudget, diagnostics?: AssistantDiagnostics, cloudIdentity?: CloudRunIdentity): Promise<unknown> {
  const base = new URL(config('RAG_SERVICE_URL'));
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant requires a private authenticated transport.', 503);
  const serviceSecret = config('RAG_SERVICE_TOKEN');
  if (serviceSecret.length < 32) throw new AssistantError('MODEL_UNAVAILABLE', 'Assistant configuration is incomplete.', 503);
  try {
    const identity = await cloudIdentity?.();
    budget?.check();
    diagnostics?.enter(path === '/v1/evidence-cost' ? 'expand' : path === '/v1/context' || path === '/v1/prepared-selection' ? 'context' : path === '/v1/answer' ? 'answer' : path === '/v1/synthesis' ? 'synthesis' : path === '/v1/support' || path === '/v1/document-support' || path === '/v1/prepared-support' ? 'support' : path === '/v1/embed' || path === '/v1/embed-queries' ? 'embed' : 'plan');
    diagnostics?.count('model_request_bytes', Buffer.byteLength(JSON.stringify(payload), 'utf8'));
    const res = await fetch(new URL(path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceSecret}`, 'X-Request-Capability': cap, ...(identity ? { 'X-Serverless-Authorization': `Bearer ${identity}` } : {}), ...(budget ? { 'X-Request-Timeout-Ms': String(budget.remaining()) } : {}) }, body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal });
    for (const key of ['reasoning_tokens', 'reasoning_bytes', 'completion_bytes', 'cached_input_tokens', 'aggregate_model_bytes', 'aggregate_output_reserved', 'system_bytes', 'serialized_model_bytes', 'context_tokens', 'output_budget', 'template_headroom', 'evidence_packed', 'evidence_supported', 'evidence_bytes'] as const) {
      const value = res.headers.get(`x-rag-model-${key}`);
      if (value && /^\d{1,8}$/.test(value)) {
        diagnostics?.count(key, Number(value));
        if (path === '/v1/prepared-selection' && (key === 'reasoning_tokens' || key === 'reasoning_bytes')) diagnostics?.count(key === 'reasoning_tokens' ? 'selection_reasoning_tokens' : 'selection_reasoning_bytes', Number(value));
      }
    }
    const stage = path === '/v1/document-support' || path === '/v1/prepared-support' ? 'support' : path === '/v1/context' || path === '/v1/prepared-selection' || path === '/v1/catalog-plan' ? 'answer' : path === '/v1/embed-queries' ? 'embed' : path.slice(4);
    if (stage === 'plan' || stage === 'embed' || stage === 'answer' || stage === 'synthesis' || stage === 'support') timing?.upstream(stage, res.headers.get('server-timing'), res.headers.get('x-rag-input-tokens'), res.headers.get('x-rag-output-tokens'));
    if (res.status === 403) throw new AssistantError('FORBIDDEN', 'Historical and financial reports require administrator access.', 403);
    if (!res.ok) {
      const failure: unknown = await res.json().catch(() => null);
      const detail = failure && typeof failure === 'object' ? ('detail' in failure ? failure.detail : 'error' in failure ? failure.error : undefined) : undefined;
      if (typeof detail === 'string' && ['CONTEXT_BUDGET_EXCEEDED','OUTPUT_BUDGET_EXCEEDED','UNRESOLVED_CONTEXT','INVALID_MODEL_OUTPUT','MODEL_TIMEOUT','REQUEST_TIMEOUT','CAPACITY_BUSY'].includes(detail)) diagnostics?.fail(detail as DiagnosticReason);
      if (['CONTEXT_BUDGET_EXCEEDED','OUTPUT_BUDGET_EXCEEDED'].includes(String(detail))) throw new AssistantError('INCOMPLETE_EVIDENCE', `${detail}: ${path === '/v1/context' ? 'Evidence comparison could not be completed within the supported capacity. Please retry.' : 'Complete applicable evidence could not be prepared within the verified capacity. Please retry.'}`, 400);
      if (detail === 'UNRESOLVED_CONTEXT') throw new AssistantError('INCOMPLETE_CONTEXT', 'Required procedure context could not be verified.', 400);
      if (detail === 'CONFLICTING_SOURCES') throw new AssistantError('CONFLICTING_SOURCES', 'The applicable published sources conflict. Ask an administrator to resolve the policy.', 400);
      if (detail === 'INVALID_MODEL_OUTPUT') throw new AssistantError('INVALID_MODEL_OUTPUT', 'The model returned an incomplete selection.', 503);
      if (detail === 'MODEL_TIMEOUT' || detail === 'REQUEST_TIMEOUT') throw new AssistantError(detail, 'Answer preparation took too long.', 408);
      throw new AssistantError(res.status === 429 ? 'CAPACITY_BUSY' : 'MODEL_UNAVAILABLE', res.status === 429 ? 'Assistant is at capacity. Retry shortly.' : 'The answer service is temporarily unavailable. Please retry.', res.status === 429 ? 429 : 503);
    }
    const result: unknown = await res.json();
    diagnostics?.count('model_response_bytes', Buffer.byteLength(JSON.stringify(result), 'utf8'));
    return result;
  } catch (e) { if (signal.aborted || e instanceof AssistantError) throw e; throw new AssistantError('MODEL_UNAVAILABLE', 'The answer service is temporarily unavailable. Please retry.', 503); }
}
function checkSensitive(input: AssistantQuery): void {
  const text = [input.message, ...(input.recent_context?.user_turns ?? [])].join(' ');
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[a-f0-9]{32,}\b|\b(?:\+?\d[\s()-]*){9,}\b/i.test(text) || /\b(guest|customer|booking|reservation)\s+(token|email|phone|contact|proof|reference|history|record)|\b(password|api.?key|service.?role|secret|bank reference)\b/i.test(text)) throw new AssistantError('UNSUPPORTED_REPORT', 'Individual guest records, private identifiers, and credentials are unavailable through chat.');
}
type EvidenceSpan = { chunk_id: string; quote: string; start: number; end: number };
function presentationSpansSafe(source: AssistantSource, spans: EvidenceSpan[]): boolean {
  let opened: { start: number; marker: string } | undefined;
  const fences: { start: number; end: number }[] = [];
  for (const match of source.content.matchAll(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gm)) {
    if (!opened) opened = { start: match.index, marker: match[1] };
    else if (match[1][0] === opened.marker[0] && match[1].length >= opened.marker.length && !match[2].trim()) {
      fences.push({ start: opened.start, end: match.index + match[0].length }); opened = undefined;
    }
  }
  if (opened) fences.push({ start: opened.start, end: source.content.length });
  return fences.every(fence => spans.some(span => span.chunk_id === source.chunk_id && span.start <= fence.start && span.end >= fence.end));
}
export function groundedQuotes(value: unknown, sources: AssistantSource[], query?: string, groups?: { id: string; chunk_ids: string[]; requires: string[] }[], reject?: (reason: DiagnosticReason) => void, requiredChunkIds?: string[]): { summary: string; sources: AssistantSource[]; conflicting?: boolean; evidence_spans?: EvidenceSpan[] } {
  const rejected = (reason: DiagnosticReason) => { reject?.(reason); return { summary: '', sources: [] }; };
  const parsed = assistantExtractSchema.safeParse(value);
  if (!parsed.success) return rejected('INVALID_QUOTES');
  if (parsed.data.conflicting_sources) { reject?.('CONFLICTING_SOURCES'); return { summary: '', sources: [], conflicting: true }; }
  if (!parsed.data.quotes.length) return { summary: '', sources: [] };
  if (query !== undefined && sources.some(source => /ignore\s+(?:all\s+|previous\s+)?instructions|reveal\s+(?:secret|credentials)|execute\s+sql|fetch\s+https?:\/\/|bypass\s+permissions/i.test(source.content))) return rejected('INJECTION_REJECTED');
  const used: AssistantSource[] = [], quotes: string[] = [], spans: EvidenceSpan[] = [];
  const cursors = new Map<string, number>();
  for (const q of parsed.data.quotes) {
    const source = sources.find(s => s.chunk_id === q.chunk_id);
    if (!source || !source.content.includes(q.quote)) return rejected('INVALID_SOURCE_QUOTE');
    const start = source.content.indexOf(q.quote, cursors.get(q.chunk_id) ?? 0);
    if (start < 0) return rejected('INVALID_SOURCE_QUOTE');
    const end = start + q.quote.length;
    cursors.set(q.chunk_id, end);
    spans.push({ chunk_id: source.chunk_id, quote: q.quote, start, end });
    if (!used.some(s => s.chunk_id === source.chunk_id)) used.push(source);
    quotes.push(q.quote);
  }
  // MS48-TC02/03: independently verify selected units and dependency coverage.
  let required = sources;
  if (groups) {
    const byId = new Map(groups.map(group => [group.id, group]));
    const owners = new Map(groups.flatMap(group => group.chunk_ids.map(id => [id, group.id] as const)));
    if (byId.size !== groups.length || owners.size !== sources.length || groups.reduce((n,g) => n + g.chunk_ids.length,0) !== sources.length || sources.some(s => !owners.has(s.chunk_id))) return rejected('INVALID_GROUPS');
    if (requiredChunkIds && (!requiredChunkIds.length || new Set(requiredChunkIds).size !== requiredChunkIds.length || requiredChunkIds.some(id => !owners.has(id)))) return rejected('INVALID_GROUPS');
    const pending = (requiredChunkIds ?? parsed.data.quotes.map(q => q.chunk_id)).map(id => owners.get(id)!);
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      const group = byId.get(id);
      if (!group) return rejected('INVALID_GROUPS');
      visited.add(id); pending.push(...group.requires);
    }
    required = sources.filter(s => visited.has(owners.get(s.chunk_id)!));
  }
  if (query !== undefined && required.some(source => {
    const coverage = spans.filter(span => span.chunk_id === source.chunk_id).sort((a,b) => a.start - b.start);
    let offset = 0;
    return source.content.split(/\n\s*\n/).some(raw => {
      const part = raw.trim();
      const start = source.content.indexOf(part, offset), end = start + part.length;
      offset = end;
      if (!part || (!requiredChunkIds && (part === source.heading_path || part === query))) return false;
      let cursor = start;
      for (const span of coverage) {
        if (span.end <= cursor || span.start >= end) continue;
        if (source.content.slice(cursor, Math.max(cursor, span.start)).trim()) return true;
        cursor = Math.max(cursor, Math.min(span.end, end));
      }
      return Boolean(source.content.slice(cursor, end).trim());
    });
  })) return rejected('INCOMPLETE_COVERAGE');
  return { summary: quotes.join('\n\n'), sources: used, ...(used.every(source => presentationSpansSafe(source, spans)) ? { evidence_spans: spans } : {}) };
}
export async function assistantQuery(request: Request): Promise<Response> {
  const arrived = performance.now();
  // MS57-TC12: freeze server-only admission. Changes affect new requests;
  // disabling does not promise cancellation of already admitted requests.
  const synthesisEnabled = process.env.RAG_SYNTHESIS_ENABLED === 'true';
  const evidenceV3 = process.env.RAG_EVIDENCE_CONTRACT === 'ms59-v1';
  const documentContract = process.env.RAG_EVIDENCE_CONTRACT === 'ms65-v1';
  const answerContract = request.headers.get('X-DeskAtlas-Answer-Contract');
  const conciseMain = answerContract === 'ms59-v1' && request.headers.get('X-DeskAtlas-Main-Answer-Contract') === 'ms60-v1';
  let selectionAttempts = 0, expansionAttempts = 0;
  const timing = new AssistantTiming();
  const diagnostics = new AssistantDiagnostics(process.env.RAG_DIAGNOSTICS_ENABLED === 'true' || process.env.NODE_ENV === 'development' && request.headers.get('X-DeskAtlas-Diagnostics') === 'ms60-v1', documentContract ? 2 : 1);
  if (!synthesisEnabled) diagnostics.fallback('DISABLED');
  const finish = (response: Response) => diagnostics.finish(timing.finish(response, requestId));
  let entry: Active | undefined, requestId = '';
  let budget: RequestBudget | undefined;
  try {
    budget = new RequestBudget(request.signal, boundedConfig('RAG_REQUEST_DEADLINE_MS',55000,1000,55000), arrived);
    if (answerContract && answerContract !== 'ms59-v1') throw new AssistantError('INVALID_REQUEST', 'Unsupported answer presentation contract.', 400);
    const mainContract = request.headers.get('X-DeskAtlas-Main-Answer-Contract');
    if (mainContract && (mainContract !== 'ms60-v1' || answerContract !== 'ms59-v1')) throw new AssistantError('INVALID_REQUEST', 'Unsupported main answer contract.', 400);
    const signal = budget.signal;
    const measure: typeof timing.measure = (stage, work) => { diagnostics.enter(stage); return budget!.run(() => timing.measure(stage, work)); };
    validateEvidenceContract(process.env.RAG_EVIDENCE_CONTRACT);
    sameOrigin(request); const verified = await measure('auth', () => authorizeAssistant(request, signal)); diagnostics.authorize(); enabled();
    const admittedEpoch = await measure('catalog', () => requireKnowledge(verified, signal));
    const parsed = assistantQuerySchema.safeParse(await measure('validate', () => jsonBody(request, signal)));
    if (!parsed.success) throw new AssistantError('INVALID_REQUEST', 'Invalid assistant request.');
    const input = parsed.data; requestId = input.request_id; checkSensitive(input);
    const cloudIdentity = createCloudRunIdentity(request, signal);
    const language = assistantAnswerLanguage(), copy = assistantCopy(language);
    for (const [key, value] of active) if (value.expires < Date.now()) { value.controller.abort(); active.delete(key); }
    if (active.has(requestId) || [...active.values()].filter(v => v.actor.id === verified.actor.id).length >= 1 || active.size >= boundedConfig('RAG_CAPACITY',5,1,5)) throw new AssistantError('CAPACITY_BUSY', 'Assistant is at capacity. Retry shortly.', 429);
    const controller = budget.controller;
    entry = { actor: verified.actor, session: input.session_id, controller, capability: capability(verified.actor, requestId, randomUUID()), expires: Date.now() + budget.remaining(), stage: 'checking', asOf: new Date().toISOString(), callbacks: 0 };
    active.set(requestId, entry);
    const asOf = entry.asOf;
    const settings = await measure('settings', async () => await verified.client.from('business_settings').select('timezone').eq('id', 1).abortSignal(signal).single());
    if (settings.error || !settings.data?.timezone) throw new AssistantError('DATA_UNAVAILABLE', 'Business timezone is unavailable.', 503);
    const timezone = String(settings.data.timezone);
    entry.timezone = timezone;
    let knowledgeEpoch = admittedEpoch;
    diagnostics.count('epoch', knowledgeEpoch);
    const fastPlan = (process.env.RAG_GUIDANCE_FAST_PATH === 'true' ? guidanceDocumentPlan(input.message) : undefined) ?? (process.env.RAG_SOP_FAST_PATH === 'true' ? proceduralDocumentPlan(input.message, input.recent_context) : undefined);
    const operationalPlan = currentOperationalPlan(input.message);
    let catalogSeeds: AssistantSource[] | undefined;
    let catalogPlan: unknown;
    if (documentContract && process.env.KB_ENABLED === 'true' && process.env.RAG_INTERNAL_CATALOG_DISCOVERY === 'true' && !operationalPlan) {
      const catalog = await measure('catalog', () => readInternalDiscoveryCatalog(verified.client, verified.actor.role,
        config('RAG_SCOPE_ID'), knowledgeEpoch, signal, {
          authorize: () => recheck(verified.client, verified.actor),
          source: (version, chunk) => rpc(verified.client, 'assistant_read_source', { p_actor: verified.actor.id,
            p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_version: version, p_chunk: chunk }, signal),
        }));
      const result = z.object({ kind: z.enum(['DOCUMENT', 'DEFER']), query: z.string().min(1).max(2000),
        chunk_ids: z.array(z.string().uuid()).max(16) }).strict().parse(await measure('context', () => model('/v1/catalog-plan', {
          message: input.message, user_turns: input.recent_context?.user_turns ?? [],
          document_task: Boolean(fastPlan),
          sources: catalog.sources.map(({ chunk_id, title, heading_path, content }) => ({ chunk_id, title, heading_path, content })),
          headings: catalog.headings,
        }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
      if (new Set(result.chunk_ids).size !== result.chunk_ids.length
        || result.chunk_ids.some(id => !catalog.sources.some(source => source.chunk_id === id))
        || result.kind === 'DEFER' && (result.chunk_ids.length || Boolean(fastPlan))) throw new AssistantError('INVALID_MODEL_OUTPUT', copy.modelOutput, 503);
      if (result.kind === 'DOCUMENT') {
        catalogSeeds = catalog.sources.filter(source => result.chunk_ids.includes(source.chunk_id));
        catalogPlan = { kind: 'DOCUMENT', query: result.query, tools: [] };
      }
    }
    diagnostics.count('shortcut', fastPlan || currentOperationalPlan(input.message) ? 1 : 0);
    const hybrid = process.env.RAG_HYBRID_RETRIEVAL === 'true';
    const planResult = assistantPlanSchema.safeParse(await measure('plan', async () => catalogPlan ?? fastPlan ?? operationalPlan ?? await model('/v1/plan', { message: input.message, recent_context: input.recent_context ?? { user_turns: [] }, business_date: businessDate(asOf, timezone), timezone, search_enabled: true, ...(documentContract ? {evidence_contract: 'ms65-v1'} : {}) }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
    if (!planResult.success) {
      diagnostics.fail('INVALID_PLAN', 'plan');
      diagnostics.count('plan_invalid_filters', planResult.error.issues.filter(issue => issue.path.includes('args')).length);
      diagnostics.count('plan_invalid_clarification', planResult.error.issues.filter(issue => issue.path.includes('clarification')).length);
    }
    if (!planResult.success) throw new AssistantError('MODEL_UNAVAILABLE', 'I could not interpret that question reliably. Please rephrase it or retry.', 503);
    const plan = planResult.data;
    if (plan.kind === 'CLARIFY' || plan.kind === 'UNSUPPORTED') diagnostics.fail(plan.kind, 'plan');
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
        const result = await measure('tools', () => executeAssistantTool(repo, verified.actor, tool, timezone, asOf));
        tables.push(...result.tables); interpretation.push(...result.interpretation); limitations.push(...result.limitations);
        narratives.push(assistantToolNarrative(tool.name,result,language));
      } catch (e) { if (!(e instanceof AssistantError) || e.status === 403) throw e; limitations.push(`${e.code}: ${e.message}`); }
    }
    let sources: AssistantSource[] = [], contextSources: AssistantSource[] = [], summary = '', evidenceSpans: EvidenceSpan[] = [];
    let synthesis: AssistantSynthesis | undefined;
    let synthesisStatus: 'DISABLED' | 'NOT_ADMITTED' | 'ACCEPTED' | 'EXACT_FALLBACK' = synthesisEnabled ? 'NOT_ADMITTED' : 'DISABLED';
    let documentClarification: string | undefined;
    let preparedSelections: NonNullable<Awaited<ReturnType<typeof readPreparedSupport>>>['selections'] | undefined;
    if (['DOCUMENT', 'MIXED'].includes(plan.kind)) {
      if (process.env.KB_ENABLED !== 'true') { diagnostics.fail('NO_RELEVANT_SOURCE', 'catalog'); limitations.push('NO_RELEVANT_SOURCE: Published knowledge is not enabled. Ask an administrator.'); }
      else {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            preparedSelections = undefined;
            const prepared = documentContract && process.env.RAG_PREPARED_SUPPORT === 'true' && catalogSeeds === undefined
              ? await readPreparedSupport(assistantContextualQuestion(input.message, input.recent_context?.user_turns?.at(-1)), knowledgeEpoch, synthesisEnabled, {
                catalog: () => measure('catalog', () => rpc(verified.client, 'assistant_prepared_catalog', {
                  p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'),
                  p_compiler_fingerprint: config('RAG_PREPARATION_FINGERPRINT'),
                }, signal)),
                select: payload => measure('context', () => model('/v1/prepared-selection', payload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)),
                evidence: selections => measure('expand', () => rpc(verified.client, 'assistant_prepared_evidence', {
                  p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_selections: selections,
                  p_compiler_fingerprint: config('RAG_PREPARATION_FINGERPRINT'),
                }, signal)),
                answer: payload => measure('support', () => model('/v1/prepared-support', payload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)),
              }) : undefined;
            if (prepared) {
              if (prepared.result.outcome !== 'COMPLETE') throw new AssistantError('INCOMPLETE_EVIDENCE', 'Applicable prepared support could not be verified completely.', 400);
              const result = prepared.result;
              preparedSelections = prepared.selections;
              synthesis = synthesisEnabled ? result.synthesis! : undefined;
              synthesisStatus = synthesisEnabled ? 'ACCEPTED' : 'DISABLED';
              evidenceSpans = result.spans.map(span => ({ chunk_id: span.chunk_id, quote: span.quote, start: span.start, end: span.end }));
              sources = prepared.sources.filter(source => result.spans.some(span => span.chunk_id === source.chunk_id));
              contextSources = prepared.sources.filter(source => !sources.some(used => used.chunk_id === source.chunk_id));
              summary = synthesis ? synthesis.blocks.map(block => block.text).join('\n\n') : result.spans.map(span => span.quote).join('\n\n');
              diagnostics.count('closure_count', prepared.sources.length);
              diagnostics.count('bundle_count', result.counts.bundles);
              diagnostics.count('support_passes', result.counts.calls);
              diagnostics.count('support_units', result.counts.units);
            } else {
            let candidates: AssistantSource[];
            const queryMode = process.env.RAG_HYBRID_QUERY_MODE ?? 'expanded';
            const searchMode = process.env.RAG_HYBRID_MODE ?? 'fused';
            if (hybrid && (!['original', 'expanded'].includes(queryMode) || !['semantic', 'lexical', 'fused'].includes(searchMode))) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid retrieval evaluation configuration.', 503);
            const queries = assistantSearchQueries(input.message, queryMode === 'original' ? undefined : plan.search);
            if (catalogSeeds !== undefined) {
              if (!catalogSeeds.length) throw new AssistantError('NO_RELEVANT_SOURCE', copy.gap, 400);
              candidates = catalogSeeds;
            } else if (hybrid) {
              const batch = assistantEmbeddingBatchSchema.safeParse(await measure('embed', () => model('/v1/embed-queries', { queries }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
              if (!batch.success || batch.data.embeddings.length !== queries.length) throw new AssistantError('MODEL_UNAVAILABLE', 'Embedding configuration mismatch.', 503);
              const branches = assistantHybridCandidatesSchema.safeParse(await measure('retrieve', () => rpc(verified.client, 'assistant_search_hybrid', {
                p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'),
                p_vectors: batch.data.embeddings.map(item => item.vector), p_queries: queries, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')),
              }, signal)));
              if (!branches.success || branches.data.semantic.length !== queries.length || branches.data.lexical.length !== queries.length) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid retrieval result.', 503);
              candidates = fuseAssistantCandidates({ semantic: searchMode === 'lexical' ? queries.map(() => []) : branches.data.semantic,
                lexical: searchMode === 'semantic' ? queries.map(() => []) : branches.data.lexical });
            } else if (process.env.RAG_GUIDANCE_FAST_PATH === 'true' && queries.length > 1) {
              // PRD-F26 / QAD-TC44: the same bounded queries share one encoder
              // round trip. All original/aided branches retain normal authority.
              const batch = assistantEmbeddingBatchSchema.parse(await measure('embed', () => model('/v1/embed-queries', { queries: [assistantRetrievalQuery(input.message), ...queries.slice(1)] }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
              if (batch.embeddings.length !== queries.length) throw new AssistantError('DATA_UNAVAILABLE', 'Embedding configuration mismatch.', 503);
              const branches = await Promise.all(batch.embeddings.map(embedding => measure('retrieve', async () => assistantSourcesSchema.parse(await rpc(verified.client, 'assistant_search_knowledge', {
                p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_vector: embedding.vector, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')),
              }, signal)))));
              candidates = fuseAssistantCandidates({ semantic: branches, lexical: branches.map(() => []) });
            } else {
              const embedding = assistantSearchSchema.safeParse(await measure('embed', () => model('/v1/embed', { query: assistantRetrievalQuery(input.message) }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
              if (!embedding.success) throw new AssistantError('MODEL_UNAVAILABLE', 'Embedding configuration mismatch.', 503);
              candidates = assistantSourcesSchema.parse(await measure('retrieve', () => rpc(verified.client, 'assistant_search_knowledge', { p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_vector: embedding.data.vector, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')) }, signal)));
              // QAD-TC44: one bounded aid batch also checks weak nonempty hits.
              // A similarity hit alone does not prove the requested task was found.
              // Original wording remains in every search and final query;
              // no lexical migration or lowered similarity gate is required.
              const aids = assistantSearchQueries(input.message, plan.search).slice(1);
              if (aids.length) {
                const alternatives = assistantEmbeddingBatchSchema.parse(await measure('embed', () => model('/v1/embed-queries', { queries: aids }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
                if (alternatives.embeddings.length !== aids.length) throw new AssistantError('DATA_UNAVAILABLE', 'Embedding configuration mismatch.', 503);
                const branches = await Promise.all(alternatives.embeddings.map(alternative => measure('retrieve', async () => assistantSourcesSchema.parse(await rpc(verified.client, 'assistant_search_knowledge', { p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_vector: alternative.vector, p_min_similarity: Number(config('RAG_MIN_SIMILARITY')) }, signal)))));
                candidates = fuseAssistantCandidates({ semantic: [candidates, ...branches], lexical: [candidates, ...branches].map(() => []) });
              }
            }
            diagnostics.count('candidate_count', candidates.length);
            diagnostics.units('ranked', candidates.map(source => source.chunk_id));
            if (documentContract && candidates.length) {
              entry.stage = 'preparing';
              // Payment audit / MS65: retrieval neighbors are candidates, not
              // mandatory whole-document context. Select by meaning first;
              // expansion and independent verification still inspect every
              // canonical unit of each selected authorized generation.
              let documentSeeds = candidates.map(source => source.chunk_id);
              if (catalogSeeds === undefined && new Set(candidates.map(source => source.version_id)).size > 1) {
                const documentIndexes = new Map([...new Set(candidates.map(source => source.version_id))].map((version, index) => [version, index]));
                const selection = assistantContextSelectionSchema.parse(await measure('context', () => model('/v1/context', {
                  evidence_contract: 'ms65-v1', reliability_contract: 'ms60-v1', query: plan.query || input.message,
                  original_query: assistantContextualQuestion(input.message, input.recent_context?.user_turns?.at(-1)),
                  sources: candidates.map(({ chunk_id, title, heading_path, content, version_id }) => ({ chunk_id, title, heading_path, content, document_index: documentIndexes.get(version_id)! })),
                }, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
                selectionAttempts++; diagnostics.count('selection_attempts', selectionAttempts);
                if (selection.chunk_ids.some(id => !candidates.some(source => source.chunk_id === id))) throw new AssistantError('INVALID_MODEL_OUTPUT', copy.modelOutput, 503);
                if (selection.ambiguous) throw new AssistantError('AMBIGUOUS_SCOPE', 'Which task or procedure do you mean?', 400);
                documentSeeds = selection.chunk_ids;
              }
              if (!documentSeeds.length) throw new AssistantError('NO_RELEVANT_SOURCE', copy.gap, 400);
              const selectedVersions = new Set<string>();
              documentSeeds = documentSeeds.filter(id => {
                const version = candidates.find(source => source.chunk_id === id)!.version_id;
                if (selectedVersions.has(version)) return false;
                selectedVersions.add(version); return true;
              });
              diagnostics.count('selected_count', documentSeeds.length);
              const documentEvidence = assistantDocumentEvidenceSchema.parse(await measure('expand', () => rpc(verified.client, 'assistant_document_evidence', {
                p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'),
                p_chunks: documentSeeds,
              }, signal)));
              if (documentEvidence.epoch !== knowledgeEpoch || documentEvidence.sources.some(s => s.epoch !== knowledgeEpoch || createHash('sha256').update(s.content).digest('hex') !== s.content_hash)) throw new AssistantError('KNOWLEDGE_CHANGED', 'Source generation changed. Please retry.', 409);
              const supportPayload = { contract: 'ms65-v1', synthesis: synthesisEnabled, query: assistantContextualQuestion(input.message, input.recent_context?.user_turns?.at(-1)), sources: documentEvidence.sources };
              if (Buffer.byteLength(JSON.stringify(supportPayload), 'utf8') > 260000) throw new AssistantError('INCOMPLETE_EVIDENCE', 'CONTEXT_BUDGET: Ask about one narrower task.', 400);
              const result = validateDocumentSupport(await measure('support', () => model('/v1/document-support', supportPayload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)), createHash('sha256').update(JSON.stringify(supportPayload)).digest('hex'), documentEvidence.sources);
              if (!result) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Document support could not be verified.', 503);
              diagnostics.count('closure_count', documentEvidence.sources.length);
              diagnostics.count('bundle_count', result.counts.bundles);
              diagnostics.count('support_passes', result.counts.calls);
              diagnostics.count('support_units', result.counts.units);
              if (result.outcome === 'CONFLICT') throw new AssistantError('CONFLICTING_SOURCES', copy.conflict, 400);
              if (result.outcome === 'CLARIFY') throw new AssistantError('AMBIGUOUS_SCOPE', result.clarification!, 400);
              if (result.outcome === 'COMPLETE') {
                synthesis = synthesisEnabled ? result.synthesis! : undefined;
                synthesisStatus = synthesisEnabled ? 'ACCEPTED' : 'DISABLED';
                evidenceSpans = result.spans.map(span => ({chunk_id: span.chunk_id!, quote: span.quote!, start: span.start!, end: span.end!}));
                sources = documentEvidence.sources.filter(s => result.spans.some(span => span.chunk_id === s.chunk_id));
                diagnostics.units('closure', sources.map(source => source.chunk_id));
                // All inspected sources influence completeness, even if uncited.
                contextSources = documentEvidence.sources.filter(s => !sources.some(used => used.chunk_id === s.chunk_id));
                summary = synthesis ? synthesis.blocks.map(block => block.text).join('\n\n') : result.spans.map(span => span.quote).join('\n\n');
              } else limitations.push(`NO_RELEVANT_SOURCE: ${copy.gap}`);
            } else {
            const faqSeed = !input.recent_context?.user_turns?.length && !input.recent_context?.selections
              ? selectFaqSeed(input.message, candidates.map(source => ({ chunk_id: source.chunk_id!, heading_path: source.heading_path!, content: source.content! }))) : undefined;
            // Only user history may resolve a document follow-up for answering.
            // Model alternatives remain search aids, not part of the question.
            const previous = input.recent_context?.user_turns?.at(-1);
            const contextualQuestion = assistantContextualQuestion(input.message, previous);
            const query = hybrid ? contextualQuestion.length <= 3000 ? contextualQuestion : input.message : faqSeed ? input.message : plan.query || input.message;
            // MS56-TC01/05: select before closure. SQL still validates every
            // chunk and manifest of each selected generation before expansion.
            // No guessed paragraph scopes or independent batch unions are used.
            const directSeed = faqSeed || selectProcedureSeed(input.message, candidates.map(source => ({ chunk_id: source.chunk_id, heading_path: source.heading_path, content: source.content })));
            diagnostics.count('selected_count', candidates.length);
            const directSeeds = directSeed ? [directSeed] : selectGovernanceSeeds(input.message, candidates.map(source => ({ chunk_id: source.chunk_id!, content: source.content! })));
            const guaranteeSeeds = selectBookingGuaranteeSeeds(input.message,
              candidates.map(source => ({ chunk_id: source.chunk_id!, content: source.content! })));
            let selectedIds = guaranteeSeeds ?? directSeeds ?? candidates.map(source => source.chunk_id);
            // PRD-F4: a source-backed single inventory decision need not ask
            // a generative selector to choose it over an unrelated checklist.
            // This is provisional support: canonical expansion, independent
            // applicability and final actor/source/epoch checks still run.
            let coverage: AssistantCoverage | undefined = guaranteeSeeds
              ? { scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [] } : undefined;
            let obligations: AssistantObligation[] = guaranteeSeeds ? [{ id: 'o0',
              request: 'Whether workspace selection establishes reservation inventory', kind: 'FACT',
              status: 'SUPPORTED', chunk_ids: guaranteeSeeds }] : [];
            if (guaranteeSeeds) {
              diagnostics.count('requested_count', 1); diagnostics.count('supported_count', 1);
            }
            const costs = evidenceV3 && candidates.length ? assistantEvidenceCostsSchema.parse(await measure('expand', () => rpc(verified.client, 'assistant_evidence_costs', {
              p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_chunks: candidates.map(source => source.chunk_id),
            }, signal))) : undefined;
            if (costs && (costs.epoch !== knowledgeEpoch || costs.roots.length !== candidates.length || costs.roots.some(root => !candidates.some(source => source.chunk_id === root.chunk_id)))) throw new AssistantError('KNOWLEDGE_CHANGED', 'Evidence costs changed. Please retry.', 409);
            const choose = async (reconsider = false): Promise<ReturnType<typeof assistantContextSelectionSchema.parse>> => {
              if (selectionAttempts >= 2) throw new AssistantError('INCOMPLETE_EVIDENCE', 'SELECTION_EXHAUSTED: Evidence selection could not be completed reliably. Please retry.', 400);
              selectionAttempts++; diagnostics.count('selection_attempts', selectionAttempts);
              try {
              // MS60-TC15: omit unused database metadata, never candidate text.
              const selectionPayload = { query, original_query: input.message, reliability_contract: 'ms60-v1',
                sources: candidates.map(({ chunk_id, title, heading_path, content }) => ({ chunk_id, title, heading_path, content })), contract_version: evidenceV3 ? 3 : 2,
                ...(costs ? { costs: costs.roots.map(root => ({ index: candidates.findIndex(source => source.chunk_id === root.chunk_id), source_count: root.source_count, bytes: root.bytes, complete: root.complete })) } : {}),
                ...(reconsider ? { reconsider: true, prior_coverage: coverage, prior_obligations: obligations } : {}) };
              diagnostics.count('selection_bytes', Buffer.byteLength(JSON.stringify(selectionPayload), 'utf8'));
              if (Buffer.byteLength(JSON.stringify(selectionPayload), 'utf8') > evidenceBudget.request_bytes) throw new AssistantError('INCOMPLETE_EVIDENCE', 'Candidate comparison exceeds the supported context budget.', 400);
              const parsed = assistantContextSelectionSchema.safeParse(await measure('context', () => model('/v1/context', selectionPayload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
              if (!parsed.success || parsed.data.chunk_ids.some(id => !candidates.some(source => source.chunk_id === id))) throw new AssistantError('INVALID_MODEL_OUTPUT', copy.modelOutput, 503);
              if (evidenceV3 || parsed.data.obligations) {
                const mapped = parsed.data.obligations;
                if (!mapped || new Set(mapped.map(o => o.id)).size !== mapped.length || mapped.some(o => o.chunk_ids.some(id => !parsed.data.chunk_ids.includes(id))) || parsed.data.coverage?.outcome === 'COMPLETE' && (!mapped.length || mapped.some(o => o.status !== 'SUPPORTED'))) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Requested-detail coverage could not be verified.', 503);
                obligations = mapped;
                diagnostics.count('requested_count', mapped.length);
                diagnostics.count('supported_count', mapped.filter(o => o.status === 'SUPPORTED').length);
              }
              return parsed.data;
              } catch (error) {
                // QAD-TC44: malformed selection consumes the same global ceiling.
                if (error instanceof AssistantError && error.code === 'INVALID_MODEL_OUTPUT' && selectionAttempts < 2 && budget.remaining() > 10000) {
                  diagnostics.fail('INVALID_SELECTION', 'context');
                  return choose(reconsider);
                }
                throw error;
              }
            };
            if (!guaranteeSeeds && candidates.length && (synthesisEnabled || !directSeeds?.length || candidates.some(source => !directSeeds.includes(source.chunk_id)))) {
              entry.stage = 'preparing';
              const selection = await choose();
              if (selection.chunk_ids.some(id => !candidates.some(candidate => candidate.chunk_id === id))) throw new AssistantError('INVALID_MODEL_OUTPUT', copy.modelOutput, 503);
              if (selection.ambiguous) throw new AssistantError('AMBIGUOUS_SCOPE', selection.coverage?.clarification ?? copy.documentClarify, 400);
              coverage = selection.coverage;
              if (coverage?.scope === 'DOCUMENT_WIDE' && coverage.outcome === 'COMPLETE') throw new AssistantError('INCOMPLETE_CONTEXT', 'Document-wide coverage has not been verified. Ask for a specific topic or ask an administrator to review broader source coverage.', 400);
              if (coverage?.outcome === 'CONFLICT') throw new AssistantError('CONFLICTING_SOURCES', copy.conflict, 400);
              selectedIds = selection.chunk_ids;
            }
            diagnostics.count('selected_count', selectedIds.length);
            const expand = async () => {
              if (expansionAttempts >= 2) throw new AssistantError('INCOMPLETE_EVIDENCE', 'SELECTION_EXHAUSTED: Evidence selection could not be completed reliably. Please retry.', 400);
              if (costs) {
                const unique = new Set(costs.roots.filter(root => selectedIds.includes(root.chunk_id)).flatMap(root => root.members));
                diagnostics.count(expansionAttempts === 0 ? 'first_union_count' : 'final_union_count', unique.size);
              }
              expansionAttempts++; diagnostics.count('expansion_attempts', expansionAttempts);
              const result = assistantEvidenceSchema.parse(await measure('expand', () => rpc(verified.client, evidenceV3 ? 'assistant_expand_evidence_v3' : 'assistant_expand_evidence', {
              p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_chunks: selectedIds,
              }, signal)));
              if (!result.complete && 'reason' in result && result.reason === 'REPROCESS_REQUIRED') {
                await checkRejectedReader(verified.client, [...new Set(candidates.filter(source => selectedIds.includes(source.chunk_id)).map(source => source.version_id))], signal);
              }
              return result;
            };
            let expanded = selectedIds.length ? await expand() : { complete: true as const, sources: [], groups: [] };
            const evidencePayload = () => ({ query, original_query: input.message, reliability_contract: 'ms60-v1', sources: expanded.sources,
              ...(expanded.complete && expanded.groups ? { groups: expanded.groups, required_chunk_ids: expanded.sources.map(source => source.chunk_id) } : {}),
              ...(coverage && expanded.complete && expanded.groups && expanded.sources.length ? { coverage } : {}), ...(faqSeed ? { exact_faq: true } : {}),
              ...('context_sources' in expanded && expanded.context_sources?.length ? { context_sources: expanded.context_sources } : {}),
            });
            const packingOverflows = async () => {
              if (!expanded.complete || !expanded.sources.length || expansionOverflows()) return false;
              const packedPayload = evidencePayload();
              const parsedCost = assistantPackingCostSchema.safeParse(await measure('expand', () => model('/v1/evidence-cost', packedPayload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)));
              if (!parsedCost.success) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Packing contract could not be verified.', 503);
              const cost = parsedCost.data;
              if (cost.binding !== createHash('sha256').update(JSON.stringify(packedPayload)).digest('hex')) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Packing identity could not be verified.', 503);
              diagnostics.count('packed_quote_count', cost.quote_count);
              diagnostics.count('max_quote_utf16', cost.max_quote_utf16);
              if (!cost.fits) diagnostics.fail('OUTPUT_BUDGET_EXCEEDED', 'expand');
              return !cost.fits;
            };
            const expansionOverflows = () => expanded.complete && Buffer.byteLength(JSON.stringify(evidencePayload()), 'utf8') > evidenceBudget.request_bytes;
            // MS59-TC10/12: reconsider direct support, never cut a dependency.
            let packedOverflow = await packingOverflows();
            let reconsiderationCause: 'OUTPUT_BUDGET_EXCEEDED' | 'CONTEXT_BUDGET' | undefined;
            if (!guaranteeSeeds && (packedOverflow || expansionOverflows() || !expanded.complete && 'reason' in expanded && expanded.reason === 'CONTEXT_BUDGET') && selectionAttempts < 2 && expansionAttempts < 2 && budget.remaining() > 10000) {
              reconsiderationCause = packedOverflow ? 'OUTPUT_BUDGET_EXCEEDED' : 'CONTEXT_BUDGET';
              diagnostics.fail('CONTEXT_BUDGET', 'expand');
              diagnostics.fail('SELECTION_OVERFLOW', 'expand');
              const selection = await choose(true);
              if (selection.ambiguous) throw new AssistantError('AMBIGUOUS_SCOPE', selection.coverage?.clarification ?? copy.documentClarify, 400);
              if (selection.coverage?.outcome === 'CONFLICT') throw new AssistantError('CONFLICTING_SOURCES', copy.conflict, 400);
              if (selection.coverage?.scope === 'DOCUMENT_WIDE') throw new AssistantError('INCOMPLETE_CONTEXT', 'Document-wide coverage has not been verified.', 400);
              coverage = selection.coverage; selectedIds = selection.chunk_ids;
              expanded = selectedIds.length ? await expand() : { complete: true as const, sources: [], groups: [] };
              packedOverflow = await packingOverflows();
            }
            if (!selectedIds.length && reconsiderationCause) throw new AssistantError('INCOMPLETE_EVIDENCE', `SELECTION_EXHAUSTED: ${reconsiderationCause}: Complete evidence could not be prepared within the verified capacity. Ask about one narrower task.`, 400);
            if (packedOverflow) throw new AssistantError('INCOMPLETE_EVIDENCE', 'SELECTION_EXHAUSTED: OUTPUT_BUDGET_EXCEEDED: Complete applicable support could not be prepared within the verified output capacity. Please retry.', 400);
            if (expansionOverflows()) throw new AssistantError('INCOMPLETE_EVIDENCE', 'SELECTION_EXHAUSTED: CONTEXT_BUDGET: Evidence selection could not be completed reliably within the supported request size. Please retry.', 400);
            if (!expanded.complete && 'reason' in expanded && expanded.reason === 'CONTEXT_BUDGET') throw new AssistantError('INCOMPLETE_EVIDENCE', 'SELECTION_EXHAUSTED: CONTEXT_BUDGET: Evidence selection could not be completed reliably within the supported capacity. Please retry.', 400);
            contextSources = expanded.complete && 'context_sources' in expanded ? expanded.context_sources ?? [] : [];
            diagnostics.count('context_source_count', contextSources.length);
            const groups = expanded.complete ? expanded.groups?.map(group => ({ id: group.id!, chunk_ids: group.chunk_ids!, requires: group.requires! })) : undefined;
            const reason = 'reason' in expanded ? expanded.reason : 'CONTEXT_BUDGET';
            if (coverage && expanded.complete && expanded.sources.length && !groups) throw new AssistantError('INCOMPLETE_CONTEXT', 'Reviewed support structure is unavailable. Ask an administrator to review or reprocess the document.', 400);
            const requiredChunkIds = groups ? expanded.sources.map(source => source.chunk_id) : undefined;
            const payload = evidencePayload();
            diagnostics.count('closure_count', expanded.sources.length);
            diagnostics.units('closure', expanded.sources.map(source => source.chunk_id));
            diagnostics.count('group_count', groups?.length ?? 0);
            diagnostics.count('evidence_bytes', Buffer.byteLength(JSON.stringify(payload), 'utf8'));
            const fits = expanded.complete && Buffer.byteLength(JSON.stringify(payload), 'utf8') <= evidenceBudget.request_bytes;
            const evidence: AssistantSource[] = fits ? expanded.sources : [];
            if (!fits) diagnostics.fail(!expanded.complete && reason !== 'CONTEXT_BUDGET' ? reason === 'REPROCESS_REQUIRED' ? 'REPROCESS_REQUIRED' : 'UNRESOLVED_CONTEXT' : 'CONTEXT_BUDGET', 'expand');
            if (!fits) limitations.push(!expanded.complete && reason !== 'CONTEXT_BUDGET' ? `INCOMPLETE_CONTEXT: ${reason}: ${reason === 'REPROCESS_REQUIRED' ? copy.reprocess : copy.context}` : `INCOMPLETE_EVIDENCE: CONTEXT_BUDGET: ${copy.incomplete}`);
            // Prior assistant facts and report rows never enter the model context.
            entry.stage = 'preparing';
            let groundingReason: DiagnosticReason | undefined;
            const selected = evidence.length ? groundedQuotes(await measure('answer', () => model('/v1/answer', payload, entry!.capability, signal, timing, budget, diagnostics, cloudIdentity)), evidence, query, groups, reason => { groundingReason = reason; diagnostics.fail(reason, 'grounding'); }, requiredChunkIds) : { summary: '', sources: [], conflicting: false };
            summary = selected.summary; sources = selected.sources; evidenceSpans = 'evidence_spans' in selected ? selected.evidence_spans ?? [] : [];
            synthesis = undefined;
            // Synthesis is admitted only AFTER independently safe exact coverage.
            // Failure cannot use excerpts to bypass any closure/integrity gate.
            if (synthesisEnabled && summary && budget.remaining() <= 2500) diagnostics.fallback('BUDGET_NOT_ADMITTED');
            if (synthesisEnabled && summary && !assistantSynthesisLanguageAdmitted(language, conciseMain)) diagnostics.fallback('TRANSLATION_GATED');
            if (synthesisEnabled && summary && coverage?.scope === 'COMPLETE_PROCEDURE' && !conciseMain) {
              synthesisStatus = 'EXACT_FALLBACK'; diagnostics.fallback('PROCEDURE_EXACT');
            }
            if (synthesisEnabled && assistantSynthesisLanguageAdmitted(language, conciseMain) && summary && !selected.conflicting && coverage && (coverage.scope !== 'COMPLETE_PROCEDURE' || conciseMain) && groups && evidenceSpans.length && budget.remaining() > 2500) {
              if (sources.some(source => createHash('sha256').update(source.content).digest('hex') !== source.content_hash)) throw new AssistantError('INCOMPLETE_CONTEXT', 'Source integrity could not be verified.', 400);
              const synthesisBudget = new RequestBudget(signal, Math.min(8000, budget.remaining() - 2000));
              // MS61: preserve multilingual intent while independently requesting English output.
              const synthesisPayload = { query: contextualQuestion, coverage, sources, spans: evidenceSpans,
                ...(conciseMain ? { presentation_contract: 'ms60-concise-v1', language } : {}) };
              synthesisStatus = 'EXACT_FALLBACK';
              let optionalStage: 'SYNTHESIS' | 'SUPPORT' = 'SYNTHESIS';
              try {
                const candidate = validateAssistantSynthesis(await synthesisBudget.run(() => measure('synthesis', () => model('/v1/synthesis', synthesisPayload, entry!.capability, synthesisBudget.signal, timing, synthesisBudget, diagnostics, cloudIdentity))), coverage, evidenceSpans, sources, contextualQuestion);
                if (candidate && (!candidate.main_blocks || conciseMain)) {
                  optionalStage = 'SUPPORT';
                  const verdict = assistantSupportVerdictSchema.safeParse(await synthesisBudget.run(() => measure('support', () => model('/v1/support', { ...synthesisPayload, candidate }, entry!.capability, synthesisBudget.signal, timing, synthesisBudget, diagnostics, cloudIdentity))));
                  if (verdict.success) {
                    diagnostics.count('support_claims', verdict.data.supported.length);
                    diagnostics.count('support_accepted', verdict.data.supported.filter(Boolean).length);
                    diagnostics.count('support_complete', Number(verdict.data.complete));
                    diagnostics.count('support_consistent', Number(verdict.data.consistent));
                    diagnostics.count('support_evidence_safe', Number(verdict.data.evidence_safe));
                  }
                  if (verdict.success && !verdict.data.consistent) throw new AssistantError('CONFLICTING_SOURCES', copy.conflict, 400);
                  if (verdict.success && !verdict.data.evidence_safe) throw new AssistantError('INCOMPLETE_CONTEXT', 'Required source context could not be verified.', 400);
                  if (verdict.success && assistantSynthesisSupported(verdict.data, candidate)) {
                    synthesis = candidate;
                    synthesisStatus = 'ACCEPTED';
                    summary = (candidate.main_blocks ?? candidate.blocks).map(block => block.text).join('\n\n');
                  } else diagnostics.fallback(verdict.success ? 'SUPPORT_REJECTED' : 'SUPPORT_SCHEMA_REJECTED', optionalStage);
                } else diagnostics.fallback('SCHEMA_REJECTED', optionalStage);
              } catch (error) {
                diagnostics.fallback(synthesisBudget.signal.aborted || error instanceof AssistantError && ['MODEL_TIMEOUT', 'REQUEST_TIMEOUT'].includes(error.code) ? 'TIMEOUT' : error instanceof AssistantError && error.code === 'INCOMPLETE_EVIDENCE' ? 'BUDGET_NOT_ADMITTED' : error instanceof AssistantError && error.code === 'INVALID_MODEL_OUTPUT' ? optionalStage === 'SUPPORT' ? 'SUPPORT_SCHEMA_REJECTED' : 'SCHEMA_REJECTED' : 'SERVICE_FAILURE', optionalStage);
                if (signal.aborted || error instanceof AssistantError && (error.status === 403 || ['CONFLICTING_SOURCES', 'INCOMPLETE_CONTEXT'].includes(error.code))) throw error;
                // Rejected prose stays request-local and is never emitted/logged.
                // Already grounded exact evidence remains the independent fallback.
              } finally { synthesisBudget.close(); }
              if (!synthesis) summary = await measure('fallback', async () => selected.summary);
            }
            if (fits && !summary && !selected.conflicting && !groundingReason && /\b(how much|magkano|amount|refund rate|cancellation fee)\b/i.test(input.message)) limitations.push(`NO_RELEVANT_SOURCE: ${copy.amountGap}`);
            if (fits && !summary) diagnostics.fail(selected.conflicting ? 'CONFLICTING_SOURCES' : 'NO_RELEVANT_SOURCE', 'grounding');
            if (summary && coverage?.outcome === 'PARTIAL_GENERAL') limitations.push(...coverage.gaps.map(gap => `PARTIAL_GENERAL: Not verified from retrieved passages: ${gap}`));
            if (fits && !summary && !limitations.some(line => line.startsWith('NO_RELEVANT_SOURCE:'))) limitations.push(...(groundingReason && ['INVALID_QUOTES', 'INVALID_GROUPS', 'INVALID_SOURCE_QUOTE'].includes(groundingReason) ? [`INVALID_MODEL_OUTPUT: ${copy.modelOutput}`] : groundingReason === 'INCOMPLETE_COVERAGE' || groundingReason === 'INJECTION_REJECTED' ? [`INCOMPLETE_CONTEXT: Required selected evidence could not be completely verified. Ask an administrator to review the applicable source context.`] : selected.conflicting ? [`CONFLICTING_SOURCES: ${copy.conflict}`] : coverage?.outcome === 'INSUFFICIENT' && coverage.gaps.length ? coverage.gaps.map(gap => `NO_RELEVANT_SOURCE: Not verified from retrieved passages: ${gap}`) : [`NO_RELEVANT_SOURCE: ${copy.gap}`]));
            }
            }
          } catch (e) {
            diagnostics.error(e);
            if (e instanceof AssistantError && e.status === 403) throw e;
            if (signal.aborted) throw e;
            const code = e instanceof AssistantError ? e.code : 'DATA_UNAVAILABLE';
            if (code === 'AMBIGUOUS_SCOPE' && e instanceof AssistantError) documentClarification = e.message;
            limitations.push(`${code}: ${code === 'AMBIGUOUS_SCOPE' ? 'Clarification is required to choose the applicable task.' : (code === 'INCOMPLETE_CONTEXT' || code === 'INCOMPLETE_EVIDENCE' || code === 'MODEL_UNAVAILABLE' && e instanceof AssistantError && e.message.startsWith('READER_INCOMPATIBLE:')) && e instanceof AssistantError ? e.message : code === 'NO_RELEVANT_SOURCE' ? copy.gap : code === 'CONFLICTING_SOURCES' ? copy.conflict : code === 'INVALID_MODEL_OUTPUT' ? copy.modelOutput : code === 'MODEL_TIMEOUT' || code === 'REQUEST_TIMEOUT' ? copy.modelTimeout : code === 'MODEL_UNAVAILABLE' ? 'The answer service is temporarily unavailable. Verified tables remain available.' : 'The document service is unavailable. Please retry. Verified tables remain available.'}`); sources = []; contextSources = []; summary = ''; synthesis = undefined; evidenceSpans = []; preparedSelections = undefined;
          }
          const current = await measure('catalog', () => epoch(verified.client, signal));
          if (!summary) synthesisStatus = synthesisEnabled ? 'NOT_ADMITTED' : 'DISABLED';
          if (current === knowledgeEpoch) break;
          diagnostics.fail('KNOWLEDGE_CHANGED', 'catalog');
          diagnostics.count('epoch', current);
          sources = []; contextSources = []; summary = ''; evidenceSpans = []; synthesis = undefined; documentClarification = undefined; knowledgeEpoch = current;
          synthesisStatus = synthesisEnabled ? 'NOT_ADMITTED' : 'DISABLED';
          limitations.splice(0, limitations.length, ...limitations.filter(item => !/^(PARTIAL_GENERAL|AMBIGUOUS_SCOPE|INCOMPLETE_|NO_RELEVANT_SOURCE|CONFLICTING_SOURCES|DATA_UNAVAILABLE|MODEL_UNAVAILABLE|KNOWLEDGE_CHANGED)/.test(item)));
          if (attempt === 1 || selectionAttempts >= 2 || expansionAttempts >= 2) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
        }
      }
    }
    // Final source and actor checks happen before returning even one byte of evidence.
    const finalIdentity = await measure('auth', () => authorizeAssistant(request, signal));
    if (finalIdentity.actor.id !== verified.actor.id || finalIdentity.actor.role !== verified.actor.role) throw new AssistantError('FORBIDDEN', 'Account permissions changed.', 403);
    const finalSources = [...sources, ...contextSources];
    if (preparedSelections && finalSources.length) {
      const snapshot = preparedSupportEvidenceSchema.safeParse(await measure('evidence', () => rpc(verified.client, 'assistant_prepared_evidence', {
        p_actor: finalIdentity.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_selections: preparedSelections,
        p_compiler_fingerprint: config('RAG_PREPARATION_FINGERPRINT'),
      }, signal)));
      if (!snapshot.success || snapshot.data.epoch !== knowledgeEpoch || snapshot.data.sources.length !== finalSources.length
        || finalSources.some(source => !snapshot.data.sources.some(current => JSON.stringify(current) === JSON.stringify(source)))) {
        throw new AssistantError('KNOWLEDGE_CHANGED', 'Prepared sources or permissions changed. Please retry.', 409);
      }
    } else if (documentContract && finalSources.length) {
      // MS65: one actor/scoped database snapshot checks ALL inspected chunks,
      // including uncited context, without repeated network round trips.
      const roots = [...new Map(finalSources.map(source => [source.version_id, source.chunk_id])).values()];
      const snapshot = assistantDocumentEvidenceSchema.safeParse(await measure('evidence', () => rpc(verified.client, 'assistant_document_evidence', {
        p_actor: finalIdentity.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_chunks: roots,
      }, signal)));
      if (!snapshot.success || snapshot.data.epoch !== knowledgeEpoch || snapshot.data.sources.length !== finalSources.length
        || finalSources.some(source => !snapshot.data.sources.some(current => JSON.stringify(current) === JSON.stringify(source)))) {
        throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
      }
    } else for (let offset = 0; offset < finalSources.length; offset += 4) await Promise.all(finalSources.slice(offset, offset + 4).map(async source => {
      const current = await measure('evidence', () => rpc(verified.client, 'assistant_read_source', { p_actor: verified.actor.id, p_scope: config('RAG_SCOPE_ID'), p_fingerprint: config('RAG_EMBEDDING_FINGERPRINT'), p_version: source.version_id, p_chunk: source.chunk_id }, signal));
      const checked = assistantSourceSchema.safeParse(current);
      if (!checked.success || checked.data.content_hash !== source.content_hash || checked.data.content !== source.content || checked.data.epoch !== knowledgeEpoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
    }));
    if (await measure('catalog', () => requireKnowledge(finalIdentity, signal)) !== knowledgeEpoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Please retry.', 409);
    budget.check();
    if (sources.length) limitations.push(copy.sourceLanguage);
    diagnostics.count('epoch', knowledgeEpoch);
    const presentation = answerContract === 'ms59-v1' && !synthesis && evidenceSpans.length ? exactAssistantPresentation(evidenceSpans) : undefined;
    if (presentation) {
      const projection = exactAssistantMainAtoms(evidenceSpans, presentation.atoms, sources);
      diagnostics.exact(projection.status, projection.omitted, projection.atoms.length);
    }
    const answer = assistantAnswerSchema.parse({ kind: plan.kind,
      outcome: assistantOutcome({ kind: plan.kind, citations: sources, limitations }),
      summary: [summary,...narratives].filter(Boolean).join('\n\n') || (tables.length ? copy.verified : plan.kind === 'CLARIFY' ? plan.clarification || copy.clarify : plan.kind === 'UNSUPPORTED' ? copy.unsupported : limitations.some(item => /^(INCOMPLETE_|DATA_UNAVAILABLE|MODEL_UNAVAILABLE|MODEL_TIMEOUT|REQUEST_TIMEOUT|INVALID_MODEL_OUTPUT|CAPACITY_BUSY|KNOWLEDGE_CHANGED)/.test(item)) ? copy.documentUnavailable : limitations.some(item => item.startsWith('AMBIGUOUS_SCOPE:')) ? documentClarification ?? copy.documentClarify : limitations.some(item => item.startsWith('CONFLICTING_SOURCES:')) ? copy.conflict : copy.gap),
      tables, citations: sources.map(({ content: _content, ...metadata }) => metadata), interpretation: [...new Set(interpretation)], as_of: asOf,
      business_timezone: timezone, ...(sources.length && evidenceSpans.length ? { evidence_spans: evidenceSpans } : {}),
      ...(synthesis ? { synthesis } : {}),
      ...(presentation ? { presentation } : {}),
      synthesis_status: synthesisStatus,
      answer_mode: synthesis ? synthesis.outcome === 'PARTIAL_GENERAL' ? 'PARTIAL_GENERAL' : 'SYNTHESIZED' : summary ? 'EXACT' : documentClarification || plan.kind === 'CLARIFY' ? 'CLARIFICATION' : limitations.some(line => line.startsWith('CONFLICTING_SOURCES:')) ? 'CONFLICT' : limitations.some(line => /^(INCOMPLETE_|DATA_UNAVAILABLE|MODEL_UNAVAILABLE|MODEL_TIMEOUT|REQUEST_TIMEOUT|INVALID_MODEL_OUTPUT)/.test(line)) ? 'FAILURE' : tables.length ? 'EXACT' : 'EVIDENCE_GAP',
      limitations: [...new Set(limitations)], knowledge_epoch: knowledgeEpoch, request_id: requestId, selections: plan.tools[0] });
    return finish(await measure('serialize', async () => Response.json({ data: answer }, { headers: noStore })));
  } catch (e) {
    diagnostics.error(budget?.signal.aborted ? budget.failure() : e);
    if (budget?.signal.aborted) return finish(assistantFailure(budget.failure()));
    return finish(assistantFailure(e));
  } finally {
    budget?.close();
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
    const result = await availability(verified, request.signal, true);
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
    const stage = item?.actor.id === actor.id && item.session === parsed.data.session_id ? item.stage : 'checking';
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
    const db = client(item.controller.signal); await recheck(db, item.actor); item.callbacks++;
    const input = await jsonBody(request, item.controller.signal);
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
