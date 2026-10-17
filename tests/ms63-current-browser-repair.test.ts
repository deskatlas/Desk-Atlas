import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { AdminSessionLifecycle } from '../apps/admin-portal/src/features/auth/sessionLifecycle';
import { issueStaffAssistantSession } from '../apps/admin-portal/src/server/assistant/session';
import { validateAssistantSynthesis } from '../packages/domain/src/services/assistantSynthesis';
import { assistantContextualQuestion } from '../packages/domain/src/services/assistantService';
import { assistantSearchQueries } from '../packages/domain/src/services/assistantHybridRetrieval';

// PRD-F13/F26 / SDD-C20/C21 / QAD-TC23/44/46: real expiry and main-answer seams.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
  maybeSingle: async () => ({ data: { role: 'STAFF', is_active: true }, error: null }),
}) }) }) }) }));
import { GET } from '../apps/staff-dashboard/src/app/api/auth/session/route';
afterEach(() => vi.unstubAllEnvs());

it('staff heartbeat rejects an expired signed credential despite a stored user ID', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-staff-audit-key');
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
  const token = issueStaffAssistantSession(randomUUID(), process.env.SUPABASE_SERVICE_ROLE_KEY!, Date.now() - 3600001);
  const response = await GET(new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}`, 'x-user-id': randomUUID() } }));
  expect(response.status).toBe(401);
});

it('staff heartbeat verifies the same signed credential as the assistant', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-staff-audit-key');
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
  const id = randomUUID();
  const token = issueStaffAssistantSession(id, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const response = await GET(new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ active: true, user: { id, role: 'staff' } });
});

it('staff restoration withholds the dashboard until its assistant credential is verified', async () => {
  let resolve!: (value: Response) => void;
  const transport = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  const persist = vi.fn();
  const lifecycle = new AdminSessionLifecycle(transport, persist, {
    endpoint: '/api/auth/session', roles: ['staff', 'admin'], credential: user => user.assistantToken ?? user.token,
  });
  const restoring = lifecycle.restore(JSON.stringify({ id: 'staff', role: 'staff', token: 'legacy', assistantToken: 'signed' }));
  expect(lifecycle.snapshot().user).toBeNull();
  expect(lifecycle.snapshot().loading).toBe(true);
  expect(transport).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ headers: { Authorization: 'Bearer signed' } }));
  resolve(Response.json({ active: true, user: { id: 'staff', role: 'staff' } }));
  await restoring;
  expect(lifecycle.snapshot().user?.assistantToken).toBe('signed');
  lifecycle.logout();
  expect(lifecycle.snapshot().user).toBeNull();
});

it('a factual label cannot permit missing numbered duties in procedural main guidance', () => {
  const content = '1. Prepare reception.\n2. Check reservations.\n3. Check supplies.';
  const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'SOP', heading_path: 'Opening',
    source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content };
  const spans = [{ chunk_id: source.chunk_id, quote: content, start: 0, end: content.length }];
  const coverage = { scope: 'FACTUAL' as const, outcome: 'COMPLETE' as const, gaps: [] };
  const candidate = { version: 'ms57-v1', ...coverage, blocks: [{ kind: 'text', text: content, support: [0] }],
    main_blocks: [{ kind: 'bullet', text: 'Prepare reception.', support: [0], actions: [] }] };
  expect(validateAssistantSynthesis(candidate, coverage, spans, [source], 'What should I do before people start arriving?')).toBeUndefined();
});

it('a new named task never inherits a previous task during final verification', () => {
  expect(assistantContextualQuestion('Someone wants to stay longer. How does that work?', 'A customer is upset.')).toBe('Someone wants to stay longer. How does that work?');
  expect(assistantContextualQuestion('They ignored me. Now what?', 'The place is getting noisy.')).toContain('Previous user question');
});

it('a short follow-up retrieves its process while retaining the authoritative current wording', () => {
  const message = 'They ignored me. Now what?';
  const queries = assistantSearchQueries(message, { version: 'ms55-v1', original: message,
    standalone: `${message}\nPrevious user question: The place is getting noisy.`, alternatives: [] });
  expect(queries[0]).toBe(message);
  expect(queries.some(query => /Noise control/.test(query))).toBe(true);
  expect(queries.every(query => query.startsWith(message))).toBe(true);
  expect(queries.join()).not.toMatch(/must|only|escalate|supervisor/);
});
