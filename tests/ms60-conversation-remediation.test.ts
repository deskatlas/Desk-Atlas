import { expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import { validateAssistantSynthesis, assistantSynthesisSupported } from '../packages/domain/src/services/assistantSynthesis';
import { assistantAnswerSchema, type AssistantCoverage } from '../packages/validation/src/assistantSchema';
import { AssistantAnswerText } from '../packages/ui/src/components/assistantPresentation';

// PRD-F26 / MS60-TC25/26: concise claims cannot hide unsafe/missing actions in proof.
const content = '# Lost property\n1. Record the item.\n2. Store the item securely.\n3. Verify ownership before return.';
const source = { document_id: randomUUID(), version_id: randomUUID(), chunk_id: randomUUID(), title: 'SOP', heading_path: 'Lost property',
  source_page: null, epoch: 1, extraction_method: 'TEXT', content_hash: createHash('sha256').update(content).digest('hex'), content };
const spans = [{ chunk_id: source.chunk_id, quote: content, start: 0, end: content.length }];
const coverage: AssistantCoverage = { scope: 'COMPLETE_PROCEDURE', outcome: 'COMPLETE', gaps: [] };
const candidate = () => ({ version: 'ms57-v1', ...coverage,
  blocks: [{ kind: 'text', text: content, support: [0] }],
  main_blocks: [
    { kind: 'step', text: 'Itala ang gamit.', support: [0], actions: [0] },
    { kind: 'step', text: 'Itago ito nang ligtas.', support: [0], actions: [1] },
    { kind: 'step', text: 'Tiyakin ang may-ari bago ibalik.', support: [0], actions: [2] },
  ],
});
it('admits mapped localized actions only with separate complete main-answer review', () => {
  const checked = validateAssistantSynthesis(candidate(), coverage, spans, [source]);
  expect(checked).toBeDefined();
  expect(assistantSynthesisSupported({ supported: [true, true, true], complete: true, consistent: true, evidence_safe: true }, checked!)).toBe(true);
  expect(assistantSynthesisSupported({ supported: [true], complete: true, consistent: true, evidence_safe: true }, checked!)).toBe(false);
  expect(assistantSynthesisSupported({ supported: [true, true, true], complete: false, consistent: true, evidence_safe: true }, checked!)).toBe(false);
});
it('rejects missing, reordered and fabricated procedure actions despite intact exact proof', () => {
  const value = candidate();
  for (const main_blocks of [value.main_blocks.slice(0, 2), [...value.main_blocks].reverse(),
    value.main_blocks.map((block, i) => i === 2 ? { ...block, actions: [99] } : block)]) {
    expect(validateAssistantSynthesis({ ...value, main_blocks }, coverage, spans, [source])).toBeUndefined();
  }
});
it('renders concise guidance in main view and keeps unchanged source in proof', () => {
  const synthesis = candidate();
  const { content: _content, ...citation } = source;
  const summary = synthesis.main_blocks.map(block => block.text).join('\n\n');
  const answer = assistantAnswerSchema.parse({ kind: 'DOCUMENT', summary, tables: [], citations: [citation], interpretation: [],
    as_of: new Date().toISOString(), limitations: [], knowledge_epoch: 1, request_id: randomUUID(), evidence_spans: spans,
    synthesis, answer_mode: 'SYNTHESIZED', synthesis_status: 'ACCEPTED' });
  const html = renderToStaticMarkup(React.createElement(AssistantAnswerText, { answer, text: summary }));
  expect(html.slice(0, html.indexOf('<details>'))).toContain('Itala ang gamit.');
  expect(html.slice(0, html.indexOf('<details>'))).not.toContain('Record the item.');
  expect(html).toContain('Record the item.');
  expect(html).toContain('Exact supporting evidence');
});
