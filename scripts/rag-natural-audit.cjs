// PRD-F26 / SDD-C20/C21 / QAD-TC44: read-only diagnostic reproduction.
// No transcripts, source text, credentials, or generated rewrites are printed.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { createHmac, randomUUID, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const cases = {
  // QAD-TC44 / October 17 browser audit: online-payment permission in mixed-topic chat.
  counter_screenshot_context: { message: 'They paid on the website and showed me the screenshot. Can I confirm that at the counter?', prior: ['Someone’s on a loud call and it’s bothering the other guests. What do I do?', 'I already asked nicely, but they’re still at it. What now?', 'May naiwan na bag sa upuan. Saan ko ilalagay?', 'A guest wants to pop out for a snack and come back. Do I check them out?'] },
  counter_screenshot_fresh: { message: 'They paid on the website and showed me the screenshot. Can I confirm that at the counter?', prior: [] },
  // QAD-TC44 / October 16 browser re-audit: ordinary unseen lost-property wording.
  wallet_tl: { message: 'May naiwan na wallet sa table. Ano gagawin ko?', prior: [] },
  wallet_en: { message: 'Someone left their wallet on a desk. What should I do with it?', prior: [] },
  wallet_tl_context: { message: 'May naiwan na wallet sa table. Ano gagawin ko?', prior: ['Hey, I’m on the opening shift tomorrow. What do I need to do before we let people in?', 'Someone’s on a loud call and people are complaining. How should I handle it?', 'I already asked them to keep it down, but they’re still doing it. What now?'] },
  wallet_en_context: { message: 'Someone left their wallet on a desk. What should I do with it?', prior: ['Hey, I’m on the opening shift tomorrow. What do I need to do before we let people in?', 'Someone’s on a loud call and people are complaining. How should I handle it?', 'I already asked them to keep it down, but they’re still doing it. What now?', 'May naiwan na wallet sa table. Ano gagawin ko?'] },
  food_return: { message: 'A guest wants to go out for food and come back later. Do I check them out?', prior: [], expected_reentry: true },
  food_return_context: { message: 'A guest wants to go out for food and come back later. Do I check them out?', prior: ['Someone left their wallet on a desk. What should I do with it?'], expected_reentry: true },
  payment_frontdesk: { message: 'Someone paid online and showed me a screenshot. Can I approve it at the front desk?', prior: [] },
  first_noise: { message: 'Hey, a customer is being really loud and the others are getting annoyed. What should I do?', prior: [] },
  formal: { message: 'How should employees address noise complaints?', prior: [] },
  opening: { message: 'I’m opening today. What should I get ready before customers arrive?', prior: ['Hey, a customer is being really loud and the others are getting annoyed. What should I do?', 'And if they keep doing it after I ask them to quiet down?'] },
  noise: { message: 'And if they keep doing it after I ask them to quiet down?', prior: ['Hey, a customer is being really loud and the others are getting annoyed. What should I do?'] },
  standalone: { message: 'A customer keeps being noisy after I ask them to quiet down. What should I do?', prior: [] },
  fresh_opening: { message: 'I’m opening today. What should I get ready before customers arrive?', prior: [] },
  laptop: { message: 'Someone left a laptop behind. What do I do with it?', prior: [] },
  online: { message: 'A customer sent a payment screenshot online. Can the front desk approve it?', prior: [] },
  lunch: { message: 'A customer just wants to grab lunch and come back. Should I check them out?', prior: [] },
  wifi: { message: 'May nagrereklamo na mahina ang wifi. Ano gagawin ko?', prior: [] },
  refund: { message: 'How much should we refund someone if they cancel?', prior: [], expected_gap: true },
  nohold: { message: 'If someone has picked a desk but hasn’t paid yet, is it already reserved for them?', prior: [] },
  handover: { message: 'I’m finishing my shift. What should I tell the next person?', prior: [] },
};
async function main() {
  const selectedCase = process.argv[2] || 'noise';
  const item = cases[selectedCase];
  if (!item) throw Error('CASE_REQUIRED');
  const env = { ...parseEnv(readFileSync(resolve(__dirname, '../apps/admin-portal/.env.local'), 'utf8')), ...process.env };
  if (env.RAG_HYBRID_RETRIEVAL === 'true') throw Error('SEMANTIC_BASELINE_REQUIRED');
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const probeRole = process.argv.includes('--staff') ? 'STAFF' : 'ADMIN';
  const actor = await db.from('staff_profiles').select('user_id').eq('role', probeRole).eq('is_active', true).limit(1).single();
  if (actor.error) throw Error('ACTIVE_ADMIN_REQUIRED');
  const report = { case: selectedCase, component_probe: true, role: probeRole, stages: [] };
  async function model(path, input) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: actor.data.user_id, role: probeRole, request_id: randomUUID(), scope: env.RAG_SCOPE_ID, ops: ['search', 'answer'], iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
    const capability = payload + '.' + createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
    const started = performance.now();
    const response = await fetch(new URL(path, env.RAG_SERVICE_URL), { method: 'POST', headers: { Authorization: 'Bearer ' + env.RAG_SERVICE_TOKEN, 'X-Request-Capability': capability, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(55000) });
    const data = await response.json();
    report.stages.push({ path, status: response.status, elapsed_ms: Math.round(performance.now() - started) });
    if (!response.ok) {
      const allowed = new Set(['OUTPUT_BUDGET_EXCEEDED', 'CONTEXT_BUDGET_EXCEEDED', 'INVALID_MODEL_OUTPUT', 'MODEL_TIMEOUT', 'REQUEST_TIMEOUT', 'CAPACITY_BUSY', 'UNRESOLVED_CONTEXT']);
      report.failure = { path, status: response.status, reason: allowed.has(data.detail) ? data.detail : 'MODEL_STAGE_FAILED' };
      report.passed = false;
      console.log(JSON.stringify(report, null, 2));
      throw Error('MODEL_STAGE_FAILED');
    }
    return data;
  }
  async function rpc(name, input) {
    const result = await db.rpc(name, { p_actor: actor.data.user_id, p_scope: env.RAG_SCOPE_ID, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, ...input });
    if (result.error) throw Error('READ_ONLY_RPC_FAILED');
    return result.data;
  }
  const plan = await model('/v1/plan', { message: item.message, recent_context: { user_turns: item.prior }, business_date: '2026-10-16', timezone: 'Asia/Manila', search_enabled: process.argv.includes('--candidate') });
  report.plan_kind = plan.kind;
  report.query_changed = plan.query !== item.message;
  report.search_aid_count = [plan.search?.topic, plan.search?.standalone, ...(plan.search?.alternatives || [])].filter(Boolean).length;
  report.search_aid_topic_signals = [plan.search?.topic, plan.search?.standalone, ...(plan.search?.alternatives || [])].filter(Boolean).map(text => ({ lost_property: /lost|found|left|wallet|naiwan/i.test(text), procedure: /procedure|process|handling|manage|steps/i.test(text), english_operational_terms: /lost and found|lost property|found property|belongings/i.test(text) }));
  report.query_topic_signals = { lost_property: /wallet|lost|found|naiwan/i.test(plan.query || ''), noise: /noise|noisy|loud|quiet/i.test(plan.query || '') };
  report.query_preserves_return_intent = /return|come back|re[- ]?entry|temporary|lunch|food|stepping outside/i.test(plan.query || '');
  report.query_is_generic_checkout = /^(?:how do i|how do staff|how can i|how to|what is the procedure to) check[ -]?out (?:a |the )?(?:customer|guest)\??$/i.test(plan.query || '');
  const query = (plan.query || item.message).trim().replace(/\s+/g, ' ').replace(/\bcheck(?:[ -]?out|otu)\b/gi, 'check out').replace(/\bcheck[ -]?in\b/gi, 'check in');
  const embedded = await model('/v1/embed', { query });
  let candidates = await rpc('assistant_search_knowledge', { p_vector: embedded.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
  report.initial_candidate_count = candidates.length;
  if (process.argv.includes('--candidate') && !candidates.length && plan.search?.original === item.message) {
    const variants = [...new Set([plan.search.topic, plan.search.standalone, ...(plan.search.alternatives || [])].filter(value => value && value !== item.message))].slice(0, 3);
    if (variants.length) {
      const alternatives = await model('/v1/embed-queries', { queries: variants.map(variant => item.message + '\nSearch interpretation: ' + variant) });
      const found = new Map();
      for (const embedded of alternatives.embeddings) {
        const rows = await rpc('assistant_search_knowledge', { p_vector: embedded.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
        rows.forEach(source => found.set(source.chunk_id, source));
      }
      // Component corpus is tiny; gateway uses the real bounded RRF fusion.
      candidates = [...found.values()].slice(0, 12);
      report.semantic_aid = true;
    }
  }
  report.candidate_count = candidates.length;
  const reliability = process.argv.includes('--ms60') ? { reliability_contract: 'ms60-v1', original_query: item.message } : {};
  const selectionQuery = process.argv.includes('--original-selection') ? item.message : plan.query || item.message;
  report.selection_bytes = Buffer.byteLength(JSON.stringify({ query: plan.query || item.message, sources: candidates, contract_version: 2 }));
  let selection = await model('/v1/context', { query: selectionQuery, sources: candidates, contract_version: 2, ...reliability });
  report.selected_indexes = selection.chunk_ids.map(id => candidates.findIndex(source => source.chunk_id === id));
  report.coverage = { scope: selection.coverage?.scope, outcome: selection.coverage?.outcome };
  let expanded = selection.chunk_ids.length ? await rpc('assistant_expand_evidence', { p_chunks: selection.chunk_ids }) : { complete: true, sources: [], groups: [] };
  const packing = async () => process.argv.includes('--ms60') && expanded.complete && expanded.sources.length
    ? await model('/v1/evidence-cost', { query: plan.query || item.message, original_query: item.message, ...(process.argv.includes('--ms60') ? { reliability_contract: 'ms60-v1' } : {}), sources: expanded.sources, groups: expanded.groups, required_chunk_ids: expanded.sources.map(source => source.chunk_id), coverage: selection.coverage }) : { fits: true };
  let packed = await packing();
  if (process.argv.includes('--candidate') && (!packed.fits || !expanded.complete && expanded.reason === 'CONTEXT_BUDGET')) {
    selection = await model('/v1/context', { query: plan.query || item.message, sources: candidates, contract_version: 2, reconsider: true, prior_coverage: selection.coverage, ...reliability });
    expanded = selection.chunk_ids.length ? await rpc('assistant_expand_evidence', { p_chunks: selection.chunk_ids }) : { complete: true, sources: [], groups: [] };
    report.reconsidered = true;
    report.selected_indexes = selection.chunk_ids.map(id => candidates.findIndex(source => source.chunk_id === id));
    report.coverage = { scope: selection.coverage?.scope, outcome: selection.coverage?.outcome };
    packed = await packing();
  }
  if (process.argv.includes('--ms60')) report.packed = { fits: packed.fits, quote_count: packed.quote_count };
  report.complete = expanded.complete;
  report.reason = expanded.reason;
  report.closure_count = expanded.sources.length;
  if (process.argv.includes('--packing-control') && expanded.complete) {
    // Inspect the serving packer in a subprocess over stdin. Never persist or
    // print canonical source text; only source/quote counts leave the process.
    const { spawnSync } = require('node:child_process');
    const code = 'import json,sys\nfrom rag.evidence import pack_evidence\nitems=json.load(sys.stdin)\ncounts=[len(pack_evidence(text)) for text in items]\nprint(json.dumps({"per_source_quote_counts":counts,"total_quotes":sum(counts)}))';
    const packed = spawnSync('python', ['-c', code], { cwd: resolve(__dirname, '../services/rag'), input: JSON.stringify(expanded.sources.map(source => source.content)), encoding: 'utf8' });
    report.packing_control = packed.status === 0 ? JSON.parse(packed.stdout) : { status: 'PACKING_FAILED' };
  }
  const headingOnly = source => source.content.split(/\n\s*\n/).every(part => {
    const text = part.trim().replace(/^#{1,6}\s*/, '').replace(/\\\./g, '.');
    return !text || source.heading_path.replace(/\\\./g, '.').includes(text);
  });
  report.candidate_topics = candidates.map((source, index) => ({ index,
    noise: /noise control|noise complaints/i.test(source.heading_path),
    opening: /opening procedures|before opening/i.test(source.heading_path),
    complaints: /complaint/i.test(source.heading_path), heading_only: headingOnly(source) }));
  report.lost_property_candidates = candidates.filter(source => /lost and found/i.test(source.heading_path)).length;
  report.return_rule_candidate_count = candidates.filter(source => /re[- ]?entry|temporary exit/i.test(source.content)).length;
  report.return_rule_in_selected_closure = expanded.sources.some(source => /re[- ]?entry|temporary exit/i.test(source.content));
  report.single_seed_closures = [];
  for (const id of selection.chunk_ids) {
    const single = await rpc('assistant_expand_evidence', { p_chunks: [id] });
    report.single_seed_closures.push({ index: candidates.findIndex(source => source.chunk_id === id), complete: single.complete, reason: single.reason, count: single.sources.length, heading_only_count: single.sources.filter(headingOnly).length });
  }
  const ids = new Set(selection.chunk_ids);
  for (const row of report.single_seed_closures.filter(row => row.complete)) {
    const single = await rpc('assistant_expand_evidence', { p_chunks: [candidates[row.index].chunk_id] });
    single.sources.forEach(source => ids.add(source.chunk_id));
  }
  report.known_union_count = ids.size;
  report.selected_heading_only = selection.chunk_ids.map(id => {
    const source = candidates.find(candidate => candidate.chunk_id === id);
    return { index: candidates.indexOf(source), heading_only: headingOnly(source) };
  });
  report.source_id_digests = [...ids].map(id => createHash('sha256').update(id).digest('hex'));
  if (process.argv.includes('--minimal-control') && candidates.length && selection.coverage) {
    // Diagnostic comparison only: not an application fallback or permission to drop restrictions.
    // Keep the complete reviewed closure of the highest-ranked direct task unit.
    const first = await rpc('assistant_expand_evidence', { p_chunks: [candidates[0].chunk_id] });
    if (first.complete) {
      const answer = await model('/v1/answer', { query: plan.query || item.message, sources: first.sources, groups: first.groups,
        required_chunk_ids: first.sources.map(source => source.chunk_id), coverage: selection.coverage });
      report.minimal_control = { source_count: first.sources.length, quote_count: answer.quotes?.length ?? 0,
        exact_supported: !answer.conflicting_sources && answer.quotes?.length > 0 && answer.quotes.every(quote => first.sources.some(source => source.chunk_id === quote.chunk_id && source.content.includes(quote.quote))) };
    }
  }
  // Exact symptom: an ordinary answerable question cannot reach answering when closure overflows.
  report.passed = expanded.complete && expanded.sources.length > 0 && expanded.sources.length <= 6;
  report.closure_admitted = report.passed;
  if (process.argv.includes('--candidate') && expanded.complete) {
    if (!expanded.sources.length) report.passed = Boolean(item.expected_gap && selection.coverage?.outcome === 'INSUFFICIENT');
    else {
      const result = await model('/v1/answer', { query: plan.query || item.message, original_query: item.message, ...(process.argv.includes('--ms60') ? { reliability_contract: 'ms60-v1' } : {}), sources: expanded.sources, groups: expanded.groups,
        required_chunk_ids: expanded.sources.map(source => source.chunk_id), coverage: selection.coverage });
      report.exact_answer_verified = !result.conflicting_sources && result.quotes?.length > 0 && result.quotes.every(quote => expanded.sources.some(source => source.chunk_id === quote.chunk_id && source.content.includes(quote.quote)));
      report.explicit_amount_gap = Boolean(item.expected_gap && !result.quotes?.length && !result.conflicting_sources);
      report.passed = item.expected_gap ? report.explicit_amount_gap : report.exact_answer_verified;
      if (item.expected_reentry) {
        // Provenance alone cannot pass a temporary-departure answer. The real
        // SOP explicitly distinguishes re-entry from final checkout.
        report.temporary_departure_distinguished = result.quotes?.some(quote => /re[- ]?entry|temporary exit/i.test(quote.quote)) ?? false;
        report.passed &&= report.temporary_departure_distinguished;
        if (process.argv.includes('--original-control')) {
          const control = await model('/v1/answer', { query: item.message, original_query: item.message, ...(process.argv.includes('--ms60') ? { reliability_contract: 'ms60-v1' } : {}), sources: expanded.sources, groups: expanded.groups,
            required_chunk_ids: expanded.sources.map(source => source.chunk_id), coverage: selection.coverage });
          report.original_question_control = { quote_count: control.quotes?.length ?? 0,
            temporary_departure_distinguished: control.quotes?.some(quote => /re[- ]?entry|temporary exit/i.test(quote.quote)) ?? false };
        }
      }
      // Independently reread actor/catalog/sources; this still is not a browser benchmark.
      const currentActor = await db.from('staff_profiles').select('role,is_active').eq('user_id', actor.data.user_id).single();
      const catalog = await rpc('assistant_knowledge_availability', {});
      for (const source of expanded.sources) {
        const current = await rpc('assistant_read_source', { p_version: source.version_id, p_chunk: source.chunk_id });
        report.passed &&= current?.content_hash === source.content_hash && current?.epoch === source.epoch && createHash('sha256').update(source.content).digest('hex') === source.content_hash;
      }
      report.passed &&= !currentActor.error && currentActor.data.role === probeRole && currentActor.data.is_active && catalog.enabled && expanded.sources.every(source => source.epoch === catalog.knowledge_epoch);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
main().catch(() => { console.error('NATURAL_AUDIT_PROBE_FAILED'); process.exitCode = 1; });
