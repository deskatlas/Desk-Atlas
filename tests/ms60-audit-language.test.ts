import { expect, it } from 'vitest';
import { assistantLanguage } from '../packages/domain/src/services/assistantLanguage';

// QAD-TC44 / MS60: sentence cues, including English loanwords and ambiguous May.
it.each([
  ['May naiwan na bag sa upuan. Saan ko ilalagay?', 'tl'],
  ['Naiwan niya ang wallet dito. Anong gagawin?', 'tl'],
  ['Pakisabi kung saan ilalagay ang gamit.', 'tl'],
  ['Paano ko i-check ang payment?', 'taglish'],
  ['May I approve an online payment?', 'en'],
  ['The booking is in May. Can staff approve it?', 'en'],
  ['Someone left a bag. Where should I put it?', 'en'],
])('detects the operational sentence language: %s', (message, expected) => {
  expect(assistantLanguage(message)).toBe(expected);
});
