import { expect, it } from 'vitest';
import { assistantSearchQueries, selectBookingGuaranteeSeeds } from '../packages/domain/src/services/assistantHybridRetrieval';

// PRD-F26 / MS53/MS55 / QAD-TC44: semantic task normalization is not policy.
it.each([
  "They've chosen a desk. Is that enough to secure it?",
  'If I pick a seat, is it already reserved for me?',
  'Does selecting a spot guarantee the booking?',
  'I chose a workspace. Does that make it mine?',
])('preserves casual inventory-guarantee intent: %s', message => {
  const queries = assistantSearchQueries(message, undefined);
  expect(queries[0]).toBe(message);
  expect(queries.some(query => /reservation confirmation and inventory allocation/i.test(query))).toBe(true);
  expect(queries.every(query => query.startsWith(message))).toBe(true);
  expect(queries).toHaveLength(2);
  expect(queries.join()).not.toMatch(/never|only|no hold|must pay|payment confirmation/i);
});

it('selects the inventory witness and contrary rules, rather than a related verification checklist', () => {
  const message = 'I chose a workspace. Does that make it mine?';
  const sources = [
    { chunk_id: 'verification', content: 'Verify reservation details and payment status before modifying a booking.' },
    { chunk_id: 'inventory', content: 'No inventory holds: selecting a desk does not reserve inventory. Allocation occurs only on authorized payment confirmation.' },
    { chunk_id: 'contrary', content: 'Choosing a desk reserves it immediately.' },
    { chunk_id: 'reverse', content: 'Seats are held as soon as they are picked.' },
    { chunk_id: 'workflow', content: 'Inventory workflows: select a desk and submit the booking request for review.' },
  ];
  expect(selectBookingGuaranteeSeeds(message, sources)).toEqual(['inventory', 'contrary', 'reverse']);
  expect(selectBookingGuaranteeSeeds(message, sources.filter(source => source.chunk_id !== 'inventory'))).toBeUndefined();
  expect(selectBookingGuaranteeSeeds('How do I secure a desk to the floor?', sources)).toBeUndefined();
  expect(selectBookingGuaranteeSeeds('Does selecting a desk reserve it, and how do I cancel?', sources)).toBeUndefined();
});

it.each([
  'How do I secure a loose desk to the floor?',
  'Someone left a laptop on the desk. How do I secure it?',
  'I selected a chair. How do I fix its broken lock?',
  'How many desks are reserved right now?',
  'Does choosing this room guarantee privacy?',
  'I picked a loose desk. Is choosing it enough to secure its legs?',
])('does not invent booking-guarantee intent: %s', message => {
  expect(assistantSearchQueries(message, undefined)).toEqual([message]);
});

it('keeps the original and bounded normalization when generated search aids follow another topic', () => {
  const message = "They've chosen a desk. Is that enough to secure it?";
  const queries = assistantSearchQueries(message, { version: 'ms55-v1', original: message,
    topic: 'Reservation verification', standalone: 'What reservation details should staff check?',
    alternatives: ['Booking checks', 'Workspace booking'] });
  expect(queries).toHaveLength(4);
  expect(queries[1]).toContain('reservation confirmation and inventory allocation');
  expect(queries.every(query => query.startsWith(message))).toBe(true);
});

it.each([
  "Something in the workspace isn't working. What should I do?",
  'The equipment is out of order. How do I handle it?',
  'Our office printer is broken. Who should I tell?',
])('normalizes facility malfunction terminology without inventing repair guidance: %s', message => {
  const queries = assistantSearchQueries(message, undefined);
  expect(queries).toHaveLength(2);
  expect(queries[1]).toContain('Facility equipment malfunction and maintenance reporting');
  expect(queries.every(query => query.startsWith(message))).toBe(true);
  expect(queries.join()).not.toMatch(/must|should repair|turn off|disconnect/i);
});
