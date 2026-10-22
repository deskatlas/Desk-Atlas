import { expect, it } from 'vitest';
import { assistantLimitation } from '../packages/ui/src/components/assistantPresentation';

it('keeps reader incompatibility diagnostics out of ordinary recovery copy', () => {
  expect(assistantLimitation('MODEL_UNAVAILABLE: READER_INCOMPATIBLE: Ask an administrator to update the assistant.'))
    .toEqual({ text: 'Ask an administrator to update the assistant.', diagnostic: 'MODEL_UNAVAILABLE: READER_INCOMPATIBLE' });
});

it.each([
  'INCOMPLETE_EVIDENCE: OUTPUT_BUDGET_EXCEEDED: Verified output capacity exceeded.',
  'INCOMPLETE_EVIDENCE: SELECTION_EXHAUSTED: OUTPUT_BUDGET_EXCEEDED: Verified output capacity exceeded.',
])('MS60-TC24 nested output codes stay in diagnostics', line => {
  expect(assistantLimitation(line).text).toBe('Verified output capacity exceeded.');
  expect(assistantLimitation(line).diagnostic).toContain('OUTPUT_BUDGET_EXCEEDED');
});
