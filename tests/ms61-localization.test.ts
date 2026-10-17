import { expect, it } from 'vitest';
import { assistantLanguage, assistantSynthesisLanguageAdmitted } from '../packages/domain/src/services/assistantLanguage';

// MS61-TC02/03/06: intent selection is distinct from language correctness.
it.each([
  ['Explain the lost-property procedure in Tagalog.', 'tl'],
  ['Please answer in Filipino.', 'tl'],
  ['Explain online payment permission in Taglish.', 'taglish'],
  ['May naiwan na payong. Ano ang gagawin ko?', 'tl'],
  ['Pwede bang staff ang mag-approve ng online payment proof?', 'taglish'],
  ['May I review the rooms?', 'en'],
  ['Do not answer in Tagalog.', 'en'],
  ['Explain in Tagalog. Actually, answer in English.', 'en'],
])('selects requested language for %s', (message, language) => {
  expect(assistantLanguage(message)).toBe(language);
});
it.each(['tl', 'taglish'] as const)('never admits negotiated %s from model flags or environment claims', language => {
  expect(assistantSynthesisLanguageAdmitted(language, true)).toBe(false);
  expect(assistantSynthesisLanguageAdmitted(language, false)).toBe(true);
});
it('keeps ordinary English synthesis admission', () => {
  expect(assistantSynthesisLanguageAdmitted('en', true)).toBe(true);
});
