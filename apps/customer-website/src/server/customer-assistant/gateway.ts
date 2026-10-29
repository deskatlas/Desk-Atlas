import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { knowledgeValidation as z } from '@deskatlas/validation';
import { CustomerKnowledgeReader, CustomerRequestControl, admitCustomerPlan, signCustomerCapability, subjectDigest } from '@deskatlas/server/assistant';
import { createCloudRunIdentity } from '@deskatlas/server/cloudRun';
import { decidePublicSpots, createPublishedMapService, SupabasePublishedMapRepository, QueryCache, validateDocumentSupport, AvailabilityValidationError, type PublishedFloorMap, type ApprovedCharacteristic } from '@deskatlas/domain';
import { assistantDocumentEvidenceSchema, assistantSearchSchema, assistantSourceSchema, customerActionSchema, customerControlIdentitySchema,
  customerSourceRequestSchema, publicCustomerQuerySchema, publicCustomerResponseSchema,
  type CustomerCapability, type PublicCustomerQuery, type PublicCustomerResponse } from '@deskatlas/validation';
import { assistantConfig as config, CustomerAssistantError, customerRequestBody, keyedDigest, publicVisitor, trustedClientIp } from './security';
import { authorizeVerifiedCustomer, VerifiedCustomerError } from './verified';
import { buildVerifiedResponse } from './verifiedResponse';
import { buildVerifiedPolicyAddendum } from './verifiedKnowledge';
import { publicSpotRepository, resolvePublicComparison, resolvePublicWorkspaceContext, publicWorkspaceOverview, publicWorkspaceTypes } from './spots';
import { requestsPrivateRecord, mergeConversationConstraints, missingScheduleQuestion, customerConversationTask } from './conversation';
import { readCustomerDiscoveryCatalog } from './catalog';

const headers = { 'Cache-Control': 'no-store, private', Vary: 'Authorization, Cookie, Origin', 'X-Content-Type-Options': 'nosniff' };
const currentPublishedMaps = new QueryCache<PublishedFloorMap | null>(0);
const knowledgeGaps: Record<string, string> = {
  UNRESOLVED_CONTEXT: 'The published customer documents do not establish a complete answer to that question. Please ask about one part of the policy, or contact the front desk for the missing details.',
  CONFLICTING_SOURCES: 'The published customer documents contain conflicting guidance for that question. Please ask the front desk to confirm the applicable policy.',
  CONTEXT_BUDGET_EXCEEDED: 'That question covers more source material than I can verify in one answer. Please ask about one topic at a time.',
  OUTPUT_BUDGET_EXCEEDED: 'The complete guidance is too long for one verified answer. Please ask about one step or policy at a time.',
};
function response(body: unknown, status = 200, cookie?: string, retryAfter?: number) {
  return Response.json(body, { status, headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}), ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
}
function enabled() {
  if (process.env.CUSTOMER_ASSISTANT_ENABLED !== 'true') throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
}
async function authority(request: Request, query: boolean, requireCookie = false) {
  // Any supplied credential is validated; malformed/expired credentials never downgrade.
  if (request.headers.has('authorization')) {
    const verified = await authorizeVerifiedCustomer(request, query);
    if (process.env.CUSTOMER_ASSISTANT_VERIFIED_ENABLED !== 'true') throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
    return { principal: 'VERIFIED_CUSTOMER' as const, sub: verified.customerId, cookie: undefined, verified, authorize: verified.reauthorize };
  }
  const visitor = publicVisitor(request, requireCookie);
  return { principal: 'PUBLIC_VISITOR' as const, sub: visitor.id, cookie: visitor.cookie, verified: undefined,
    authorize: async () => { publicVisitor(request, requireCookie); } };
}
function database(signal: AbortSignal) {
  return createClient(process.env.SUPABASE_URL || config('NEXT_PUBLIC_SUPABASE_URL'), config('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) }) },
  });
}
function safeError(error: unknown, cookie?: string): Response {
  if (error instanceof CustomerAssistantError) return response({ error: error.code }, error.status, cookie, error.status === 429 ? error.retryAfter : undefined);
  if (error instanceof VerifiedCustomerError) return response({ error: error.code }, error.status, cookie, error.retryAfterSeconds);
  if (error instanceof z.ZodError) return response({ error: 'INVALID_REQUEST' }, 400, cookie);
  if (error instanceof AvailabilityValidationError) return response({ error: 'SCHEDULE_INVALID' }, 400, cookie);
  if (error instanceof Error && ['REQUEST_CANCELLED', 'KNOWLEDGE_CHANGED'].includes(error.message)) return response({ error: error.message }, 409, cookie);
  return response({ error: 'ASSISTANT_UNAVAILABLE' }, 503, cookie);
}
function baseAnswer(input: PublicCustomerQuery): PublicCustomerResponse {
  return { version: 'ms77-v1', kind: 'ANSWER', summary: '', citations: [], suggestions: [], actions: [],
    as_of: new Date().toISOString(), knowledge_epoch: 0, request_id: input.request_id, limitations: [] };
}
function privateQuestion(input: PublicCustomerQuery) {
  return Boolean(input.selected_reservation_id || requestsPrivateRecord(input.message));
}
function verifyRequired(answer: PublicCustomerResponse): PublicCustomerResponse {
  return { ...answer, kind: 'VERIFY_REQUIRED', summary: 'Verify Customer ID and email to ask about your own reservations. You can continue public help and guest booking without verification.', actions: [{ id: 'VERIFY_CUSTOMER' }] };
}

export async function customerAssistantSession(request: Request): Promise<Response> {
  try { enabled(); const body = await customerRequestBody(request); z.object({}).strict().parse(body);
    const auth = await authority(request, false); return response({ ready: true }, 200, auth.cookie);
  } catch (error) { return safeError(error); }
}

export async function customerAssistantQuery(request: Request): Promise<Response> {
  // PRD-F26/F27 / QAD-TC46: request-local numeric diagnostics, never prompt data.
  const started = performance.now();
  const modelTimings: Record<string, number> = {};
  let outgoing: Response | undefined;
  let cookie: string | undefined;
  let release: (() => Promise<unknown>) | undefined;
  try {
    enabled();
    const input = publicCustomerQuerySchema.parse(await customerRequestBody(request));
    const identity = customerControlIdentitySchema.parse({ request_id: input.request_id, session_id: input.session_id, generation: input.generation });
    const auth = await authority(request, true, true); cookie = auth.cookie;
    const timeout = AbortSignal.timeout(Math.min(55000, Math.max(1000, Number(process.env.RAG_REQUEST_DEADLINE_MS) || 55000)));
    const signal = AbortSignal.any([request.signal, timeout]);
    const db = database(signal), scope = config('RAG_SCOPE_ID');
    const digest = subjectDigest(config('RAG_CAPABILITY_SECRET'), auth.principal, auth.sub);
    if (auth.principal === 'PUBLIC_VISITOR') {
      const quota = await db.rpc('admit_public_assistant', { p_ip: keyedDigest('public-ip', `${scope}:${trustedClientIp(request)}`), p_visitor: digest, p_request: input.request_id });
      if (quota.error || !quota.data || typeof quota.data.allowed !== 'boolean') throw new CustomerAssistantError('ADMISSION_UNAVAILABLE');
      if (!quota.data.allowed) throw new CustomerAssistantError('RATE_LIMITED', 429, Number(quota.data.retry_after) || 600);
    }
    const control = new CustomerRequestControl(db, { scope, principal: auth.principal, subject_digest: digest });
    const claimed = await db.rpc('customer_assistant_control', { p_operation: 'claim', p_scope: scope, p_principal: auth.principal,
      p_subject: digest, p_request: input.request_id, p_session: input.session_id, p_generation: input.generation });
    if (claimed.error) {
      if (/RATE_LIMITED/.test(claimed.error.message)) throw new CustomerAssistantError('RATE_LIMITED', 429, 5);
      if (/REQUEST_REPLAY/.test(claimed.error.message)) throw new CustomerAssistantError('REQUEST_REPLAY', 409);
      throw new CustomerAssistantError('ADMISSION_UNAVAILABLE');
    }
    // Release uses a fresh short DB deadline even when request work was cancelled.
    release = () => new CustomerRequestControl(database(AbortSignal.timeout(5000)), { scope, principal: auth.principal, subject_digest: digest }).command('release', identity);
    const data = await control.run(identity, async controlSignal => {
      const workSignal = AbortSignal.any([signal, controlSignal]);
      const authorize = async () => { if (workSignal.aborted) throw new Error('REQUEST_CANCELLED'); await auth.authorize(); await control.assertActive(identity); };
      await authorize();
      let answer = baseAnswer(input);
      if (privateQuestion(input) && !auth.verified) return verifyRequired(answer);
      const now = Math.floor(Date.now() / 1000);
      const claims: CustomerCapability = { iss: 'deskatlas', aud: 'rag', surface: 'customer', principal: auth.principal, sub: auth.sub,
        scope, request_id: input.request_id, session_id: input.session_id, generation: input.generation,
        ops: ['customer_knowledge', 'public_workspace', 'public_availability', 'public_price', ...(auth.verified ? ['owned_bookings' as const, 'owned_booking_context' as const] : [])],
        audiences: ['CUSTOMER'], iat: now, exp: now + 60 };
      const capability = signCustomerCapability(claims, config('RAG_CAPABILITY_SECRET'));
      const cloudIdentity = createCloudRunIdentity(request, workSignal);
      const model = async (path: string, body: unknown, operationSignal?: AbortSignal): Promise<unknown> => {
        const modelStarted = performance.now();
        try {
          await authorize();
          const base = new URL(config('RAG_SERVICE_URL'));
          if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
          const identity = await cloudIdentity();
          const result = await fetch(new URL(`/v1/customer/${path}`, base), { method: 'POST', cache: 'no-store', redirect: 'error', signal: operationSignal ? AbortSignal.any([workSignal, operationSignal]) : workSignal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config('RAG_SERVICE_TOKEN')}`, 'X-Request-Capability': capability,
              ...(identity ? { 'X-Serverless-Authorization': `Bearer ${identity}` } : {}) }, body: JSON.stringify(body) });
          if (process.env.RAG_DIAGNOSTICS_ENABLED === 'true') {
            // Numeric, allowlisted upstream spans identify queue/provider work
            // without retaining questions, source prose or provider bodies.
            for (const match of (result.headers.get('Server-Timing') ?? '').matchAll(/\b(queue|verify|inference|schema|deterministic|residual);dur=(\d+(?:\.\d+)?)/g)) {
              const elapsed = Number(match[2]);
              if (Number.isFinite(elapsed) && elapsed <= 60000) {
                const stage = `upstream_${path.replaceAll('-', '_')}_${match[1]}`;
                modelTimings[stage] = (modelTimings[stage] ?? 0) + elapsed;
              }
            }
          }
          if (!result.ok) {
            const failureStage = result.headers.get('X-RAG-Failure-Stage');
            if (failureStage && ['original-unit', 'visible-answer', 'selected-proof', 'verification-relevance', 'verification-support', 'verification-completeness', 'verification-conflict', 'verification-safety'].includes(failureStage)) modelTimings[`failure_${failureStage.replaceAll('-', '_')}`] = 0;
            if (result.status === 429) {
              const rawRetry = result.headers.get('Retry-After') ?? '';
              const retry = /^\d{1,4}$/.test(rawRetry) ? Number(rawRetry) : 5;
              throw new CustomerAssistantError('CAPACITY_BUSY', 429, retry >= 1 && retry <= 3600 ? retry : 5);
            }
            if (path === 'document-support' && result.status === 400) {
              const failure = z.object({ detail: z.enum(['UNRESOLVED_CONTEXT', 'CONFLICTING_SOURCES', 'CONTEXT_BUDGET_EXCEEDED', 'OUTPUT_BUDGET_EXCEEDED']) }).passthrough().safeParse(await result.json().catch(() => null));
              if (failure.success) throw new CustomerAssistantError(failure.data.detail, 400);
            }
            if (result.status === 503 || result.status === 504) {
              const failure = z.object({ detail: z.enum(['INVALID_MODEL_OUTPUT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'REQUEST_TIMEOUT']) }).passthrough().safeParse(await result.json().catch(() => null));
              if (failure.success) throw new CustomerAssistantError(failure.data.detail, result.status);
            }
            throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
          }
          const output: unknown = await result.json(); await authorize(); return output;
        } finally {
          const stage = `model_${path.replaceAll('-', '_')}`;
          modelTimings[stage] = (modelTimings[stage] ?? 0) + performance.now() - modelStarted;
        }
      };
      const reader = new CustomerKnowledgeReader(db, claims, config('RAG_EMBEDDING_FINGERPRINT'), authorize);
      const state = z.object({ enabled: z.boolean(), knowledge_epoch: z.number().int().nonnegative() }).strict().parse(await reader.read('availability'));
      answer.knowledge_epoch = state.knowledge_epoch;
      const privateAnswer = async () => {
        if (!auth.verified) return verifyRequired(answer);
        return reader.release(state.knowledge_epoch, async () => {
          const needsPolicy = /\b(?:explain|why|how|polic\w*|rules?|cutoffs?|can\s+(?:i|we)|cancel\w*|reschedul\w*|refund\w*|relocat\w*|check.?in|qr|paano|bakit|pwede|puwede)\b/i.test(input.message);
          const policySignal = AbortSignal.timeout(20000);
          const result = await buildVerifiedResponse(auth.verified!, input, answer, workSignal, state.enabled && needsPolicy ? facts => buildVerifiedPolicyAddendum({
            reader, model: (path, body) => model(path, body, policySignal), message: input.message, epoch: state.knowledge_epoch!, minimumSimilarity: Number(config('RAG_MIN_SIMILARITY')), authorize,
          }, facts) : undefined);
          await authorize(); return result;
        });
      };
      if (privateQuestion(input)) return privateAnswer();
      let catalogSeeds: z.infer<typeof assistantSourceSchema>[] | undefined;
      let rawPlan: unknown;
      // PRD-F26 / MS77-TC05/08: saved context informs intent, never evidence.
      const task = customerConversationTask(input.message, input.user_turns);
      const planInput = { conversation_contract: 'constraints-v1', message: task.message, user_turns: task.user_turns, has_spot_context: Boolean(input.discovery?.workspace_id || input.discovery?.compared_ids?.length),
        ...(input.offered_names?.length ? { offered_names: input.offered_names } : {}),
        ...(input.discovery ? { discovery: input.discovery } : {}) };
      if (state.enabled && process.env.CUSTOMER_ASSISTANT_CATALOG_DISCOVERY === 'true') {
        const catalogStarted = performance.now();
        const catalog = await readCustomerDiscoveryCatalog(db, reader, scope, state.knowledge_epoch, authorize);
        modelTimings.catalog_read = performance.now() - catalogStarted;
        const discovered = z.object({ plan: z.unknown(), chunk_ids: z.array(z.string().uuid()).max(12) }).strict()
          .parse(await model('catalog-plan', { ...planInput, ...catalog }));
        if (new Set(discovered.chunk_ids).size !== discovered.chunk_ids.length
          || discovered.chunk_ids.some(id => !catalog.sources.some(source => source.chunk_id === id))) throw new CustomerAssistantError('INVALID_EVIDENCE');
        rawPlan = discovered.plan;
        catalogSeeds = catalog.sources.filter(source => discovered.chunk_ids.includes(source.chunk_id));
      } else {
        rawPlan = await model('plan', planInput);
      }
      // Public booking intent yields verification before executing a forbidden tool.
      if (z.object({ kind: z.literal('BOOKING') }).passthrough().safeParse(rawPlan).success) {
        return privateAnswer();
      }
      let plan = admitCustomerPlan(rawPlan, claims);
      const searchQuery = plan.search_query ?? input.message;
      const knowledgeQuestion = plan.search_query && task.question.length + searchQuery.length < 2900
        ? `${task.question}\nSearch interpretation (not evidence): ${searchQuery}` : task.question;
      if (plan.kind === 'REFUSE') return { ...answer, kind: 'UNSUPPORTED' as const, summary: 'I can explain published customer information and help you compare spots. Use the normal booking screens to make changes.' };
      const spotRepository = publicSpotRepository(db, workSignal);
      const workspaceGuidance = (plan.kind === 'WORKSPACE' && plan.workspace_mode === 'GUIDANCE') || (plan.kind === 'KNOWLEDGE'
        && /\b(?:recommend\w*|suitab\w*|capacity|capacities|how many people|quiet (?:study|work)|video calls?|online interview)\b/i.test(task.question));
      let context = mergeConversationConstraints(input.discovery, plan.constraints);
      let floorChoices: string[] = [];
      let offeredNames: string[] = [];
      if (plan.kind === 'WORKSPACE' && plan.workspace_mode === 'GUIDANCE' && !context.workspace_id && !context.compared_ids?.length) {
        plan = { ...plan, kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }] };
        answer.discovery = context;
        answer.limitations.push('This is general workspace guidance. Live availability and prices require a complete schedule.');
      }
      if (plan.workspace_mode === 'CATALOG') {
        const overview = await publicWorkspaceOverview();
        await authorize();
        if (overview !== await publicWorkspaceOverview()) throw new Error('KNOWLEDGE_CHANGED');
        return reader.release(state.knowledge_epoch, async () => ({ ...answer, summary: overview }));
      }
      if (plan.kind === 'WORKSPACE' && (plan.constraints?.template_name || plan.constraints?.floor_name || context.template_id || context.floor_id)) {
        const resolved = await resolvePublicWorkspaceContext(context, plan.constraints?.template_name, plan.constraints?.floor_name, plan.comparison_names, input.message);
        context = resolved.context;
        floorChoices = resolved.floor_choices ?? [];
        offeredNames = resolved.offered_names ?? [];
        answer.discovery = context;
        if (resolved.clarification) return { ...answer, kind: 'CLARIFY' as const, summary: resolved.clarification };
      } else
      if (plan.kind === 'WORKSPACE' && plan.comparison_names?.length) {
        const ids = await resolvePublicComparison(plan.comparison_names);
        if (ids?.length) context.compared_ids = ids;
        else {
          const resolved = await resolvePublicWorkspaceContext(context, undefined, undefined, plan.comparison_names, input.message);
          context = resolved.context;
          floorChoices = resolved.floor_choices ?? [];
          offeredNames = resolved.offered_names ?? [];
          answer.discovery = context;
          if (resolved.clarification) return { ...answer, kind: 'CLARIFY' as const, summary: resolved.clarification };
        }
      }
      let candidateSnapshot: Awaited<ReturnType<typeof spotRepository.candidates>> | undefined;
      const missingSchedule = !context.date || !context.start_time || !context.duration_minutes;
      // Candidate narrowing and schedule clarification cost no embedding/composition.
      if (plan.kind === 'WORKSPACE') {
        answer.discovery = context;
        const missing = missingScheduleQuestion(context);
        if (plan.constraints && missing && (context.date || context.start_time || context.duration_minutes)) {
          return { ...answer, kind: 'CLARIFY' as const, summary: missing };
        }
        candidateSnapshot = await spotRepository.candidates(context);
        if (candidateSnapshot.has_more) {
          answer.offered_names = offeredNames;
          const examples = offeredNames.length ? ` Examples from the published map (availability not checked): ${offeredNames.join(', ')}. Tell me which of these to compare, or name other map spots.` : ' You can also compare up to three map spots.';
          if (Object.values(context.preferences).some(value => value !== undefined) || context.date || context.start_time || context.duration_minutes) {
            const narrow = context.template_id && !context.floor_id ? `Which floor should I check for that workspace type?${floorChoices.length ? ` Published choices: ${floorChoices.join(', ')}.` : ''}` : context.floor_id && !context.template_id ? 'Which workspace type should I check on that floor?' : context.template_id && context.floor_id ? 'Please choose up to three exact spots on this floor to compare.' : 'Which workspace type or floor should I check?';
            return { ...answer, kind: 'CLARIFY' as const, summary: `I will use your saved schedule and preferences${context.preferences.group_size ? ` for your group of ${context.preferences.group_size}` : ''}. There are more than twelve matching spots. ${narrow}${examples}` };
          }
          if (plan.workspace_mode === 'LIVE' || /\b(?:available|availability|vacant|bookable|compare)\b/i.test(input.message)) return { ...answer, kind: 'CLARIFY' as const, summary: 'There are more than twelve matching spots. Which workspace type or floor would you like me to check? You can also compare up to three map spots.' };
          plan = { ...plan, kind: 'KNOWLEDGE', operations: [{ name: 'customer_knowledge' }] };
          answer.limitations.push('This is general workspace-type guidance. Compare up to three map spots to check current availability with your saved schedule and preferences.');
        }
      }
      await control.command('stage', identity, 'retrieving');
      // Start the independent catalog read alongside document expansion, not
      // another inference pass. Revalidate its exact values before release.
      const workspaceCatalog = workspaceGuidance ? publicWorkspaceTypes() : undefined;
      // Attach a rejection handler immediately while other authorized reads run.
      if (workspaceCatalog) void workspaceCatalog.catch(() => {});
      let currentTypes: Awaited<ReturnType<typeof publicWorkspaceTypes>> | undefined;
      let sources: z.infer<typeof assistantSourceSchema>[] = [];
      if (state.enabled && (plan.kind !== 'WORKSPACE' || context.preferences.calls !== undefined)) {
        const minimum = Number(config('RAG_MIN_SIMILARITY'));
        if (!Number.isFinite(minimum) || minimum < -1 || minimum > 1) throw new CustomerAssistantError('ASSISTANT_UNAVAILABLE');
        let seeds: z.infer<typeof assistantSourceSchema>[];
        if (catalogSeeds !== undefined) seeds = catalogSeeds;
        else {
          const embedding = assistantSearchSchema.parse(await model('embed', { query: searchQuery }));
          seeds = z.array(assistantSourceSchema).max(12).parse(await reader.read('search', { p_vector: embedding.vector, p_min_similarity: minimum }));
        }
        if (catalogSeeds === undefined && plan.kind === 'KNOWLEDGE' && seeds.length) {
          const selected = z.object({ chunk_ids: z.array(z.string().uuid()).max(12) }).strict().parse(await model('knowledge-selection', { message: knowledgeQuestion, sources: seeds }));
          if (new Set(selected.chunk_ids).size !== selected.chunk_ids.length || selected.chunk_ids.some(id => !seeds.some(source => source.chunk_id === id))) throw new CustomerAssistantError('INVALID_EVIDENCE');
          seeds = seeds.filter(source => selected.chunk_ids.includes(source.chunk_id));
        }
        if (seeds.length) {
          const expanded = assistantDocumentEvidenceSchema.parse(await reader.read('document', { p_chunks: seeds.map(s => s.chunk_id) }));
          if (expanded.epoch !== state.knowledge_epoch || expanded.sources.some(s => s.epoch !== state.knowledge_epoch || createHash('sha256').update(s.content).digest('hex') !== s.content_hash)) throw new Error('KNOWLEDGE_CHANGED');
          sources = expanded.sources;
        }
      }
      await control.command('stage', identity, 'preparing');
      if (plan.kind === 'WORKSPACE') {
        const candidates = candidateSnapshot!;
        const raw = sources.length ? await model('characteristics', { sources, ids: candidates.spots.slice(0, 12).map(s => s.workspace_id) }) : { characteristics: [] };
        const characteristics: ApprovedCharacteristic[] = z.object({ characteristics: z.array(z.object({ workspace_id: z.string().uuid(),
          dimension: z.enum(['focus', 'calls', 'power']), value: z.boolean(), chunk_id: z.string().uuid(), quote: z.string().max(1000) }).strict()).max(500) }).strict().parse(raw).characteristics.map(f => ({
            workspace_id: f.workspace_id!, dimension: f.dimension!, value: f.value!, chunk_id: f.chunk_id!, quote: f.quote!,
          }));
        if (characteristics.some(f => !sources.some(s => s.chunk_id === f.chunk_id && s.content.includes(f.quote) && f.quote.includes(f.workspace_id)))) throw new CustomerAssistantError('INVALID_EVIDENCE');
        for (const chunk of new Set(characteristics.map(f => f.chunk_id))) {
          const original = sources.find(s => s.chunk_id === chunk)!;
          const fresh = assistantSourceSchema.parse(await reader.read('source', { p_version: original.version_id, p_chunk: chunk }));
          if (fresh.epoch !== state.knowledge_epoch || fresh.content_hash !== original.content_hash) throw new Error('KNOWLEDGE_CHANGED');
        }
        const decision = await decidePublicSpots(spotRepository, context, characteristics, undefined, candidates);
        answer.suggestions = decision.suggestions;
        answer.kind = missingSchedule || decision.narrow || !decision.suggestions.length ? 'CLARIFY' : 'ANSWER';
        const ranked = decision.suggestions;
        const winner = ranked[0];
        const recommendation = winner && winner.score > 0 && (!ranked[1] || winner.score > ranked[1].score)
          ? `${winner.name} matches more of your saved preferences.` : 'These options are tied on the verified preferences; I cannot name a better match from the available evidence.';
        answer.summary = decision.narrow ? 'Please narrow the workspace type or floor.' : !decision.suggestions.length
          ? `No spots could be confirmed${context.preferences.group_size ? ` for your group of ${context.preferences.group_size}` : ''} with these constraints. Try another schedule or narrow your preferences.`
          : missingSchedule ? `These spots match your saved constraints${context.preferences.group_size ? ` for your group of ${context.preferences.group_size}` : ''}. Availability and prices have not been checked. Which business date, start time and duration should I check? Save them below.`
          : `${recommendation} I used your saved date, start time, duration${context.preferences.group_size ? `, group size (${context.preferences.group_size})` : ''}${context.preferences.budget !== undefined ? ` and total budget (PHP ${context.preferences.budget})` : ''}. Matches are shown below.`;
        answer.limitations = ['Suggestions are provisional and create no inventory hold. Quotes are base totals for the requested duration; checkout determines any applicable promotion.'];
        if (context.compared_ids?.some(id => !ranked.some(spot => spot.workspace_id === id))) answer.limitations.push('Some selected spots do not pass the current availability, capacity, budget or published-catalog checks and are not suggested.');
        if (ranked.some(spot => spot.catalog_reasons?.length)) answer.limitations.push('Published map tags describe expected conditions, which may vary. They do not guarantee quietness or a working outlet.');
        if (decision.changed) answer.limitations.push('Some spots changed during checking and were omitted. Please retry for current options.');
        if (answer.suggestions.some(s => !s.quote)) answer.limitations.push('An authoritative price quote is unavailable for some spots.');
        if (Object.keys(context.preferences ?? {}).some(k => ['focus', 'calls', 'power'].includes(k)) && !answer.suggestions.some(s => s.reasons.length || s.catalog_reasons?.length)) answer.limitations.push('Approved characteristic evidence is missing or contradictory; no preference match is claimed.');
        answer.actions = answer.suggestions.map(s => ({ id: 'VIEW_SPOT', workspace_id: s.workspace_id, floor_id: s.floor_id, map_version_id: s.map_version_id }));
        const used = new Set(answer.suggestions.flatMap(s => s.reasons.map(r => r.chunk_id)));
        answer.citations = sources.filter(s => used.has(s.chunk_id)).map(({ content: _content, ...citation }) => citation);
      } else if (sources.length) {
        currentTypes = await workspaceCatalog;
        const payload = { contract: 'ms65-v1', presentation_contract: 'customer-concise-v1', synthesis: true, query: knowledgeQuestion, sources,
          ...(currentTypes?.length ? { workspace_catalog: currentTypes } : {}) };
        if (Buffer.byteLength(JSON.stringify(payload)) > 260000) throw new CustomerAssistantError('NARROW_QUESTION', 400);
        let rawProof: unknown;
        try { rawProof = await model('document-support', payload); }
        catch (error) {
          if (!(error instanceof CustomerAssistantError) || !Object.hasOwn(knowledgeGaps, error.code)) throw error;
          return reader.release(state.knowledge_epoch, async () => {
            await authorize();
            return { ...answer, kind: 'CLARIFY' as const, summary: knowledgeGaps[error.code] };
          });
        }
        const proof = validateDocumentSupport(rawProof, createHash('sha256').update(JSON.stringify(payload)).digest('hex'), sources, 'ms65-v1', { customerPaymentMethod: true });
        if (!proof) throw new CustomerAssistantError('INVALID_EVIDENCE');
        if (proof.outcome === 'COMPLETE') {
          answer.summary = (proof.synthesis?.main_blocks ?? proof.synthesis?.blocks ?? []).map(b => b.text).join('\n\n');
          if (currentTypes?.length) {
            const mentioned = currentTypes.filter(type => answer.summary.toLowerCase().includes(type.name.toLowerCase()));
            if (mentioned.length) answer.summary += `\n\nCurrent published capacities: ${mentioned.map(type => `${type.name}: ${type.capacity} ${type.capacity === 1 ? 'person' : 'people'}`).join('; ')}.`;
          }
          answer.citations = sources.filter(s => proof.spans.some(span => span.chunk_id === s.chunk_id)).map(({ content: _content, ...citation }) => citation);
          if (currentTypes?.length) answer.limitations.push('Workspace capacities and base rates use the current published map. Availability and final prices require a schedule.');
        } else { answer.kind = 'CLARIFY'; answer.summary = proof.clarification || 'Approved knowledge does not support a consistent complete answer. Please narrow your question or ask the front desk.'; }
      } else { answer.kind = 'CLARIFY'; answer.summary = 'I do not have approved customer knowledge for that question. Please ask the front desk or try a narrower question.'; }
      return reader.release(state.knowledge_epoch, async () => {
        // SDD-C21/C24 / QAD-TC44/46: one principal-bound snapshot revalidates
        // ALL inspected originals, including uncited conditions. It replaces
        // per-citation network reads without dropping final authority checks.
        if (plan.kind === 'KNOWLEDGE' && sources.length) {
          const finalStarted = performance.now();
          const roots = [...new Map(sources.map(source => [source.version_id, source.chunk_id])).values()];
          const [rawSnapshot, freshTypes] = await Promise.all([
            reader.read('document', { p_chunks: roots }), currentTypes ? publicWorkspaceTypes() : undefined,
          ]);
          const snapshot = assistantDocumentEvidenceSchema.parse(rawSnapshot);
          if (currentTypes && JSON.stringify(currentTypes) !== JSON.stringify(freshTypes)) throw new Error('KNOWLEDGE_CHANGED');
          if (snapshot.epoch !== answer.knowledge_epoch || snapshot.sources.length !== sources.length
            || new Set(snapshot.sources.map(source => source.chunk_id)).size !== sources.length
            || sources.some(source => !snapshot.sources.some(fresh =>
              fresh.chunk_id === source.chunk_id && fresh.version_id === source.version_id
              && fresh.document_id === source.document_id && fresh.epoch === answer.knowledge_epoch
              && fresh.content === source.content && fresh.content_hash === source.content_hash
              && fresh.title === source.title && fresh.heading_path === source.heading_path
              && fresh.source_page === source.source_page && fresh.extraction_method === source.extraction_method
              && createHash('sha256').update(fresh.content).digest('hex') === fresh.content_hash))) throw new Error('KNOWLEDGE_CHANGED');
          modelTimings.final_document_read = performance.now() - finalStarted;
        }
        await authorize(); return publicCustomerResponseSchema.parse(answer);
      });
    });
    const publicData = publicCustomerResponseSchema.parse(data);
    // Older browser builds strictly parse ms77-v1 and cannot accept new fields.
    if (!input.conversation_contract) { delete publicData.discovery; delete publicData.offered_names; }
    return outgoing = response(publicData, 200, cookie);
  } catch (error) { return outgoing = safeError(error, cookie); }
  finally {
    if (release) { try { await release(); } catch { /* Expiring leases recover abandoned work. */ } }
    if (outgoing && process.env.RAG_DIAGNOSTICS_ENABLED === 'true') {
      outgoing.headers.set('Server-Timing', Object.entries({ ...modelTimings, total: performance.now() - started })
        .map(([stage, elapsed]) => `${stage};dur=${elapsed.toFixed(3)}`).join(', '));
    }
  }
}

export async function customerAssistantControl(request: Request, operation: 'progress' | 'cancel'): Promise<Response> {
  try {
    enabled(); const identity = customerControlIdentitySchema.parse(await customerRequestBody(request));
    const auth = await authority(request, false, true);
    const db = database(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    const control = new CustomerRequestControl(db, { scope: config('RAG_SCOPE_ID'), principal: auth.principal,
      subject_digest: subjectDigest(config('RAG_CAPABILITY_SECRET'), auth.principal, auth.sub) });
    const state = await control.command(operation, identity);
    await auth.authorize();
    return response(state ? { stage: state.stage, cancelled: state.cancelled } : { error: 'REQUEST_UNAVAILABLE' }, state ? 200 : 404);
  } catch (error) { return safeError(error); }
}
export async function customerAssistantSource(request: Request): Promise<Response> {
  try {
    enabled(); const input = customerSourceRequestSchema.parse(await customerRequestBody(request));
    const auth = await authority(request, false, true);
    const now = Math.floor(Date.now() / 1000);
    const claims: CustomerCapability = { iss: 'deskatlas', aud: 'rag', surface: 'customer', principal: auth.principal, sub: auth.sub,
      scope: config('RAG_SCOPE_ID'), request_id: input.chunk_id, session_id: input.version_id, generation: input.chunk_id,
      ops: ['customer_knowledge'], audiences: ['CUSTOMER'], iat: now, exp: now + 60 };
    const reader = new CustomerKnowledgeReader(database(AbortSignal.any([request.signal, AbortSignal.timeout(10000)])), claims, config('RAG_EMBEDDING_FINGERPRINT'), auth.authorize);
    const source = assistantSourceSchema.parse(await reader.read('source', { p_version: input.version_id, p_chunk: input.chunk_id }));
    return reader.release(source.epoch, async () => response({ excerpt: source.content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''), title: source.title, knowledge_epoch: source.epoch }));
  } catch (error) { return safeError(error); }
}

export async function customerAssistantSpot(request: Request): Promise<Response> {
  try {
    enabled(); const action = customerActionSchema.parse(await customerRequestBody(request));
    if (action.id !== 'VIEW_SPOT') throw new CustomerAssistantError('INVALID_REQUEST', 400);
    const db = database(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    const current = await publicSpotRepository(db, request.signal).candidates({ workspace_id: action.workspace_id, floor_id: action.floor_id });
    if (!current.spots.some(s => s.workspace_id === action.workspace_id && s.map_version_id === action.map_version_id)) throw new CustomerAssistantError('SPOT_CHANGED', 409);
    const map = await createPublishedMapService(new SupabasePublishedMapRepository({ cache: currentPublishedMaps }))
      .loadPublishedFloorMap(action.floor_id, { audience: 'CUSTOMER' });
    if (map.version.id !== action.map_version_id || !map.elements.some(e => e.workspace?.workspaceInstanceId === action.workspace_id)) throw new CustomerAssistantError('SPOT_CHANGED', 409);
    return response({ published: map });
  } catch (error) { return safeError(error); }
}
