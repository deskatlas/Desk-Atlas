// PRD-F26 / SDD-C20-C24 / QAD-TC44/46: authorized production latency check.
// Normal gateway admission and quotas apply. No credentials are printed/saved.
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { randomUUID } = require('node:crypto');
const { dirname } = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const questions = [
  'Can you give me the big picture of how bookings, payments, and check-ins fit together?',
  'If they already sent proof, does that mean the desk is secured?',
  "Someone says they paid, but their booking isn't confirmed. What should I do?",
  'They paid online. How do I review it?',
  'How are things looking today? Anything I need to deal with?',
  'May nagrereklamo sa wifi at ang ingay daw. Paano ko sila tutulungan?',
  'How do booking QR codes work when a guest arrives?',
  "I'm about to hand over my shift. What should I tell the next person?",
];
async function main() {
  const output = process.argv[2];
  if (!output) throw Error('OUTPUT_REQUIRED');
  const base = new URL('https://admin.thedeskatlas.com');
  const env = parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8'));
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  if (actor.error || !actor.data) throw Error('ACTIVE_ADMIN_REQUIRED');
  const { issueAdminSession } = await import('../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession.ts');
  const token = issueAdminSession(actor.data.user_id, env.SUPABASE_SERVICE_ROLE_KEY);
  const headers = { Authorization: `Bearer ${token}`, Origin: base.origin, 'Content-Type': 'application/json',
    'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1' };
  const rows = [], history = [], session = randomUUID();
  let selections;
  mkdirSync(dirname(output), { recursive: true });
  function save() { writeFileSync(output, JSON.stringify({ surface: base.origin, measurement: 'complete_http_not_browser_render', rows }, null, 2)); }
  for (const [index, message] of questions.entries()) {
    const availability = await fetch(new URL('/api/assistant/query', base), { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const available = await availability.json();
    if (!availability.ok || !available.data?.enabled) throw Error('PRODUCTION_AVAILABILITY_UNVERIFIED');
    const start = performance.now();
    const response = await fetch(new URL('/api/assistant/query', base), { method: 'POST', headers,
      body: JSON.stringify({ message, session_id: session, request_id: randomUUID(), recent_context: {
        user_turns: history.slice(-4), selections, knowledge_epoch: available.data.knowledge_epoch } }),
      signal: AbortSignal.timeout(65000), cache: 'no-store' });
    const body = await response.json();
    const elapsed = Math.round(performance.now() - start);
    const data = body.data;
    const row = { case: index + 1, question: message, status: response.status, elapsed_ms: elapsed,
      kind: data?.kind, outcome: data?.outcome, mode: data?.answer_mode,
      citations: data?.citations?.length || 0, tables: data?.tables?.length || 0,
      summary: data?.summary, limitations: data?.limitations, error: body.error?.code,
      server_timing: response.headers.get('Server-Timing'),
      substantive: response.ok && data?.outcome === 'SUPPORTED' && Boolean(data.citations?.length || data.tables?.length),
      within_10s: elapsed < 10000, within_15s: elapsed < 15000 };
    rows.push(row); save();
    console.log(JSON.stringify({ case: row.case, status: row.status, outcome: row.outcome, elapsed_ms: elapsed,
      substantive: row.substantive, citations: row.citations, tables: row.tables, error: row.error }));
    if (response.status === 429 || response.status === 401 || response.status === 403) break;
    history.push(message); selections = data?.selections;
  }
  process.exitCode = rows.length === questions.length && rows.every(r => r.substantive || r.outcome === 'CLARIFICATION') ? 0 : 1;
}
main().catch(() => { console.error('PRODUCTION_LATENCY_CHECK_FAILED'); process.exitCode = 2; });
