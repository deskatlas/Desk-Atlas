import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';

// PRD-F26 / MS60-TC25/26 / QAD-TC44: real component path, content-free artifacts.
const live = process.env.RAG_AUDIT_GATEWAY === '1';
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
  { id: 'opening-preparation', message: 'Hey, first time opening by myself tomorrow. What should I get ready?', history: [] },
  { id: 'mixed-followup', message: 'I already asked them twice and they just keep doing it. Now what?', history: [
    'Hey, first time opening by myself tomorrow. What should I get ready?',
    'Someone keeps taking loud calls and the people around them are getting annoyed. How do I handle that?'] },
  // Generated Tagalog failed semantic inspection. This is explicit safe-fallback
  // acceptance, not localized-main acceptance or evidence of translation quality.
  { id: 'property-safe-fallback', message: 'May naiwan na tumbler sa desk. Ano gagawin ko dito?', history: [
    'Hey, first time opening by myself tomorrow. What should I get ready?',
    'Someone keeps taking loud calls and the people around them are getting annoyed. How do I handle that?',
    'I already asked them twice and they just keep doing it. Now what?'] },
  { id: 'concise-nohold', message: 'If they already picked a desk but have not paid, is that spot theirs?', history: [] },
  { id: 'refund-gap', message: 'Okay. What if they cancel, how much money do we give back?', history: [
    'Someone booked online and is showing me a payment screenshot. Can I approve it here at the counter?'] },
];
it.skipIf(!live).each(cases)('real conversation remediation: $id', async item => {
  const started = performance.now();
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', { method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-DeskAtlas-Answer-Contract': 'ms59-v1',
      'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
      Authorization: `Bearer ${issueStaffAssistantSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
    body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: item.message, recent_context: { user_turns: item.history } }),
  }));
  const data = await response.json() as { data?: unknown };
  const parsed = assistantAnswerSchema.safeParse(data.data);
  const answer = parsed.success ? parsed.data : undefined;
  const main = answer?.synthesis?.main_blocks;
  const proof = answer?.evidence_spans?.map(span => span.quote).join('\n') ?? '';
  const text = main?.map(block => block.text).join('\n') ?? '';
  const useful = item.id === 'opening-preparation' ? /opening|open the|prepare|clean/i.test(proof) && answer?.answer_mode !== 'EVIDENCE_GAP' && answer?.answer_mode !== 'CLARIFICATION'
    : item.id === 'mixed-followup' ? /escalat/i.test(proof) && answer?.answer_mode !== 'CLARIFICATION'
    : item.id === 'property-safe-fallback' ? Boolean(!main && answer?.answer_mode === 'EXACT' && /ownership/i.test(proof) && /securely/i.test(proof))
      : item.id === 'concise-nohold' ? Boolean(main && /not|never|no /i.test(text) && !/booking qr|guest.first|first name/i.test(text))
        : Boolean(answer?.limitations.some(line => line.startsWith('NO_RELEVANT_SOURCE:')) && answer.answer_mode === 'EVIDENCE_GAP');
  const record = { case: item.id, status: response.status, valid: parsed.success, useful, mode: answer?.answer_mode,
    main_blocks: main?.length ?? 0, main_characters: text.length, elapsed_ms: Math.round(performance.now() - started),
    diagnostics: JSON.parse(response.headers.get('X-RAG-Diagnostics') || '{}'), timing: response.headers.get('server-timing') };
  const dir = 'services/rag/benchmark-results/conversation-remediation-2026-10-17';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${item.id}-${randomUUID()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
  expect(useful).toBe(true);
}, 60000);
