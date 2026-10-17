import { expect, it } from 'vitest';
import { assistantSearchQueries } from '../packages/domain/src/services/assistantHybridRetrieval';

it('MS60-TC16/17 prioritizes the current operational topic without replacing original conditions', () => {
  const original = 'May naiwan na wallet sa table. Ano gagawin ko?';
  const queries = assistantSearchQueries(original, { version: 'ms55-v1', original, topic: 'Lost and found property handling',
    standalone: 'What should staff do with a wallet left on a table?', alternatives: ['Handle a wallet left behind.'] });
  expect(queries[1]).toBe(original + '\nSearch interpretation: Lost and found property handling');
  expect(queries.every(q => q.includes(original))).toBe(true);
  expect(queries.length).toBeLessThanOrEqual(4);
});
