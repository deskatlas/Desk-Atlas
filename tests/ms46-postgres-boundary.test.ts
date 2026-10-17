import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { POST } from '../apps/admin-portal/src/app/api/internal/knowledge/jobs/[[...path]]/route';

// MS46-TC10: invoked by the disposable SQL driver. No application database.
const bridge = process.env.MS46_SQL_BRIDGE;
const fixture = vi.hoisted(() => ({ storage: new Set<string>(['source']) }));
async function rpc(name: string, args: unknown) {
  const response = await fetch(process.env.MS46_SQL_BRIDGE!, { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MS46_SQL_AUTHORITY}` }, body: JSON.stringify({ name, args }) });
  return response.json();
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc,
  from: () => ({ select: () => ({ eq: (_field: string, id: string) => ({ maybeSingle: () => rpc('fixture_job_kind', { id }) }) }) }),
  storage: { from: () => ({
    remove: async () => { fixture.storage.clear(); return { error: null }; },
    list: async () => ({ data: [...fixture.storage].map(name => ({ name })), error: null }),
  }) },
}) }));
afterEach(() => { vi.unstubAllEnvs(); });
it.skipIf(!bridge)('MS46 SQL -> actual gateway -> Python worker survives exhausted claims and fenced purges', async () => {
  const workerToken = 'synthetic-local-worker-authority-at-least-32-characters';
  vi.stubEnv('KB_WORKER_TOKEN', workerToken); vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('KB_SCOPE_ID', 'test');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-fixture-only');
  const server = createServer(async (incoming, outgoing) => {
    const parts: Buffer[] = [];
    for await (const part of incoming) parts.push(Buffer.from(part));
    const path = incoming.url!.split('/api/internal/knowledge/jobs/')[1].split('/');
    const response = await POST(new Request(`http://127.0.0.1${incoming.url}`, { method: 'POST',
      headers: { Authorization: incoming.headers.authorization ?? '' }, body: Buffer.concat(parts) }), { params: Promise.resolve({ path }) });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('FIXTURE_SERVER_UNAVAILABLE');
    const script = `import os,sys
sys.path.insert(0,'services/rag')
from knowledge.worker import Gateway,process_claim
gateway=Gateway(os.environ['MS46_GATEWAY'],os.environ['KB_WORKER_TOKEN'])
if os.environ.get('MS46_FINAL_PURGE')!='true':
 assert gateway.call('claim',{}) is None
claim=gateway.call('claim',{})
assert claim['job']['kind']=='PURGE'
process_claim(gateway,claim,None,'synthetic')
assert gateway.call('claim',{}) is None
print('BOUNDARY_PASSED')`;
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.env.MS46_PYTHON!, ['-c', script], {
        env: { ...process.env, MS46_GATEWAY: `http://127.0.0.1:${address.port}` }, windowsHide: true,
      });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      child.on('error', reject); child.on('exit', code => resolve({ code, output }));
    });
    expect(result).toEqual({ code: 0, output: expect.stringContaining('BOUNDARY_PASSED') });
  } finally { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }
}, 60000);
