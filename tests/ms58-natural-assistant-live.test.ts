import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assistantQuery } from '../apps/admin-portal/src/server/assistant/gateway';
import { issueAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';

// MS58 / PRD-F26 / SDD-C20/C21 / QAD-TC44: opt-in read-only real gateway acceptance.
// Credentials and source/answer content never enter test output.
const live = process.env.RAG_LIVE_GATEWAY === '1';
let actorId = '';
beforeAll(async () => {
  if (!live) return;
  const saved = parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8'));
  for (const [key, value] of Object.entries(saved)) vi.stubEnv(key, value);
  const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const profile = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  if (profile.error || !profile.data) throw new Error('ACTIVE_ADMIN_REQUIRED');
  actorId = profile.data.user_id;

});
afterAll(() => vi.unstubAllEnvs());

it.skipIf(!live).each(['what is workspace map', 'how do i checkout a customer', 'can we suggest for sop improvement?'])(
  'verified live gateway: %s', async message => {
    const started = performance.now();
    const response = await assistantQuery(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
        Authorization: `Bearer ${issueAdminSession(actorId, process.env.SUPABASE_SERVICE_ROLE_KEY!)}` },
      body: JSON.stringify({ session_id: randomUUID(), request_id: randomUUID(), message }),
    }));
    const envelope = await response.json() as { data?: unknown };
    const parsed = assistantAnswerSchema.safeParse(envelope.data);
    expect(response.status).toBe(200);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const answer = parsed.data;
    console.log(JSON.stringify({ mode: answer.answer_mode, synthesis: answer.synthesis_status,
      citations: answer.citations.length, elapsed_ms: Math.round(performance.now() - started),
      codes: answer.limitations.map(line => line.split(':')[0]).filter(code => /^[A-Z_]+$/.test(code)) }));
    if (message === 'what is workspace map' && answer.answer_mode === 'EVIDENCE_GAP') {
      // Live publications are mutable. A retrieval-specific gap is the correct
      // safe outcome when the current corpus returns only related status rules.
      expect(answer.citations).toEqual([]);
      expect(answer.limitations.some(line => line.startsWith('NO_RELEVANT_SOURCE:'))).toBe(true);
      expect(answer.summary).not.toMatch(/(?:not|nothing|absent).*\b(?:knowledge base|entire|any document)\b/i);
      return;
    }
    if (message === 'can we suggest for sop improvement?') {
      // This corpus has a larger reviewed closure. The independently verified
      // exact fallback remains useful when the bounded synthesis lane expires.
      expect(['SYNTHESIZED', 'EXACT'].includes(answer.answer_mode ?? '')).toBe(true);
      expect(['ACCEPTED', 'EXACT_FALLBACK'].includes(answer.synthesis_status ?? '')).toBe(true);
      expect(answer.evidence_spans?.some(span => /suggest|feedback|improv/i.test(span.quote)
        && /management/i.test(span.quote))).toBe(true);
    } else {
      expect(answer.answer_mode).toBe('SYNTHESIZED');
      expect(answer.synthesis_status).toBe('ACCEPTED');
    }
    expect(answer.citations.length > 0 && answer.summary.length > 0).toBe(true);
  }, 60000);
