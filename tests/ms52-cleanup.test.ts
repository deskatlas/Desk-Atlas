import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../apps/admin-portal/src/app/api/internal/knowledge/jobs/[[...path]]/route';
const fixture = vi.hoisted(() => ({
  targets: {} as Record<string, unknown>, calls: [] as string[],
  remove: vi.fn(), list: vi.fn(), complete: {} as Record<string, unknown>,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: async (_name: string, args: { p_operation?: string; p_data?: Record<string, unknown> }) => {
    fixture.calls.push(args.p_operation ?? 'reconcile');
    if (args.p_operation === 'purge_targets') return { data: fixture.targets, error: null };
    if (args.p_operation === 'complete') fixture.complete = args.p_data ?? {};
    return { data: null, error: null };
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { kind: 'PURGE' }, error: null }) }) }) }),
  storage: { from: () => ({ remove: fixture.remove, list: fixture.list }) },
}) }));
const id = '00000000-0000-4000-8000-000000000001';
const key = `${id}/${id}/source`;
async function complete() {
  return POST(new Request('http://localhost/api/internal/knowledge/jobs', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-worker-token-at-least-32-characters' },
    body: JSON.stringify({ lease_token: id, generation: 1 }),
  }), { params: Promise.resolve({ path: [id, 'complete'] }) });
}
beforeEach(() => {
  vi.stubEnv('KB_ENABLED', 'true'); vi.stubEnv('KB_SCOPE_ID', 'test');
  vi.stubEnv('KB_WORKER_TOKEN', 'synthetic-worker-token-at-least-32-characters');
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-only');
  fixture.calls = []; fixture.complete = {};
  fixture.targets = { source_object_key: key, preview_object_key: `${id}/${id}/preview` };
  fixture.remove.mockReset().mockResolvedValue({ error: null });
  fixture.list.mockReset().mockResolvedValue({ data: [], error: null });
});
it('MS52-TC03: deferred authorization does no storage work and does not finalize', async () => {
  fixture.targets = { deferred: true, status: 'WAITING_UPLOAD' };
  expect((await complete()).status).toBe(200);
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(fixture.calls).toEqual(['purge_targets']);
});
it('MS52-TC01/12: batches deduplicated keys and verifies a directory once', async () => {
  expect((await complete()).status).toBe(200);
  expect(fixture.remove).toHaveBeenCalledTimes(1);
  expect(fixture.list).toHaveBeenCalledTimes(1);
  expect(fixture.complete.storage_verified).toBe(true);
  fixture.targets.preview_object_key = key;
  await complete();
  expect(fixture.remove).toHaveBeenLastCalledWith([key]);
});
it.each(['present', 'truncated', 'error', 'remove-error', 'throw'])('MS52-TC05/06: %s verification stays retryable', async mode => {
  if (mode === 'present') fixture.list.mockResolvedValue({ data: [{ name: 'source' }], error: null });
  if (mode === 'truncated') fixture.list.mockResolvedValue({ data: Array.from({ length: 100 }, (_, i) => ({ name: `other-${i}` })), error: null });
  if (mode === 'error') fixture.list.mockResolvedValue({ data: null, error: { message: 'synthetic' } });
  if (mode === 'remove-error') fixture.remove.mockResolvedValue({ error: { message: 'synthetic' } });
  if (mode === 'throw') fixture.remove.mockRejectedValue(new Error('synthetic timeout'));
  expect((await complete()).status).toBe(200);
  expect(fixture.complete).toMatchObject({ error_code: 'STORAGE_FAILED', retryable: true });
  expect(fixture.complete).not.toHaveProperty('storage_verified');
});

it('MS52-TC02/11: standalone cleanup forwards no parser or answer settings', () => {
  const launcher = createRequire(import.meta.url)('../scripts/rag-start.cjs') as {
    runtimeEnvironment(mode: string, saved: Record<string, string>, inherited: Record<string, string>, answer: Record<string, string>): Record<string, string>;
    runtimeCommand(mode: string, env: Record<string, string>, directory: string): string[];
  };
  const env = launcher.runtimeEnvironment('purge', {
    KB_ENABLED: 'true', KB_WORKER_TOKEN: 'synthetic-worker-token-at-least-32-characters',
    KB_PARSER_IMAGE: 'not-needed', RAG_SERVICE_TOKEN: 'not-needed', KB_WORKER_MODE: 'ingest',
  }, {}, {});
  expect(env.KB_WORKER_MODE).toBe('purge');
  expect(env).not.toHaveProperty('KB_PARSER_IMAGE');
  expect(env).not.toHaveProperty('RAG_SERVICE_TOKEN');
  expect(launcher.runtimeCommand('purge', env, 'unused')).toEqual(['-m', 'knowledge.worker']);
});

it('MS52-TC02: purge-only claims skip ingestion reconciliation and reject unknown kinds', async () => {
  vi.stubEnv('KB_UPLOAD_EXPIRY_SECONDS', 'not-an-ingestion-setting');
  try {
    const claim = (kind: string) => POST(new Request('http://localhost/api/internal/knowledge/jobs/claim', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-worker-token-at-least-32-characters' },
      body: JSON.stringify({ kind }),
    }), { params: Promise.resolve({ path: ['claim'] }) });
    expect((await claim('PURGE')).status).toBe(200);
    expect(fixture.calls).toEqual(['claim']);
    expect((await claim('UNKNOWN')).status).toBe(400);
    expect(fixture.remove).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});
