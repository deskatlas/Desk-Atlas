// PRD-F26/F27 / QAD-TC44/46: anonymous local gateway timing, separate from UI acceptance.
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');

async function main() {
  const base = new URL(process.argv[2] || 'http://127.0.0.1:3011');
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('LOCAL_REPLAY_ONLY');
  const questions = process.env.RAG_AUDIT_QUESTIONS_FILE ? JSON.parse(readFileSync(process.env.RAG_AUDIT_QUESTIONS_FILE, 'utf8')) : [process.argv[3] || 'How do I make a reservation and pay for it?'];
  if (!Array.isArray(questions) || questions.some(question => typeof question !== 'string' || !question.trim())) throw Error('INVALID_AUDIT_QUESTIONS');
  const userTurns = process.env.RAG_AUDIT_CONTEXT_FILE ? JSON.parse(readFileSync(process.env.RAG_AUDIT_CONTEXT_FILE, 'utf8')).user_turns : [];
  const headers = { Origin: base.origin, 'Content-Type': 'application/json' };
  const bootstrap = await fetch(new URL('/api/customer-assistant/session', base), {
    method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(60000),
  });
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  if (!bootstrap.ok || !cookie) throw Error('CUSTOMER_SESSION_UNAVAILABLE');
  for (const question of questions) {
  const started = performance.now();
  const response = await fetch(new URL('/api/customer-assistant/query', base), {
    method: 'POST', headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ request_id: randomUUID(), session_id: randomUUID(), generation: randomUUID(),
      message: question, user_turns: userTurns }),
  });
  const answer = await response.json();
  const elapsed = Math.round(performance.now() - started);
  console.log(JSON.stringify({ local_gateway_probe: true, principal: 'PUBLIC_VISITOR', question,
    status: response.status, kind: answer.kind, citations: answer.citations?.length ?? 0,
    elapsed_ms: elapsed, summary: answer.summary, limitations: answer.limitations, error: answer.error,
    server_timing: response.headers.get('Server-Timing') }));
  if (!response.ok || answer.kind !== 'ANSWER' || !answer.citations?.length || elapsed >= Number(process.env.RAG_AUDIT_MAX_MS || 10000)) process.exitCode = 1;
  }
}
main().catch(() => { console.error('CUSTOMER_GATEWAY_REPLAY_FAILED'); process.exitCode = 2; });
