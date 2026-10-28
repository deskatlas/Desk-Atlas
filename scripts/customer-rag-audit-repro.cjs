// PRD-F1-F4/F26 / MS77-TC05/08 / QAD-TC44/46: read-only local symptom probe.
const { randomUUID } = require('node:crypto');
const base = new URL(process.argv[2] || 'http://localhost:3001');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('LOCAL_AUDIT_ONLY');
async function main() {
  const session = await fetch(new URL('/api/customer-assistant/session', base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!session.ok) throw new Error(`SESSION_${session.status}`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('NO_VISITOR_COOKIE');
  const started = performance.now();
  const result = await fetch(new URL('/api/customer-assistant/query', base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ conversation_contract: 'constraints-v1', message: 'i need a desk for 7am, any availability on focus pod today?',
      request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(), user_turns: [] }),
    signal: AbortSignal.timeout(60000),
  });
  const answer = await result.json();
  const symptom = /narrow by workspace type|exact labels on the workspace map/i.test(answer.summary || '');
  const useful = result.ok && answer.kind === 'CLARIFY' && /duration|how long/i.test(answer.summary || '')
    && answer.discovery?.start_time === '07:00' && Boolean(answer.discovery?.date && answer.discovery?.template_id);
  console.log(JSON.stringify({ status: result.status, kind: answer.kind, summary: answer.summary,
    error: answer.error, elapsed_ms: Math.round(performance.now() - started),
    symptom_reproduced: symptom, useful, discovery: answer.discovery, server_timing: result.headers.get('server-timing') }));
  // An environmental failure is inconclusive, never a passing result.
  process.exitCode = !result.ok ? 2 : useful ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 2; });
