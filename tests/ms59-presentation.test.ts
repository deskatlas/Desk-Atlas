import { expect, it, vi } from 'vitest';
vi.mock('react', async () => vi.importActual('../apps/admin-portal/node_modules/react'));
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';
import { exactAssistantPresentation } from '../packages/domain/src/services/assistantPresentation';
import { AssistantAnswerText } from '../packages/ui/src/components/assistantPresentation';
const id = '00000000-0000-4000-8000-000000000001';
function answer(quote: string) {
  const evidence_spans = [{ chunk_id: id, quote, start: 0, end: quote.length }];
  return assistantAnswerSchema.parse({ kind: 'DOCUMENT', summary: quote, tables: [], citations: [{ document_id: id, version_id: id, chunk_id: id, title: 'SOP', heading_path: '', source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64) }], as_of: '2026-10-16T00:00:00Z', knowledge_epoch: 1, request_id: id, interpretation: [], limitations: [], evidence_spans, presentation: exactAssistantPresentation(evidence_spans) });
}
it('MS59-TC05 renders six actual steps without numbering ancestor headings', () => {
  const data = answer('# SOP\n\n## Lost property\n\n1. Receive the item.\n\n2. Record details.\n\n3. Store securely.\n\n4. Verify ownership.\n\n5. Record release.\n\n6. Notify management.');
  const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: data.summary }));
  const main = html.split('<details>')[0];
  expect((main.match(/<li /g) ?? []).length).toBe(6);
  expect((main.match(/<ol /g) ?? []).length).toBe(1);
  expect(main).not.toMatch(/<li[^>]*>.*<h3/);
});
it('MS59-TC17 retains UTF-16, CRLF, repeated text and fenced literal numbers', () => {
  const data = answer('# 🚀\r\n\r\n1. Verify.\r\n\r\n2. Verify.\r\n\r\n```\r\n1. Example\r\n```');
  expect(data.presentation!.atoms.filter(a => a.kind === 'step')).toHaveLength(2);
  for (const atom of data.presentation!.atoms) expect(data.summary.slice(atom.start, atom.end).trim()).not.toBe('');
});
it('MS59-TC17 rejects dropped restrictions and unordered or wrong source slices', () => {
  const data = answer('1. Verify ownership.\n\nNever hand property to an unverified claimant.');
  const atoms = data.presentation!.atoms;
  for (const changed of [atoms.slice(0, 1), [...atoms].reverse(), [{ ...atoms[0], end: 9999 }], [{ ...atoms[0], evidence: 5 }]]) {
    expect(assistantAnswerSchema.safeParse({ ...data, presentation: { version: 'ms59-v1', atoms: changed } }).success).toBe(false);
  }
});

it('MS60-TC25 removes repeated navigation only when exact scope headings remain visible', () => {
  const data = answer('# Admin only\n\nAdmin only / Payment rules\n\n## Payment rules\n\nStaff must not approve online proofs.');
  data.citations[0].heading_path = 'Admin only / Payment rules';
  const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: data.summary }));
  const main = html.split('<details>')[0];
  expect(main).toContain('Admin only');
  expect(main).toContain('Payment rules');
  expect(main).toContain('Staff must not approve online proofs.');
  expect(main).not.toContain('Admin only / Payment rules');
  expect(html.split('<details>')[1]).toContain('Admin only / Payment rules');
});
it('QAD-TC44 synthesized navigation belongs in proof while role restrictions remain visible', () => {
  const data = answer('STANDARD OPERATING PROCEDURE (SOP)');
  data.citations[0].heading_path = 'STANDARD OPERATING PROCEDURE (SOP) / Shift Handover';
  const blocks = [
    { kind: 'text' as const, text: 'Pass on pending reservations and unresolved issues.', support: [0] },
    { kind: 'text' as const, text: 'STANDARD OPERATING PROCEDURE (SOP)\n\n# STANDARD OPERATING PROCEDURE (SOP)', support: [0] },
    { kind: 'text' as const, text: 'STANDARD OPERATING PROCEDURE (SOP)', support: [0] },
    { kind: 'text' as const, text: 'Admin only: approve online proofs.', support: [0] },
  ];
  data.presentation = undefined;
  data.synthesis = { version: 'ms57-v1', scope: 'FACTUAL', outcome: 'COMPLETE', gaps: [], blocks };
  data.summary = blocks.map(block => block.text).join('\n\n');
  const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: data.summary }));
  const main = html.split('<details>')[0];
  expect(main).not.toContain('STANDARD OPERATING PROCEDURE (SOP)');
  expect(main).toContain('Pass on pending');
  expect(main).toContain('Admin only');
  expect(html.split('<details>')[1]).toContain('STANDARD OPERATING PROCEDURE (SOP)');
});
