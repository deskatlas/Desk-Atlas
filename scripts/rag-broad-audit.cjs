// PRD-F26 / SDD-C21 / QAD-TC44: read-only planner reproduction.
// Synthetic authored questions only; no credentials, source text or model prose in output.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHmac, createHash, randomUUID } = require('node:crypto');
const cases = {
  walkin: { message: 'Someone just walked in and wants a seat. How do I help?', history: [] },
  'walkin-context': { message: 'Someone just walked in and wants a seat. How do I help?', history: [
    "I'm covering reception today. What should I focus on?", 'What should I check before we open?',
    'A guest is unhappy with the place. How should I handle it?', "What if I can't sort it out myself?",
  ] },
  reception: { message: "I'm covering reception today. What should I focus on?", history: [] },
  property: { message: 'Someone left something behind. What do we do?', history: [] },
  'property-context': { message: 'Someone left something behind. What do we do?', history: [
    'Do they need an account first?', "They've chosen a desk. Is that enough to secure it?",
    "Something in the workspace isn't working. What should I do?", 'What should I pass on when my shift ends?',
  ] },
  nohold: { message: "They've chosen a desk. Is that enough to secure it?", history: [] },
  'nohold-context': { message: "They've chosen a desk. Is that enough to secure it?", history: [
    'A guest is unhappy with the place. How should I handle it?', "What if I can't sort it out myself?",
    'Someone just walked in and wants a seat. How do I help?', 'Do they need an account first?',
  ] },
  exit: { message: 'A guest needs to leave for a bit. What do I do?', history: [] },
  facility: { message: "Something in the workspace isn't working. What should I do?", history: [] },
};
async function main() {
  const id = process.argv[2] || 'walkin-context';
  const item = cases[id];
  if (!item) throw Error('CASE_REQUIRED');
  const env = { ...parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')), ...process.env };
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: randomUUID(), role: 'STAFF',
    request_id: randomUUID(), scope: env.RAG_SCOPE_ID, ops: ['answer', 'search'], iat: now, exp: now + 60,
    generation: randomUUID() })).toString('base64url');
  const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
  const started = performance.now();
  const response = await fetch(new URL('/v1/plan', env.RAG_SERVICE_URL), { method: 'POST', headers: {
    Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}`,
    'Content-Type': 'application/json',
  }, body: JSON.stringify({ message: item.message, recent_context: { user_turns: item.history },
    business_date: '2026-10-17', timezone: 'Asia/Manila', search_enabled: !process.argv.includes('--without-search-aids') }),
  signal: AbortSignal.timeout(55000) });
  const plan = await response.json();
  const kinds = new Set(['DOCUMENT', 'OPERATIONAL', 'REPORT', 'MIXED', 'CLARIFY', 'UNSUPPORTED']);
  const kind = kinds.has(plan.kind) ? plan.kind : 'INVALID';
  const propertyTopic = /lost|found|property|belonging|left.*behind/i.test(plan.query || '');
  const handoverTopic = /handover|hand.over|incoming employee|shift.*ends?|shift.*handover/i.test(plan.query || '');
  const passed = response.ok && kind === 'DOCUMENT' && (!id.startsWith('property') || propertyTopic)
    && (id !== 'reception' || !handoverTopic);
  console.log(JSON.stringify({ component_probe: true, case: id, status: response.status, kind,
    search_aids: !process.argv.includes('--without-search-aids'),
    history_turns: item.history.length, tool_count: Array.isArray(plan.tools) ? plan.tools.length : 0,
    clarification_empty: !plan.clarification?.trim(),
    clarification_question: typeof plan.clarification === 'string' && plan.clarification.trim().endsWith('?'),
    query_length: typeof plan.query === 'string' ? plan.query.length : null,
    search_booking: /booking|reserv|allocat|inventory/i.test(JSON.stringify(plan.search || {})),
    search_security: /security|equipment|maintenance|safe/i.test(JSON.stringify(plan.search || {})),
    search_selection_condition: /chos|choos|select|pick|secur|guarantee|confirm|allocat|inventory|hold/i.test(JSON.stringify(plan.search || {})),
    query_account: /account|identity|guest.first/i.test(plan.query || ''),
    query_selection_condition: /chos|choos|select|pick|secur|guarantee|confirm|allocat|inventory|hold/i.test(plan.query || ''),
    query_equals_original: plan.query === item.message,
    query_equals_latest_history: Boolean(item.history.length && plan.query === item.history.at(-1)),
    query_is_handover: handoverTopic,
    query_is_walkin: /walk.?in|booking|kiosk/i.test(plan.query || ''),
    query_is_property: propertyTopic,
    elapsed_ms: Math.round(performance.now() - started), passed }));
  if (process.argv.includes('--retrieval')) {
    const { createClient } = require('@supabase/supabase-js');
    const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const actor = await db.from('staff_profiles').select('user_id').eq('role', 'STAFF').eq('is_active', true).limit(1).single();
    if (actor.error || !actor.data) throw Error('ACTIVE_STAFF_REQUIRED');
    const variants = [item.message, ...[plan.search?.topic, plan.search?.standalone, ...(plan.search?.alternatives || [])]
      .filter(Boolean).map(text => `${item.message}\nSearch interpretation: ${text}`), plan.query,
      `Search interpretation: ${plan.query}\nOriginal question: ${item.message}`].slice(0, 7);
    const embedded = await fetch(new URL('/v1/embed-queries', env.RAG_SERVICE_URL), { method: 'POST', headers: {
      Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}`,
      'Content-Type': 'application/json',
    }, body: JSON.stringify({ queries: variants.slice(0, 4) }), signal: AbortSignal.timeout(15000) });
    if (!embedded.ok) throw Error('EMBEDDING_CONTROL_FAILED');
    const batch = await embedded.json();
    for (const [index, embedding] of batch.embeddings.entries()) {
      const result = await db.rpc('assistant_search_knowledge', { p_actor: actor.data.user_id, p_scope: env.RAG_SCOPE_ID,
        p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_vector: embedding.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
      if (result.error) throw Error('READ_ONLY_SEARCH_FAILED');
      console.log(JSON.stringify({ retrieval_control: true, case: id, variant: index, candidate_count: result.data.length,
        inventory_rule: result.data.some(source => /no inventory holds|do not reserve inventory|only on authorized payment/i.test(source.content)),
        inventory_rank: result.data.findIndex(source => /no inventory holds|do not reserve inventory|only on authorized payment/i.test(source.content)),
        equipment_passages: result.data.filter(source => /equipment|maintenance|facility hazards/i.test(source.heading_path)).length,
        complaint_passages: result.data.filter(source => /complaint|incident resolution/i.test(source.heading_path)).length,
        supply_passages: result.data.filter(source => /suppl/i.test(source.heading_path)).length,
        inventory_units: result.data.filter(source => /no inventory holds|do not reserve inventory|only on authorized payment/i.test(source.content))
          .map(source => createHash('sha256').update(source.chunk_id).digest('hex')) }));
    }
  }
  process.exitCode = passed ? 0 : 1;
}
main().catch(() => { console.error('BROAD_AUDIT_PROBE_FAILED'); process.exitCode = 2; });
