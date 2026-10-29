// PRD-F26 / SDD-C20-C24 / QAD-TC44/46: loopback-only real-provider acceptance.
// One visitor, real admission, sequential requests. No credentials or private data.
const { randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const base = new URL('http://127.0.0.1:3013');
const output = process.argv[2];
if (!output) throw Error('OUTPUT_REQUIRED');
const baseline = JSON.parse(readFileSync('outputs/customer-rag-response-timing-2026-10-29/browser-timings.json', 'utf8'));
const rows = [], history = [], sessionId = randomUUID(), generation = randomUUID();
mkdirSync(dirname(output), { recursive: true });
function save() {
  writeFileSync(output, JSON.stringify({ measurement: 'complete_http_not_browser_render',
    baseline_measurement: 'browser_completion', comparison_limit: 'Different environments; HTTP cannot establish browser acceptance.',
    rows }, null, 2));
}
async function main() {
  const headers = { Origin: base.origin, 'Content-Type': 'application/json' };
  const session = await fetch(new URL('/api/customer-assistant/session', base), { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(10000) });
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!session.ok || !cookie) throw Error('SESSION_UNAVAILABLE');
  for (const [index, item] of baseline.rows.entries()) {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const result = await fetch(new URL('/api/customer-assistant/query', base), { method: 'POST',
      headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ request_id: randomUUID(), session_id: sessionId, generation,
        conversation_contract: 'constraints-v1', message: item.question, user_turns: history.slice(-4) }),
    });
    const answer = await result.json();
    const row = { case: index + 1, question: item.question, started_at: startedAt,
      elapsed_ms: Math.round(performance.now() - start), baseline_browser_ms: item.elapsed_ms,
      status: result.status, kind: answer.kind, summary: answer.summary, error: answer.error,
      citations: answer.citations?.length ?? 0, limitations: answer.limitations,
      server_timing: result.headers.get('Server-Timing'), useful: result.ok && answer.kind === 'ANSWER' && Boolean(answer.summary?.trim()) };
    // A catalog overview legitimately uses current typed map facts, not document citations.
    if (index !== 1 && !row.citations) row.useful = false;
    if (index === 7 && (!/kiosk|walk.in/i.test(row.summary || '') || /60.minute|private.*link|cancell|refund/i.test(row.summary || ''))) row.useful = false;
    if (index === 2 && /Sky Booth\s*\(two people\)|Sky Booth:\s*2 people/i.test(row.summary || '')) row.useful = false;
    rows.push(row); save();
    console.log(JSON.stringify({ case: row.case, status: row.status, kind: row.kind, elapsed_ms: row.elapsed_ms, useful: row.useful }), '\n');
    if (!result.ok) break; // Respect quota/identity failures. Never rotate or bypass admission.
    history.push(item.question);
    if (index + 1 < baseline.rows.length) await new Promise(resolve => setTimeout(resolve, 65000));
  }
  process.exitCode = rows.length === baseline.rows.length && rows.every(row => row.useful) ? 0 : 1;
}
main().catch(() => { save(); console.error('LOCAL_ACCEPTANCE_FAILED'); process.exitCode = 2; });
