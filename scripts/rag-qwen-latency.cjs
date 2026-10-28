// PRD-F26/F27 / QAD-TC44/46: normal public HTTP, current sources, real quotas.
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const base = new URL(process.argv[2] || 'http://127.0.0.1:3011');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('LOCAL_BENCHMARK_ONLY');
if (['--booking-only', '--deadline-only', '--additional'].filter(flag => process.argv.includes(flag)).length > 1) throw Error('INVALID_BENCHMARK_MODE');
const cases = [
  { message: 'How do I book a workspace online?', checks: [/does not hold|do not hold|not hold|no inventory hold|not reserve|not held|does not secure|doesn't secure/i, /60.minute|one.hour/i, /admin/i] },
  { message: 'Do I need to create an account first?', checks: [/no (?:customer )?account|not required|without.*account|do not need|not need|guest/i] },
  { message: 'How long do I have to upload payment proof?', checks: [/60.minute|one.hour/i] },
];
if (process.argv.includes('--additional')) cases.splice(0, cases.length,
  { message: 'If someone submits a request and gets a queue number, is that workspace already secured?',
    checks: [/does not (?:hold|secure)|not (?:reserved|secured|confirmed)|no.*hold|not.*guarantee|only.*confirm/i] },
  { message: 'Can a first-time visitor book without a Unique Customer ID?',
    checks: [/optional|not required|without|leave.*blank|do not need|not need/i] });
if (process.argv.includes('--booking-only')) cases.splice(1);
const initialHistory = process.argv.includes('--deadline-only') ? cases.slice(0, 2).map(item => item.message) : [];
if (process.argv.includes('--deadline-only')) cases.splice(0, 2);

async function main() {
  let ingress;
  let target = base;
  if (process.argv.includes('--production-proxy')) {
    // Isolated loopback ingress overwrites client IP from its real socket.
    // Never invent or rotate IPs to obtain additional public quota.
    ingress = http.createServer((request, response) => {
      const upstream = http.request(new URL(request.url, base), { method: request.method,
        headers: { ...request.headers, host: base.host, origin: base.origin,
          'x-real-ip': request.socket.remoteAddress } }, result => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.on('error', () => { response.writeHead(502); response.end(); });
      request.pipe(upstream);
    });
    await new Promise(done => ingress.listen(0, '127.0.0.1', done));
    target = new URL(`http://127.0.0.1:${ingress.address().port}`);
  }
  try {
  const start = performance.now();
  const session = await fetch(new URL('/api/customer-assistant/session', target), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.origin }, body: '{}',
  });
  if (!session.ok) throw Error(`SESSION_FAILED_${session.status}`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw Error('SESSION_COOKIE_REQUIRED');
  console.log(JSON.stringify({ stage: 'session', elapsed_ms: Math.round(performance.now() - start) }));
  const sessionId = randomUUID(), history = [...initialHistory], results = [];
  for (const item of cases) {
    const began = performance.now();
    const response = await fetch(new URL('/api/customer-assistant/query', target), {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie, Origin: base.origin },
      body: JSON.stringify({ message: item.message, request_id: randomUUID(), session_id: sessionId,
        generation: randomUUID(), user_turns: history.slice(-4) }), signal: AbortSignal.timeout(60000),
    });
    const answer = await response.json();
    const elapsed = Math.round(performance.now() - began);
    const text = answer.summary || '';
    const useful = response.ok && answer.kind === 'ANSWER' && answer.citations?.length > 0
      && item.checks.every(check => check.test(text));
    const row = { question: item.message, status: response.status, kind: answer.kind,
      error: answer.error,
      server_timing: response.headers.get('Server-Timing'),
      elapsed_ms: elapsed, citations: answer.citations?.length || 0, useful: Boolean(useful),
      within_10s: useful && elapsed < 10000, within_15s: useful && elapsed < 15000, summary: text };
    results.push(row);
    console.log(JSON.stringify(row));
    history.push(item.message);
    if (!response.ok) break; // Respect quotas and failed admission; never rotate identity.
  }
  // This small smoke run deliberately makes no p95 or independent-quality claim.
  process.exitCode = results.length === cases.length && results.every(row => row.within_15s) ? 0 : 1;
  } finally {
    if (ingress) ingress.close();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'QWEN_LATENCY_FAILED'); process.exitCode = 2; });
