import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';

// QAD-TC44 / MS60: opt-in, real staff gateway; content-free diagnostics only.
const live = process.env.RAG_AUDIT_GATEWAY === '1';
let actor = '';
beforeAll(async () => {
  if (!live) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')))) vi.stubEnv(key, value);
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true');
  const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const profile = await db.from('staff_profiles').select('user_id').eq('role', 'STAFF').eq('is_active', true).limit(1).single();
  if (profile.error || !profile.data) throw new Error('ACTIVE_STAFF_REQUIRED');
  actor = profile.data.user_id;
});
afterAll(() => vi.unstubAllEnvs());
const history = [
  'Someone’s on a loud call and it’s bothering the other guests. What do I do?',
  'I already asked nicely, but they’re still at it. What now?',
  'May naiwan na bag sa upuan. Saan ko ilalagay?',
  'A guest wants to pop out for a snack and come back. Do I check them out?',
];
const cases = [
  { id: 'payment-context', question: 'They paid on the website and showed me the screenshot. Can I confirm that at the counter?', history, permission: true },
  { id: 'payment-explicit', question: 'I mean, as staff, am I allowed to approve an online payment proof?', history: [...history.slice(1), 'They paid on the website and showed me the screenshot. Can I confirm that at the counter?'], permission: true },
  { id: 'refund-context', question: 'What if someone cancels, how much do we refund?', history, permission: false },
];
it.skipIf(!live).each(cases)('October 17 audited staff gateway: $id', async item => {
  const started = performance.now();
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-DeskAtlas-Answer-Contract': 'ms59-v1', Authorization: `Bearer ${issueStaffAssistantSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
    body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: item.question, recent_context: { user_turns: item.history } }),
  }));
  const envelope = await response.json() as { data?: unknown };
  const parsed = assistantAnswerSchema.safeParse(envelope.data);
  const diagnostic = JSON.parse(response.headers.get('X-RAG-Diagnostics') || '{}') as { counts?: Record<string, number>; failures?: { reason: string; stage: string }[]; fallback_reason?: string };
  const answer = parsed.success ? parsed.data : undefined;
  const text = answer?.evidence_spans?.map(span => span.quote).join('\n') ?? '';
  const useful = item.permission
    ? /administrators?.{0,40}approve.{0,40}online payment|online payment[- ]proof approval or rejection belongs to administrators/i.test(text)
    : Boolean(answer?.limitations.some(line => /NO_RELEVANT_SOURCE:/.test(line)) && !answer.limitations.some(line => /INCOMPLETE_EVIDENCE|MODEL_TIMEOUT|REQUEST_TIMEOUT/.test(line)));
  const record = { case: item.id, status: response.status, schema: parsed.success, useful, elapsed_ms: Math.round(performance.now() - started), mode: answer?.answer_mode, tokens: JSON.parse(response.headers.get('X-RAG-Token-Counts') || '{}'), counts: diagnostic.counts, failures: diagnostic.failures, fallback: diagnostic.fallback_reason };
  const directory = 'services/rag/benchmark-results/audit-remediation-2026-10-17';
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${item.id}-${randomUUID()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
  expect(useful).toBe(true);
}, 60000);
