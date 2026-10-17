import { expect, it, vi } from 'vitest';
vi.mock('react', async () => vi.importActual('../apps/admin-portal/node_modules/react'));
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import { assistantAnswerSchema } from '../packages/validation/src/assistantSchema';
import { exactAssistantPresentation, exactAssistantMainAtoms } from '../packages/domain/src/services/assistantPresentation';
import { AssistantAnswerText } from '../packages/ui/src/components/assistantPresentation';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(quote: string, heading_path = 'SOP / Noise') {
  const evidence_spans = [{ chunk_id: id, quote, start: 7, end: 7 + quote.length }];
  return assistantAnswerSchema.parse({ kind: 'DOCUMENT', summary: quote, tables: [],
    citations: [{ document_id: id, version_id: id, chunk_id: id, title: 'SOP', heading_path,
      source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: 'a'.repeat(64) }],
    as_of: '2026-10-17T00:00:00Z', request_id: id, knowledge_epoch: 1, interpretation: [], limitations: [],
    evidence_spans, presentation: exactAssistantPresentation(evidence_spans), answer_mode: 'EXACT' });
}
const render = (data: ReturnType<typeof fixture>) => renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer: data, text: data.summary }));

it('MS62-TC01/02 removes only redundant leading labels; noise escalation and full proof survive', () => {
  const data = fixture('SOP\n# SOP\n# SOP\nSOP / Noise\n## Noise\n1. Remind the guest.\n2. Escalate repeated noise to the supervisor.');
  const before = JSON.stringify(data);
  const projection = exactAssistantMainAtoms(data.evidence_spans!, data.presentation!.atoms, data.citations);
  expect(projection.omitted).toBe(3);
  expect(projection.status).toBe('STRUCTURAL_ONLY');
  const [main, proof] = render(data).split('<details>');
  expect(main.match(/>SOP</g)).toHaveLength(1);
  expect(main).not.toContain('SOP / Noise');
  expect(main).toContain('Escalate repeated noise to the supervisor.');
  expect(proof).toContain('SOP / Noise');
  expect(JSON.stringify(data)).toBe(before);
  for (const atom of projection.atoms) expect(data.evidence_spans![atom.evidence].quote.slice(atom.start, atom.end)).not.toBe('');
});

it('MS62-TC03/04 preserves repeated scope headings, staged actions and prose conditions', () => {
  const quote = '# Staff only\n1. Verify ownership.\nBefore release, contact the supervisor.\n# Staff only\n2. Verify ownership.\nNever release without verification.';
  const data = fixture(quote, 'Staff only');
  const main = render(data).split('<details>')[0];
  expect(main.match(/>Staff only</g)).toHaveLength(2);
  expect(main.match(/Verify ownership\./g)).toHaveLength(2);
  expect(main).toContain('Before release, contact the supervisor.');
  expect(main).toContain('Never release without verification.');
  expect(main.indexOf('Before release')).toBeLessThan(main.indexOf('value="2"'));
});

it('MS62-TC02/03 retains unreviewed equivalent FAQ/body and distinct qualifications', () => {
  const data = fixture('# Noise\n1. Escalate repeated noise.\n## FAQ\nEscalate repeated noise.\nAfter a warning, notify management.');
  const projection = exactAssistantMainAtoms(data.evidence_spans!, data.presentation!.atoms, data.citations);
  expect(projection.status).toBe('ORIGINAL_EXACT');
  const main = render(data).split('<details>')[0];
  expect(main.match(/Escalate repeated noise\./g)).toHaveLength(2);
  expect(main).toContain('After a warning, notify management.');
});

it('MS62-TC03 heading names in another source or a later stage cannot prove navigation', () => {
  const data = fixture('SOP / Noise\nRecord the complaint.\n# SOP\n## Noise');
  const projection = exactAssistantMainAtoms(data.evidence_spans!, data.presentation!.atoms, data.citations);
  expect(projection.omitted).toBe(0);
  expect(render(data).split('<details>')[0]).toContain('SOP / Noise');
});

it('MS62-TC04 retains fenced literals, CRLF and UTF-16 source mappings', () => {
  const data = fixture('# SOP\r\n```\r\nSOP\r\n1. 🚀 Example\r\n```\r\n1. Store securely.\r\n2. Verify ownership.');
  const projection = exactAssistantMainAtoms(data.evidence_spans!, data.presentation!.atoms, data.citations);
  expect(projection.omitted).toBe(0);
  const main = render(data).split('<details>')[0];
  expect(main).toContain('🚀 Example');
  expect(main.match(/<li /g)).toHaveLength(2);
  expect(main).toContain('data-source-start="7"');
});

it('MS62-TC03 indented literal titles do not qualify for navigation suppression', () => {
  const data = fixture('    SOP\n# SOP\n1. Store securely.');
  expect(exactAssistantMainAtoms(data.evidence_spans!, data.presentation!.atoms, data.citations).omitted).toBe(0);
});

it('MS62-TC06 preserves exact decisions, negation and missing-amount statements', () => {
  for (const quote of ['Selecting a desk never holds inventory.', 'Only administrators may approve online payment proofs.', 'The refund amount is not specified.']) {
    const data = fixture(quote);
    expect(render(data).split('<details>')[0]).toContain(quote);
  }
});

it('MS62-TC07/08 keeps proof disclosure and legacy rendering with identical source text', () => {
  const data = fixture('# Lost property\n1. Store securely.\n2. Verify ownership before release.');
  expect(render(data)).toContain('<details><summary>Exact supporting evidence</summary>');
  data.presentation = undefined;
  const html = render(data);
  expect(html).toContain('Store securely.');
  expect(html).toContain('Verify ownership before release.');
});
