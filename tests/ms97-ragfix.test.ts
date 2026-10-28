import { describe, expect, it } from 'vitest';
import { currentOperationalPlan, guidanceDocumentPlan } from '../packages/domain/src/services/assistantService';
import { assistantSearchQueries } from '../packages/domain/src/services/assistantHybridRetrieval';

// PRD-F26 / SDD-C20-C22 / QAD-TC44/46: ordinary wording, never permissions.
describe('ragfix current operations and guidance routing', () => {
  it.each(['A guest has a confirmed paid booking. What should staff check on arrival?', 'What should employees verify before check-in?'])('classifies role-worded guidance once without granting a tool: %s', message => {
    expect(guidanceDocumentPlan(message)).toEqual({ kind: 'DOCUMENT', query: message, tools: [] });
  });
  it.each(['What should staff do and show revenue today?', 'What should employees check for reservation 123?', 'What should staff do with that?'])('keeps mixed, record-specific and unresolved role wording on the planner path: %s', message => {
    expect(guidanceDocumentPlan(message)).toBeUndefined();
  });
  it('keeps broad daily operations searchable without replacing the original question', () => {
    const message = "I'm new here. What should I focus on when running the place day to day?";
    const queries = assistantSearchQueries(message, undefined);
    expect(queries[0]).toBe(message);
    expect(queries).toContain(`${message}\nSearch interpretation: Daily operations and employee responsibilities`);
  });
  it.each(['How many people are checked in right now?', 'How many are currently checked in?'])('recognizes present occupancy: %s', message => {
    expect(currentOperationalPlan(message)).toEqual(currentOperationalPlan('How many are checked in today?'));
    expect(currentOperationalPlan(message)?.kind).toBe('OPERATIONAL');
  });
  it.each(["I'm new here. What should I focus on when running the place day to day?", 'How do we normally handle customer payments?', 'What should we do when a customer arrives?', 'A customer is unhappy. How should we handle it?', 'What should I do if something breaks in the workspace?', 'Paano namin aasikasuhin ang customer mula pagdating hanggang pag-alis?', 'What should I check before handing over my shift?'])('routes guidance as read-only knowledge: %s', message => {
    expect(guidanceDocumentPlan(message)).toEqual({ kind: 'DOCUMENT', query: message, tools: [] });
  });
  it.each(['How many were checked in yesterday?', 'How many are checked in right now and show revenue?', 'What should I do and show last month revenue?', 'What about that?', 'How do I fix it?', 'How much revenue today?'])('defers mixed, historical and unresolved requests: %s', message => {
    expect(guidanceDocumentPlan(message)).toBeUndefined();
    expect(currentOperationalPlan(message)).toBeUndefined();
  });
});
