// PRD-F26 / SDD-C20/C21 / QAD-TC44: read-only planner reproduction.
// Authored test questions only. Never print credentials, model prose or sources.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHmac, randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const env = { ...parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')), ...process.env };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await db.from('staff_profiles').select('user_id').eq('role', 'STAFF').eq('is_active', true).limit(1).single();
  if (actor.error || !actor.data) throw Error('ACTIVE_STAFF_REQUIRED');
  const mode = process.argv[2] || 'mixed';
  const noise = 'Someone keeps taking loud calls and the people around them are getting annoyed. How do I handle that?';
  const histories = {
    mixed: ['Hey, first time opening by myself tomorrow. What should I get ready?', noise],
    minimal: [noise],
    fresh: [],
    property: ['A customer is unhappy with the wifi.', 'Someone left a bag behind. What do I do?'],
    correction: ['What should I prepare before opening?', noise],
    ambiguous: ['One guest wants an extension and another wants to leave early.'],
    language: [],
  };
  if (!Object.hasOwn(histories, mode)) throw Error('CASE_REQUIRED');
  const message = mode === 'language' ? 'May naiwan na tumbler sa desk. Ano gagawin ko dito?'
    : mode === 'property' ? 'And before I give it back?'
    : mode === 'correction' ? 'Actually someone left their laptop behind. What should I do with it?'
      : mode === 'ambiguous' ? 'How do I handle their request?'
        : 'I already asked them twice and they just keep doing it. Now what?';
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: actor.data.user_id,
    role: 'STAFF', request_id: randomUUID(), scope: env.RAG_SCOPE_ID, ops: ['answer', 'search'],
    iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
  const signature = createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
  const started = performance.now();
  const response = await fetch(new URL('/v1/plan', env.RAG_SERVICE_URL), { method: 'POST',
    headers: { Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, recent_context: { user_turns: histories[mode] },
      business_date: '2026-10-17', timezone: 'Asia/Manila', search_enabled: true }),
    signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw Error('PLANNER_REQUEST_FAILED');
  const plan = await response.json();
  const topicPreserved = (['property', 'correction', 'language'].includes(mode) ? /bag|laptop|property|lost|found|ownership|return|belonging|naiwan/i : /noise|noisy|loud|call|quiet/i).test(plan.query || '');
  const passed = ['fresh', 'ambiguous'].includes(mode) ? plan.kind === 'CLARIFY' : plan.kind === 'DOCUMENT' && topicPreserved;
  console.log(JSON.stringify({ component_probe: true, case: mode, status: response.status,
    kind: plan.kind, topic_preserved: topicPreserved, clarification_present: Boolean(plan.clarification),
    history_turns: histories[mode].length, elapsed_ms: Math.round(performance.now() - started), passed }));
  if (mode === 'language') {
    const variants = [message, `${message}\nSearch interpretation: Lost and found property handling.`,
      `Search interpretation: Lost and found property handling.\nOriginal question: ${message}`,
      'How should employees handle lost and found items?'];
    const embedded = await fetch(new URL('/v1/embed-queries', env.RAG_SERVICE_URL), { method: 'POST',
      headers: { Authorization: `Bearer ${env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${payload}.${signature}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: variants }), signal: AbortSignal.timeout(15000) });
    if (!embedded.ok) throw Error('EMBEDDING_CONTROL_FAILED');
    const batch = await embedded.json();
    const counts = [];
    for (const row of batch.embeddings) {
      const result = await db.rpc('assistant_search_knowledge', { p_actor: actor.data.user_id, p_scope: env.RAG_SCOPE_ID,
        p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_vector: row.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
      if (result.error) throw Error('RETRIEVAL_CONTROL_FAILED');
      counts.push(result.data.length);
    }
    const search = plan.search || {};
    console.log(JSON.stringify({ diagnostic_only: true, variant_candidate_counts: counts,
      topic_is_property: /lost|found|property|belonging/i.test(search.topic || ''),
      standalone_is_property: /lost|found|property|belonging/i.test(search.standalone || ''),
      alternatives_property: (search.alternatives || []).map(text => /lost|found|property|belonging/i.test(text)) }));
  }
  process.exitCode = passed ? 0 : 1;
}
main().catch(() => { console.error('AUDIT_PROBE_FAILED'); process.exitCode = 2; });
