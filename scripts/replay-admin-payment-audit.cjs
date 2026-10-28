// PRD-F26/F27 / QAD-TC44-TC46: opt-in component replay, separate from normal browser acceptance.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const defaultQuestions = [
  "I'm new to handling payments. Where do I start?",
  "I need to review a customer's payment. What should I check?",
  'I think I rejected a payment by mistake. How can I fix it?',
  'What happens to the desk after I approve a payment?',
  'The receipt is hard to read. What should I do?',
  "Do I have to explain why I'm rejecting a payment?",
  'Paano ko malalaman kung okay na i-approve yung payment?',
  'What should administrators do if they believe a payment was rejected incorrectly?',
  'how many check ins today',
  'How many bookings today?',
  'Ilan ang naka-check in ngayon?',
];
const questions = process.env.RAG_AUDIT_QUESTIONS_FILE
  ? JSON.parse(readFileSync(process.env.RAG_AUDIT_QUESTIONS_FILE, 'utf8')) : defaultQuestions;
if (!Array.isArray(questions) || questions.some(question => typeof question !== 'string' || !question.trim())) throw Error('INVALID_AUDIT_QUESTIONS');
const recentContext = process.env.RAG_AUDIT_CONTEXT_FILE ? JSON.parse(readFileSync(process.env.RAG_AUDIT_CONTEXT_FILE, 'utf8')) : undefined;

async function main() {
  const role = process.env.RAG_AUDIT_ROLE || 'ADMIN';
  if (!['ADMIN', 'STAFF'].includes(role)) throw Error('INVALID_AUDIT_ROLE');
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')), ...process.env };
  const base = new URL(process.argv[2] || 'http://127.0.0.1:3010');
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('LOCAL_COMPONENT_REPLAY_ONLY');
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await db.from('staff_profiles').select('user_id').eq('role', role).eq('is_active', true).limit(1).single();
  if (actor.error || !actor.data) throw Error('ACTIVE_ADMIN_REQUIRED');
  const { issueAdminSession } = await import('../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession.ts');
  const { issueStaffAssistantSession } = await import('../apps/admin-portal/src/server/assistant/session.ts');
  const token = (role === 'ADMIN' ? issueAdminSession : issueStaffAssistantSession)(actor.data.user_id, env.SUPABASE_SERVICE_ROLE_KEY);
  const indexes = process.argv[3] ? process.argv[3].split(',').map(Number) : questions.map((_, i) => i);
  for (const index of indexes) {
    if (!Number.isSafeInteger(index) || !questions[index]) throw Error('INVALID_CASE');
    const started = performance.now();
    const response = await fetch(new URL('/api/assistant/query', base), { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: base.origin, 'Content-Type': 'application/json',
        'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1', 'X-DeskAtlas-Diagnostics': 'ms60-v1' },
      body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: questions[index], ...(recentContext ? { recent_context: recentContext } : {}) }),
      signal: AbortSignal.timeout(60000) });
    const answer = await response.json();
    const diagnostic = JSON.parse(response.headers.get('X-RAG-Diagnostics') || 'null');
    const stages = Object.fromEntries((response.headers.get('Server-Timing') || '').split(',').flatMap(part => {
      const match = /^\s*([a-z_]+);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
      return match ? [[match[1], Number(match[2])]] : [];
    }));
    console.log(JSON.stringify({ case: index, role, question: questions[index], component_probe: true, status: response.status,
      outcome: answer.data?.outcome, mode: answer.data?.answer_mode, citations: answer.data?.citations?.length ?? 0,
      limitations: answer.data?.limitations, summary: answer.data?.summary, tables: answer.data?.tables, error: answer.error?.code, error_message: answer.error?.message,
      diagnostic: diagnostic ? { stage: diagnostic.stage, failures: diagnostic.failures, counts: diagnostic.counts } : null,
      token_counts: JSON.parse(response.headers.get('X-RAG-Token-Counts') || 'null'), stages_ms: stages, elapsed_ms: Math.round(performance.now() - started) }));
    if (!response.ok || answer.data?.outcome !== 'SUPPORTED' || performance.now() - started >= Number(process.env.RAG_AUDIT_MAX_MS || Infinity)) process.exitCode = 1;
  }
}
main().catch(() => { console.error('PAYMENT_COMPONENT_REPLAY_FAILED'); process.exitCode = 2; });
