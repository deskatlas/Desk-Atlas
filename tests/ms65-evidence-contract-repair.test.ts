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

const db = vi.hoisted(() => ({ rpc: vi.fn(), epoch: 1 }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => ({ abortSignal: () => db.rpc(...args) }),
    from: (table: string) => ({
      select: () => ({
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

  beforeEach(() => {
    db.epoch = 1;
    selections = 0;
    expansions = 0;
    alwaysOverflow = false;
    emptyReconsideration = false;
    withdrawOnSupport = false;
    withdrawn = false;

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
      error: null,
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
                ? (++expansions && (expansions === 1 || alwaysOverflow)
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
    expect(selections).toBe(0);
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
