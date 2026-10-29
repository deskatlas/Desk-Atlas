import { describe, expect, it } from 'vitest';
import { currentOperationalPlan, executeAssistantTool, assistantTroubleshootingClarification } from '@deskatlas/domain';
import { validateDocumentSupport } from '../packages/domain/src/services/assistantDocumentSupport';
import { createHash, randomUUID } from 'node:crypto';

// PRD-F26 / SDD-C20/C22 / QAD-TC44/46: production browser regressions.
describe('admin conversational snapshot routing', () => {
  it('asks for the missing payment channel without blocking explicitly online questions', () => {
    expect(assistantTroubleshootingClarification("Someone says they paid, but their booking isn't confirmed. What should I do?")).toContain('pay online');
    expect(assistantTroubleshootingClarification("They paid online, but their booking isn't confirmed.")).toBeUndefined();
  });
  it.each([
    'How are things looking today? Anything I need to deal with?',
    'How many reservations and check-ins do we have today?',
    'How many bookings and current check-ins today?',
  ])('routes current metrics without model planning: %s', message => {
    expect(currentOperationalPlan(message)).toEqual({ kind: 'OPERATIONAL', query: '', tools: [{ name: 'operational_snapshot', args: { basis: 'scheduled', grouping: 'day' } }] });
  });
  it.each(['How many bookings today and how do I check in a guest?',
    'How are things looking today? Show revenue last month.',
    'How many reservations and cancellations today?',
    'How many bookings on floor 2 today?', 'How many reservations yesterday?'])('defers unsupported or mixed intent: %s', message => {
    expect(currentOperationalPlan(message)).toBeUndefined();
  });
  it('normalizes equivalent current-day filters before authorization, preserving genuine conflicts', async () => {
    const seen: unknown[] = [];
    const repository = { execute: async (...args: unknown[]) => { seen.push(args); return { tables: [], limitations: [], interpretation: [] }; } };
    const actor = { id: 'admin', role: 'ADMIN' as const };
    const asOf = '2026-10-29T04:00:00Z';
    await expect(executeAssistantTool(repository, actor, { name: 'operational_snapshot', args: { period: 'today', start_date: '2026-10-29', end_date: '2026-10-29' } }, 'Asia/Manila', asOf)).resolves.toBeDefined();
    expect(seen).toHaveLength(1);
    await expect(executeAssistantTool(repository, actor, { name: 'operational_snapshot', args: { period: 'today', start_date: '2026-10-28', end_date: '2026-10-29' } }, 'Asia/Manila', asOf)).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
});

it('rejects a QR meaning substitution at the gateway despite valid canonical citations', () => {
  const content = 'Payment and booking QRs serve different purposes. During the active booking window, the first eligible scan automatically checks in a confirmed booking.';
  const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(),
    title: 'SOP', heading_path: 'Access', source_page: null, epoch: 1, extraction_method: 'TEXT',
    content_hash: createHash('sha256').update(content).digest('hex'), content };
  const binding = 'a'.repeat(64);
  const result = { contract: 'ms65-v1', binding, outcome: 'COMPLETE', clarification: null,
    spans: [{ chunk_id: source.chunk_id, quote: content, start: 0, end: content.length }],
    synthesis: { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [],
      blocks: [{ kind: 'text', text: content, support: [0] }] }, counts: { bundles: 1, calls: 2, units: 1 } };
  expect(validateDocumentSupport(result, binding, [source])).toBeDefined();
  result.synthesis.blocks[0].text = 'A booking QR is not a check-in QR.';
  expect(validateDocumentSupport(result, binding, [source])).toBeUndefined();
});
