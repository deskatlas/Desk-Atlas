import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { assistantAnswerSchema, assistantPlanSchema } from '../packages/validation/src/assistantSchema';

// PRD-F26 / SDD-C20/C21 / QAD-TC44/46: read-only audit reproduction.
// Signed component capability is distinct from the normally authenticated browser.
const live = process.env.RAG_CURRENT_BROWSER_AUDIT === '1';
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
it.skipIf(!live)('private plan boundary diagnosis', async () => {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: actor, role: 'STAFF',
    request_id: randomUUID(), scope: process.env.RAG_SCOPE_ID, ops: ['answer', 'search'],
    iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
  const signature = createHmac('sha256', process.env.RAG_CAPABILITY_SECRET!).update(body).digest('base64url');
  const response = await fetch(new URL('/v1/plan', process.env.RAG_SERVICE_URL), { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RAG_SERVICE_TOKEN}`, 'X-Request-Capability': `${body}.${signature}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'They ignored me. Now what?', recent_context: { user_turns: ['The place is getting noisy. What should I do?'] },
      business_date: '2026-10-17', timezone: 'Asia/Manila', search_enabled: true }), signal: AbortSignal.timeout(55000) });
  const value: unknown = await response.json();
  const parsed = assistantPlanSchema.safeParse(value);
  const issuePaths = parsed.success ? [] : parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path.filter(part => typeof part === 'number' || ['kind', 'query', 'clarification', 'tools', 'args', 'name', 'floor_id', 'period', 'basis', 'grouping', 'metric', 'statuses', 'start_at', 'end_at', 'source'].includes(String(part))) }));
  const record = { private_plan_probe: true, status: response.status, valid: parsed.success, issues: issuePaths,
    kind: parsed.success ? parsed.data.kind : undefined,
    search_present: parsed.success && Boolean(parsed.data.search),
    query_noise: parsed.success && /noisy|noise/i.test(parsed.data.query),
    search_noise: parsed.success && /noisy|noise/i.test(JSON.stringify(parsed.data.search)),
    tool_count: parsed.success ? parsed.data.tools.length : undefined };
  mkdirSync('services/rag/benchmark-results/current-browser-fix-2026-10-17', { recursive: true });
  writeFileSync('services/rag/benchmark-results/current-browser-fix-2026-10-17/plan.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ private_plan_probe: true, status: response.status, valid: parsed.success, issues: issuePaths }));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
}, 60000);
const history = [
  "Hi, I'm helping out at the front desk today. Any advice?",
  'What should I do before people start arriving?',
  "A customer is upset. What's the best way to deal with it?",
];
const cases = [
  { id: 'broad-advice', message: history[0], history: [] },
  { id: 'opening', message: history[1], history: history.slice(0, 1) },
  { id: 'complaint-followup', message: "And if they still aren't happy?", history },
  { id: 'extension-context', message: 'Someone wants to stay longer. How does that work?', history: [...history, "And if they still aren't happy?"] },
  { id: 'extension-history-only', message: 'Someone wants to stay longer. How does that work?', history: [...history, "And if they still aren't happy?"] },
  { id: 'extension-fresh', message: 'Someone wants to stay longer. How does that work?', history: [] },
  { id: 'noise-followup', message: 'They ignored me. Now what?', history: ['Someone wants to stay longer. How does that work?', 'The place is getting noisy. What should I do?'] },
  { id: 'noise-minimal', message: 'They ignored me. Now what?', history: ['The place is getting noisy. What should I do?'] },
  { id: 'complaint-initial', message: history[2], history: history.slice(0, 2) },
  { id: 'property-context', message: 'Somebody forgot their stuff here. What now?', history: [history[1], history[2], "And if they still aren't happy?", 'Someone wants to stay longer. How does that work?'] },
  { id: 'closing-ambiguous', message: "I'm about to finish for the day. Anything I should remember?", history: ['Somebody forgot their stuff here. What now?'] },
  { id: 'closing-resolved', message: "We're closing for the night.", history: ["I'm about to finish for the day. Anything I should remember?"] },
  { id: 'noise-initial', message: 'The place is getting noisy. What should I do?', history: ['Someone wants to stay longer. How does that work?'] },
  { id: 'broad-new', message: 'Any tips for my first shift?', history: [] },
  { id: 'noise-new', message: "I asked them to lower their voices but they're carrying on. What next?", history: ['The place is getting noisy. What should I do?'] },
  { id: 'data-control', message: 'How many reservations today?', history: ['The place is getting noisy. What should I do?'] },
];
it.skipIf(!live).each(cases)('current browser audit: $id', async item => {
  const started = performance.now();
  const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
      'X-DeskAtlas-Answer-Contract': 'ms59-v1', 'X-DeskAtlas-Main-Answer-Contract': 'ms60-v1',
      Authorization: `Bearer ${issueStaffAssistantSession(actor, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
    body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message: item.message, recent_context: {
      user_turns: item.history,
      ...(item.id === 'extension-context' ? { selections: { name: 'operational_snapshot', args: {} } } : {}),
    } }),
  }));
  const envelope = await response.json() as { data?: unknown };
  const parsed = assistantAnswerSchema.safeParse(envelope.data);
  const answer = parsed.success ? parsed.data : undefined;
  const proof = answer?.evidence_spans?.map(span => span.quote).join('\n') || '';
  const main = answer?.synthesis?.main_blocks?.map(block => block.text).join('\n')
    || answer?.synthesis?.blocks.map(block => block.text).join('\n') || proof;
  const noTools = !(answer?.tables?.length);
  const openingDuties = proof.split('\n').flatMap(line => /^\s*\d+[.)]\s+(.+)$/.exec(line)?.[1] ?? []);
  let dutyCursor = 0;
  const completeOpening = openingDuties.length >= (item.id === 'closing-resolved' ? 10 : 11) && openingDuties.every(duty => {
    const position = main.indexOf(duty, dutyCursor);
    if (position < 0) return false;
    dutyCursor = position + duty.length;
    return true;
  });
  const useful = ['broad-advice', 'broad-new'].includes(item.id)
    ? answer?.answer_mode === 'CLARIFICATION' || /courteous|professional|concern|complaint/i.test(main)
    : ['opening', 'closing-resolved'].includes(item.id) ? completeOpening
      : item.id === 'closing-ambiguous' ? answer?.answer_mode === 'CLARIFICATION' && /shift/i.test(answer.summary) && /closing/i.test(answer.summary)
      : item.id === 'property-context' ? /ownership/i.test(main) && /secur/i.test(main) && /record/i.test(main)
      : item.id === 'data-control' ? !noTools && answer?.kind === 'OPERATIONAL'
      : ['complaint-followup', 'complaint-initial', 'noise-followup', 'noise-minimal', 'noise-initial', 'noise-new'].includes(item.id) ? noTools && /supervisor|manager|escalat/i.test(main)
        : noTools && /verify.*reservation/i.test(main) && /availability/i.test(main)
          && /approved polic/i.test(main) && /record.*change/i.test(main) && /fees|limitations/i.test(main)
          && !['EVIDENCE_GAP', 'FAILURE'].includes(answer?.answer_mode || '');
  const record = { case: item.id, component_probe: true, status: response.status, valid: parsed.success,
    kind: answer?.kind, mode: answer?.answer_mode, scope: answer?.synthesis?.scope,
    useful, no_tools: noTools,
    main_block_count: answer?.synthesis?.main_blocks?.length,
    elapsed_ms: Math.round(performance.now() - started),
    proof_has_full_opening: /reservation/i.test(proof) && /supplies/i.test(proof),
    main_has_full_opening: /reservation/i.test(main) && /supplies/i.test(main),
    diagnostics: JSON.parse(response.headers.get('X-RAG-Diagnostics') || '{}') as unknown,
    timing: response.headers.get('server-timing') };
  const directory = 'services/rag/benchmark-results/current-browser-fix-2026-10-17';
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${item.id}-${randomUUID()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  expect(response.status).toBe(200);
  expect(parsed.success).toBe(true);
  if (item.id !== 'data-control') expect(noTools).toBe(true);
  expect(useful).toBe(true);
}, 60000);
