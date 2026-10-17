import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';

// PRD-F26 / SDD-C20/C21 / QAD-TC44: opt-in read-only gateway diagnosis.
// Component capability, not a substitute for the normally signed-in browser.
const live = process.env.RAG_BROAD_AUDIT === '1';
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
  { id: 'nohold-context', message: "They've chosen a desk. Is that enough to secure it?", history: [
    'A guest is unhappy with the place. How should I handle it?', "What if I can't sort it out myself?",
    'Someone just walked in and wants a seat. How do I help?', 'Do they need an account first?',
  ] },
  { id: 'facility-fresh', message: "Something in the workspace isn't working. What should I do?", history: [] },
  { id: 'named-equipment', message: "The printer isn't working. What should I do?", history: [
    "Something in the workspace isn't working. What should I do?",
  ] },
  { id: 'nohold-fresh', message: "They've chosen a desk. Is that enough to secure it?", history: [] },
  { id: 'reception-fresh', message: "I'm covering reception today. What should I focus on?", history: [] },
  { id: 'walkin-context', message: 'Someone just walked in and wants a seat. How do I help?', history: [
    "I'm covering reception today. What should I focus on?", 'What should I check before we open?',
    'A guest is unhappy with the place. How should I handle it?', "What if I can't sort it out myself?",
  ] },
  { id: 'property-context', message: 'Someone left something behind. What do we do?', history: [
    'Do they need an account first?', "They've chosen a desk. Is that enough to secure it?",
    "Something in the workspace isn't working. What should I do?", 'What should I pass on when my shift ends?',
  ] },
  { id: 'temporary-exit', message: 'A guest needs to leave for a bit. What do I do?', history: [] },
  { id: 'complaint-followup', message: "What if I can't sort it out myself?", history: [
    'What should I check before we open?', 'A guest is unhappy with the place. How should I handle it?',
  ] },
];
it.skipIf(!live).each(cases)('broad question gateway audit: $id', async item => {
  const started = performance.now();
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', { method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-DeskAtlas-Answer-Contract': 'ms59-v1',
      'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
      Authorization: `Bearer ${issueStaffAssistantSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
    body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: item.message, recent_context: { user_turns: item.history } }),
  }));
  const envelope = await response.json() as { data?: unknown };
  const parsed = assistantAnswerSchema.safeParse(envelope.data);
  const answer = parsed.success ? parsed.data : undefined;
  const proof = answer?.evidence_spans?.map(span => span.quote).join('\n') ?? '';
  const text = answer?.synthesis?.main_blocks?.map(block => block.text).join('\n') || proof;
  const useful = item.id.startsWith('nohold')
    ? /no inventory holds|do not reserve inventory|only on authorized payment|never holds inventory/i.test(text)
    : item.id === 'reception-fresh' ? answer?.answer_mode === 'CLARIFICATION'
      || /customer|guest/i.test(text) && /complaint|concern|courteous|greet/i.test(text) && /reservation|booking|payment/i.test(text)
    : item.id === 'walkin-context' ? /kiosk/i.test(text) && /payment/i.test(text) && /allocat|assign/i.test(text)
    : item.id === 'property-context' ? /ownership/i.test(text) && /secur/i.test(text) && !/incoming employee/i.test(text)
    : item.id === 'temporary-exit' ? /re.entry|temporary exit|intended return/i.test(text) && !/record the check.out|confirm.*vacated/i.test(text)
    : item.id === 'complaint-followup' ? /escalat|supervisor|management/i.test(text) && /concern|complaint|issue/i.test(text)
    : item.id === 'named-equipment' ? /report|management/i.test(text)
      && !['EVIDENCE_GAP', 'CLARIFICATION', 'FAILURE'].includes(answer?.answer_mode ?? '')
    // The original audit allows a focused item clarification for an unnamed
    // fault. A generic not-verified reply still fails this assertion.
    : answer?.answer_mode === 'CLARIFICATION'
      ? /which equipment|what equipment|part of the workspace/i.test(answer.summary) && answer.summary.trim().endsWith('?')
      : /report|management|malfunction|maintenance|repair|equipment/i.test(text) && answer?.answer_mode !== 'EVIDENCE_GAP';
  const record = { case: item.id, component_probe: true, status: response.status, valid: parsed.success,
    kind: answer?.kind, mode: answer?.answer_mode, useful, elapsed_ms: Math.round(performance.now() - started),
    diagnostics: JSON.parse(response.headers.get('X-RAG-Diagnostics') || '{}') as unknown,
    timing: response.headers.get('server-timing') };
  const dir = 'services/rag/benchmark-results/broad-audit-2026-10-17';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${item.id}-${randomUUID()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
  expect(useful).toBe(true);
}, 60000);
