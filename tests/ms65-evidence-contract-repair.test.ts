import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { validateDocumentSupport } from '../packages/domain/src/services/assistantDocumentSupport';
import { CampaignRuleInputSchema } from '../packages/validation/src/campaignSchema';

// PRD-F26/F27 / SDD-C20-C24 / QAD-TC44-TC46 / MS-65.
// MS65: General Document RAG Reliability and Evidence Contract Repair.
// Verifies source-grounded dependency closure, preserved causal failure outcomes,
// broad intent clarification, migration reversibility, and SPEC2 campaign validation.

const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1, supportContract: 'ms65-v1' as string | null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
    from: (table: string) => ({
      select: () => ({
        in: (_column: string, ids: string[]) => ({ abortSignal: async () => ({ data: ids.map(id => ({ id, support_contract: db.supportContract })), error: null }) }),
        eq: () => {
          const result = () => ({
            data: table === 'staff_profiles'
              ? { role: 'ADMIN', is_active: true }
              : table === 'business_settings'
                ? { timezone: 'Asia/Manila' }
                : { epoch: db.epoch, active_embedding_fingerprint: 'synthetic' },
            error: null,
          });
          return {
            maybeSingle: async () => result(),
            abortSignal: () => ({ single: async () => result(), maybeSingle: async () => result() }),
          };
        },
      }),
    }),
  }),
}));

const makeSource = (content: string, id?: string) => {
  const chunkId = id || randomUUID();
  return {
    document_id: randomUUID(),
    version_id: randomUUID(),
    chunk_id: chunkId,
    title: 'Staff Operation Guide',
    heading_path: 'Guide > Overview',
    source_page: null,
    epoch: 1,
    extraction_method: 'TEXT',
    content_hash: createHash('sha256').update(content).digest('hex'),
    content,
  };
};

describe('MS-65: General Document RAG Reliability and Evidence Contract Repair', () => {
  let sources: ReturnType<typeof makeSource>[] = [];
  let candidates: ReturnType<typeof makeSource>[] = [];
  let selections = 0;
  let expansions = 0;
  let alwaysOverflow = false;
  let emptyReconsideration = false;
  let withdrawOnSupport = false;
  let withdrawn = false;
  let reprocessRequired = false;
  let documentOverflow = false;

  beforeEach(() => {
    db.epoch = 1;
    selections = 0;
    expansions = 0;
    alwaysOverflow = false;
    emptyReconsideration = false;
    withdrawOnSupport = false;
    withdrawn = false;
    reprocessRequired = false;
    documentOverflow = false;
    db.supportContract = 'ms65-v1';

    sources = [makeSource('Staff must monitor the lobby occupancy and assist walk-in customers.')];
    candidates = [...sources, makeSource('Keep counter clean.'), makeSource('Check equipment.')];

    for (const [key, value] of Object.entries({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
      RAG_ENABLED: 'true',
      KB_ENABLED: 'true',
      RAG_SERVICE_URL: 'http://127.0.0.1:8000',
      RAG_SERVICE_TOKEN: randomUUID(),
      RAG_CAPABILITY_SECRET: randomUUID(),
      RAG_SCOPE_ID: 'synthetic',
      RAG_EMBEDDING_FINGERPRINT: 'synthetic',
      RAG_MIN_SIMILARITY: '0.5',
      RAG_SYNTHESIS_ENABLED: 'false',
      RAG_EVIDENCE_CONTRACT: 'ms59-v1',
    })) {
      vi.stubEnv(key, value);
    }

    db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({
      error: name === 'assistant_document_evidence' && withdrawn ? { message: 'KNOWLEDGE_CHANGED' }
        : name === 'assistant_document_evidence' && documentOverflow && (args.p_chunks as string[]).length > 1 ? { message: 'CONTEXT_BUDGET_EXCEEDED' } : null,
      data:
        name === 'assistant_document_evidence'
          ? {contract: 'ms65-v1', epoch: db.epoch, sources}
          : name === 'assistant_knowledge_availability'
          ? { enabled: true, knowledge_epoch: db.epoch }
          : name === 'assistant_search_knowledge'
            ? candidates
            : name === 'assistant_evidence_costs'
              ? {
                  version: 3,
                  epoch: 1,
                  roots: candidates.map(s => ({
                    chunk_id: s.chunk_id,
                    complete: true,
                    members: [s.chunk_id],
                    source_count: 1,
                    bytes: 200,
                  })),
                }
              : name.startsWith('assistant_expand_evidence')
                ? (reprocessRequired ? { complete: false, reason: 'REPROCESS_REQUIRED', sources: [] } : ++expansions && (expansions === 1 || alwaysOverflow)
                    ? { complete: false, reason: 'CONTEXT_BUDGET', sources: [] }
                    : {
                        complete: true,
                        sources,
                        groups: [{ id: 'unit', chunk_ids: [sources[0].chunk_id], requires: [] }],
                      })
                : name === 'assistant_read_source' && withdrawn ? null : sources.find(s => s.chunk_id === args.p_chunk),
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.endsWith('/v1/document-support')) {
          withdrawn = withdrawOnSupport;
          const spans = sources.map(source => ({chunk_id: source.chunk_id, quote: source.content, start: 0, end: source.content.length}));
          return Response.json({contract: 'ms65-v1', binding: createHash('sha256').update(String(init?.body)).digest('hex'), outcome: 'COMPLETE', clarification: null,
            spans, synthesis: {version: 'ms57-v1', scope: 'COMPLETE_PROCEDURE', outcome: 'COMPLETE', gaps: [], blocks: sources.map((source, i) => ({kind: 'step', text: source.content, support: [i]}))},
            counts: {bundles: 2, calls: 6, units: sources.length}});
        }
        if (u.endsWith('/v1/evidence-cost')) {
          return Response.json({
            version: 'ms60-v1',
            binding: createHash('sha256').update(String(init?.body)).digest('hex'),
            quote_count: 1,
            max_quote_utf16: 100,
            fits: true,
            reason: null,
          });
        }
        if (u.endsWith('/v1/plan')) {
          return Response.json({
            kind: 'DOCUMENT',
            query: 'What should I monitor during my shift?',
            tools: [],
          });
        }
        if (u.endsWith('/v1/embed')) {
          return Response.json({ vector: [1, ...Array(1023).fill(0)] });
        }
        if (u.endsWith('/v1/context')) {
          selections++;
          if (emptyReconsideration && selections > 1) return Response.json({chunk_ids: [], ambiguous: false,
            obligations: [{id: 'o0', request: 'Shift monitoring overview', kind: 'RECOMMENDATION', status: 'UNVERIFIED', chunk_ids: []}],
            coverage: {scope: 'RECOMMENDATION', outcome: 'INSUFFICIENT', gaps: ['Evidence selection exceeded capacity.']}});
          return Response.json({
            chunk_ids: [sources[0].chunk_id],
            ambiguous: false,
            obligations: [
              {
                id: 'o0',
                request: 'Shift monitoring overview',
                kind: 'RECOMMENDATION',
                status: 'SUPPORTED',
                chunk_ids: [sources[0].chunk_id],
              },
            ],
            coverage: { scope: 'RECOMMENDATION', outcome: 'COMPLETE', gaps: [] },
          });
        }
        return Response.json({
          quotes: sources.map(s => ({ chunk_id: s.chunk_id, quote: s.content })),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function paymentRequest(message = 'What should I check before approving a payment?') {
    return new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
      body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message }),
    });
  }

  it('clarifies subject-free troubleshooting without model or document reads', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_INTERNAL_CATALOG_DISCOVERY', 'true');
    const response = await assistantQuery(paymentRequest('What usually goes wrong, and how should I handle it?'));
    const answer = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(answer.kind).toBe('CLARIFY');
    expect(answer.summary).toContain('Which kind of problem');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_document_evidence')).toBe(false);
  });

  it('returns a schema-valid payment-channel clarification without model calls', async () => {
    const response = await assistantQuery(paymentRequest("Someone says they paid, but their booking isn't confirmed. What should I do?"));
    const answer = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(answer.kind).toBe('CLARIFY');
    expect(answer.summary).toBe('Did they pay online through the website, or at the kiosk counter?');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ragfix embeds original wording and deterministic search aids in one bounded batch', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_GUIDANCE_FAST_PATH', 'true');
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/v1/embed-queries')
      ? Response.json({ embeddings: (JSON.parse(String(init?.body)).queries as string[]).map(() => ({ vector: [1, ...Array(1023).fill(0)] })) })
      : original(url, init));
    const response = await assistantQuery(paymentRequest("I'm new here. What should I focus on when running the place day to day?"));
    expect(response.status).toBe(200);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/v1/embed-queries'))).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/v1/embed'))).toBe(false);
  });

  it('prepared workflow serving uses original proof and final checks without query embedding', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_PREPARED_SUPPORT', 'true');
    vi.stubEnv('RAG_PREPARATION_FINGERPRINT', 'c'.repeat(64));
    vi.stubEnv('RAG_GUIDANCE_FAST_PATH', 'true');
    vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'true');
    const source = sources[0];
    const index = { document_id: source.document_id, version_id: source.version_id, title: source.title,
      artifact_sha256: 'a'.repeat(64), source_binding: 'b'.repeat(64),
      groups: [{ id: 0, label: 'Shift monitoring', applies_to: 'Staff monitoring the lobby', ranges: [[0, 0]], requires: [], scope: 'WORKFLOW' }] };
    const originalRpc = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'assistant_prepared_catalog'
      ? { error: null, data: { contract: 'ragfix-prepared-v2', epoch: 1, complete: true, documents: [index] } }
      : name === 'assistant_prepared_evidence'
        ? { error: null, data: { contract: 'ragfix-prepared-v2', epoch: 1, indexes: [{ ...index, selected_groups: [0] }], sources,
          units: [{ i: 0, chunk_id: source.chunk_id, heading: source.heading_path, text: source.content, start: 0, end: source.content.length }] } }
        : originalRpc(name, args));
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/v1/prepared-selection')
      ? Response.json({ contract: 'ragfix-prepared-v2', selections: [{ version_id: source.version_id, artifact_sha256: index.artifact_sha256, groups: [0] }], clarification: null })
      : String(url).endsWith('/v1/prepared-support') ? Response.json({ contract: 'ragfix-prepared-v2',
        binding: createHash('sha256').update(String(init?.body)).digest('hex'), outcome: 'COMPLETE', clarification: null,
        spans: [{ chunk_id: source.chunk_id, quote: source.content, start: 0, end: source.content.length }],
        synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [], blocks: [{ kind: 'text', text: source.content, support: [0] }] },
        counts: { bundles: 1, calls: 2, units: 1 } }) : originalFetch(url, init));
    const response = await assistantQuery(paymentRequest('What should I monitor during my shift?'));
    expect((await response.json()).data.outcome).toBe('SUPPORTED');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /\/v1\/embed/.test(String(url)))).toBe(false);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_prepared_evidence')).toHaveLength(2);
    expect(db.rpc.mock.calls.some(([name]) => name === 'assistant_document_evidence')).toBe(false);
  });

  it('payment audit: missing production reader configuration fails before planning', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', undefined);
    const response = await assistantQuery(paymentRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toContain('document reader');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('payment audit: legacy reader incompatibility does not prescribe replacing valid evidence', async () => {
    reprocessRequired = true;
    const response = await assistantQuery(paymentRequest());
    const payload = await response.json();
    expect(payload.data.limitations.join()).toContain('READER_INCOMPATIBLE');
    expect(payload.data.limitations.join()).not.toContain('upload a replacement');
    expect(payload.data.outcome).toBe('SERVICE_FAILURE');
  });

  it('payment audit: genuine legacy preparation failure retains source review recovery', async () => {
    reprocessRequired = true;
    db.supportContract = null;
    const response = await assistantQuery(paymentRequest());
    const payload = await response.json();
    expect(payload.data.limitations.join()).toContain('REPROCESS_REQUIRED');
    expect(payload.data.outcome).toBe('SOURCE_REVIEW');
  });

  it.each([
    "I'm new to handling payments. Where do I start?",
    "I need to review a customer's payment. What should I check?",
    'I think I rejected a payment by mistake. How can I fix it?',
    'What happens to the desk after I approve a payment?',
    'The receipt is hard to read. What should I do?',
    "Do I have to explain why I'm rejecting a payment?",
    'Paano ko malalaman kung okay na i-approve yung payment?',
  ])('payment audit: configured document reader admits broad task %s', async message => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    const response = await assistantQuery(paymentRequest(message));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.outcome).toBe('SUPPORTED');
    expect(payload.data.citations).toHaveLength(1);
    expect(selections).toBe(1);
    expect(expansions).toBe(0);
    const planCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/v1/plan'));
    expect(JSON.parse(String(planCall?.[1]?.body))).toMatchObject({ message, evidence_contract: 'ms65-v1' });
  });

  it('MS65-TC01/06: negotiated gateway returns verified guidance and proof spanning eight chunks', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'true');
    sources = Array.from({length: 8}, (_, i) => makeSource(`Perform action ${i + 1}.`));
    candidates = sources.slice(0, 3);
    const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: {Origin: 'http://localhost', 'Content-Type': 'application/json',
        'X-DeskAtlas-Answer-Contract': 'ms59-v1',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}`},
      body: JSON.stringify({session_id: randomUUID(), request_id: randomUUID(), message: 'How do I complete this procedure?'}),
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.answer_mode).toBe('SYNTHESIZED');
    expect(payload.data.evidence_spans).toHaveLength(8);
    expect(payload.data.citations).toHaveLength(8);
    expect(payload.data.summary).toContain('Perform action 8.');
    expect(selections).toBe(1);
  });

  it('payment audit: irrelevant retrieved documents cannot exhaust full-document admission', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    documentOverflow = true;
    const response = await assistantQuery(paymentRequest());
    const payload = await response.json();
    expect(payload.data.outcome).toBe('SUPPORTED');
    expect(db.rpc).toHaveBeenCalledWith('assistant_document_evidence', expect.objectContaining({ p_chunks: [sources[0].chunk_id] }));
  });

  it('an empty relevant-document selection reports an evidence gap rather than a service outage', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/v1/context')
      ? Response.json({chunk_ids: [], ambiguous: false}) : original(url, init));
    const response = await assistantQuery(paymentRequest());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.limitations.join(' ')).toContain('NO_RELEVANT_SOURCE');
    expect(payload.data.limitations.join(' ')).not.toContain('service is unavailable');
    expect(payload.data.citations).toEqual([]);
  });

  it('MS65-TC17: altered bindings and fabricated source spans cannot release prose', () => {
    const source = sources[0];
    const binding = 'a'.repeat(64);
    const value = {contract: 'ms65-v1', binding, outcome: 'COMPLETE', clarification: null,
      spans: [{chunk_id: source.chunk_id, quote: source.content, start: 0, end: source.content.length}],
      synthesis: {version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [], blocks: [{kind: 'text', text: source.content, support: [0]}]},
      counts: {bundles: 1, calls: 4, units: 1}};
    expect(validateDocumentSupport(value, binding, sources)).toBeDefined();
    expect(validateDocumentSupport(value, 'b'.repeat(64), sources)).toBeUndefined();
    expect(validateDocumentSupport({...value, spans: [{...value.spans[0], quote: 'Invented rule.', end: 14}]}, binding, sources)).toBeUndefined();
  });

  it('MS65-TC16/17: withdrawal after verification prevents releasing evidence', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'true');
    withdrawOnSupport = true;
    const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: {Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}`},
      body: JSON.stringify({session_id: randomUUID(), request_id: randomUUID(), message: 'Explain shift monitoring.'}),
    }));
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('KNOWLEDGE_CHANGED');
    expect(payload.data).toBeUndefined();
  });

  it('revalidates the complete document snapshot in one RPC before release', async () => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'true');
    const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: {Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}`},
      body: JSON.stringify({session_id: randomUUID(), request_id: randomUUID(), message: 'Explain shift monitoring.'}),
    }));
    expect(response.status).toBe(200);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_document_evidence')).toHaveLength(2);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'assistant_read_source')).toHaveLength(0);
  });

  it.each(['changed', 'missing', 'duplicate'] as const)('rejects a %s final document snapshot', async mutation => {
    vi.stubEnv('RAG_EVIDENCE_CONTRACT', 'ms65-v1');
    vi.stubEnv('RAG_SYNTHESIS_ENABLED', 'true');
    sources.push({...makeSource('Never approve without valid proof.'), version_id: sources[0].version_id});
    const original = db.rpc.getMockImplementation()!;
    let reads = 0;
    db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      const result = await original(name, args) as {error: unknown; data: unknown};
      if (name !== 'assistant_document_evidence' || ++reads !== 2) return result;
      const changed = mutation === 'missing' ? sources.slice(0, 1) : mutation === 'duplicate' ? [sources[0], sources[0]]
        : [sources[0], {...sources[1], content: 'Changed after verification.'}];
      return {...result, data: {contract: 'ms65-v1', epoch: db.epoch, sources: changed}};
    });
    const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: {Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}`},
      body: JSON.stringify({session_id: randomUUID(), request_id: randomUUID(), message: 'Explain shift monitoring.'}),
    }));
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe('KNOWLEDGE_CHANGED');
    expect(payload.data).toBeUndefined();
  });

  // MS65-TC07: Overflow followed by empty/reduced reconsideration preserves causal outcome
  it('MS65-TC07: gateway preserves causal outcome on exhausted selection rather than converting to NO_RELEVANT_SOURCE', async () => {
    alwaysOverflow = true;
    emptyReconsideration = true;
    const response = await assistantQuery(
      new Request('http://localhost/api/assistant/query', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          'X-DeskAtlas-Answer-Contract': 'ms59-v1',
          Authorization: `Bearer ${issueAdminSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!)}`,
        },
        body: JSON.stringify({
          session_id: randomUUID(),
          request_id: randomUUID(),
          message: 'What should I monitor during my shift?',
        }),
      }),
    );

    const payload = (await response.json()) as { data: { limitations: string[]; answer_mode: string } };
    expect(payload.data.limitations.join()).toContain('SELECTION_EXHAUSTED: CONTEXT_BUDGET');
    expect(payload.data.limitations.join()).not.toContain('NO_RELEVANT_SOURCE');
    expect(selections).toBe(2);
  });

  // MS65-TC16: Database migration 027 up and down files exist and have symmetric definitions
  it('MS65-TC16: reversible migration 027 files exist and define source-grounded dependency generation', () => {
    const upPath = 'supabase/migrations/027_rag_evidence_contract_repair.sql';
    const downPath = 'supabase/migrations/027_rag_evidence_contract_repair_down.sql';

    expect(existsSync(upPath)).toBe(true);
    expect(existsSync(downPath)).toBe(true);

    const upSql = readFileSync(upPath, 'utf8');
    const downSql = readFileSync(downPath, 'utf8');

    // Up migration must replace all-to-all dependencies with ancestors and references
    expect(upSql).toContain('ancestors');
    expect(upSql).toContain('references');
    expect(upSql).not.toContain('WHERE sid<>ctx->>\'section_id\'');

    // Down migration must restore migration 026 definition
    expect(downSql).toContain('CREATE OR REPLACE FUNCTION kb_worker_command');
  });

  // MS65-TC22: SPEC2-TC05 campaign schema reward validation rejects 100% discount and accepts < 100%
  it('MS65-TC22: CampaignRuleInputSchema rejects 100% discount and accepts valid percentage discount', () => {
    const validBase = {
      label: 'Discount Rule',
      reward_type: 'PERCENTAGE_DISCOUNT' as const,
      reward_value: 20,
      voucher_validity_days: 30,
      rule_definition: {
        schema_version: 1 as const,
        combine: 'ALL' as const,
        conditions: [{ metric: 'BOOKING_COUNT' as const, threshold: 5 }],
        recurring: false,
        qualification_start_at: new Date().toISOString(),
        earning_channels: ['WEB' as const],
        earning_workspace_type_ids: [],
        redemption_channels: ['WEB' as const],
        redemption_workspace_type_ids: [],
        minimum_booking_amount: 0,
      },
    };

    // Valid percentage (< 100) must succeed
    expect(CampaignRuleInputSchema.safeParse(validBase).success).toBe(true);
    expect(CampaignRuleInputSchema.safeParse({ ...validBase, reward_value: 99.99 }).success).toBe(true);

    // 100% or greater discount must fail per SPEC-2 Section 5.3 and SPEC2-TC05
    expect(CampaignRuleInputSchema.safeParse({ ...validBase, reward_value: 100 }).success).toBe(false);
    expect(CampaignRuleInputSchema.safeParse({ ...validBase, reward_value: 105 }).success).toBe(false);
  });
});
