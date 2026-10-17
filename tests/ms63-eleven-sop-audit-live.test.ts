import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';

// PRD-F26 / SDD-C20/C21 / QAD-TC44/46: opt-in read-only audit reproduction.
// Component credentials do not establish normally authenticated browser acceptance.
const live = process.env.RAG_ELEVEN_SOP_AUDIT === '1';
let actor = '';
beforeAll(async () => {
  if (!live) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync('apps/staff-dashboard/.env.local', 'utf8')))) vi.stubEnv(key, value);
  vi.stubEnv('RAG_DIAGNOSTICS_ENABLED', 'true');
  const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const profile = await db.from('staff_profiles').select('user_id').eq('role', 'STAFF').eq('is_active', true).limit(1).single();
  if (profile.error || !profile.data) throw Error('ACTIVE_STAFF_REQUIRED');
  actor = profile.data.user_id;
});
afterAll(() => vi.unstubAllEnvs());

const cases = [
  { id: 'shift-monitoring', message: "Hey, I'm new at the front desk. What should I keep an eye on during my shift?", history: [] as string[] },
  { id: 'payment-broad-context', message: 'How do I handle payments at the front desk?', history: [
    "Hey, I'm new at the front desk. What should I keep an eye on during my shift?",
    'What should I do when someone walks in and wants to use the place?',
    "They used the kiosk but can't find their code. Can I still help them?",
  ] },
  { id: 'missing-code-context', message: "They used the kiosk but can't find their code. Can I still help them?", history: [
    "Hey, I'm new at the front desk. What should I keep an eye on during my shift?",
    'What should I do when someone walks in and wants to use the place?',
  ] },
];
it.skipIf(!live).each(cases)('eleven-SOP audit: $id', async item => {
  const started = performance.now();
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
      'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
      Authorization: `Bearer ${issueStaffAssistantSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
    body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: item.message,
      recent_context: { user_turns: item.history } }),
  }));
  const envelope = await response.json() as { data?: unknown };
  const parsed = assistantAnswerSchema.safeParse(envelope.data);
  const answer = parsed.success ? parsed.data : undefined;
  const main = answer?.synthesis?.main_blocks?.map(block => block.text).join('\n')
    || answer?.synthesis?.blocks.map(block => block.text).join('\n')
    || answer?.evidence_spans?.map(span => span.quote).join('\n') || answer?.summary || '';
  const handoverOnly = /ending a shift|incoming employee|shift handover/i.test(main)
    && !/during.*shift|monitor|regularly|check.in|occupancy|check.out|which task|which part/i.test(main);
  const taskMatched = item.id === 'missing-code-context'
    ? /counter queue/i.test(main) && /name/i.test(main)
    : item.id === 'payment-broad-context'
      ? /payment/i.test(main) && /verif/i.test(main) && /kiosk|counter|administrator/i.test(main)
      : !handoverOnly && /monitor|occupancy|check.in|check.out|customer|professional/i.test(main);
  const useful = Boolean(answer && !['EVIDENCE_GAP', 'FAILURE'].includes(answer.answer_mode)
    && (answer.answer_mode === 'CLARIFICATION' || taskMatched));
  const record = { id: item.id, component_probe: true, status: response.status, valid: parsed.success,
    kind: answer?.kind, mode: answer?.answer_mode, scope: answer?.synthesis?.scope,
    useful, handover_only: handoverOnly, table_count: answer?.tables?.length,
    elapsed_ms: Math.round(performance.now() - started),
    diagnostics: JSON.parse(response.headers.get('X-RAG-Diagnostics') || '{}') as unknown,
    timing: response.headers.get('server-timing') };
  const directory = 'services/rag/benchmark-results/eleven-sop-audit-2026-10-17';
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${item.id}-${randomUUID()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
  expect(useful).toBe(true);
}, 60000);
