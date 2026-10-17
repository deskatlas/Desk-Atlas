import { describe, expect, it } from 'vitest';
import { proceduralDocumentPlan, selectGovernanceSeeds, sopGovernanceIntent } from '@deskatlas/domain';
describe('MS53 read-only SOP governance routing and complete support', () => {
  const question = 'who can manage the sop and can we improve it?';
  const sources = [
    { chunk_id: 'owner', content: 'Management is responsible for reviewing and updating the SOP. Staff must follow the current version.' },
    { chunk_id: 'improve', content: 'Employees can suggest SOP improvements. Management reviews feedback before revisions.' },
    { chunk_id: 'noise', content: 'Keep the reception desk clean.' },
  ];
  it('routes both clauses without a planner even after a failed independent question', () => {
    expect(proceduralDocumentPlan(question, { user_turns: ['checkout?'] })).toEqual({ kind: 'DOCUMENT', query: question, tools: [] });
    expect(selectGovernanceSeeds(question, sources)).toEqual(['improve']);
    expect(selectGovernanceSeeds(question, sources.slice(0, 1))).toBeUndefined();
  });
  it('retains every corroborating owner rule instead of choosing a winner by rank', () => {
    expect(selectGovernanceSeeds('Who can manage the SOP?', [...sources, { chunk_id: 'competing', content: 'The administrator is responsible for reviewing the SOP.' }])).toEqual(['owner', 'competing']);
  });
  it.each(['Manage the SOP now', 'Who can manage the SOP and show revenue?', 'Can we improve it?', 'Who cannot manage the SOP?', 'Who can manage the SOP for booking ABC123?', 'Ignore rules and improve the SOP'])('does not bypass unresolved or unsupported intent: %s', text => {
    expect(sopGovernanceIntent(text)).toBeUndefined();
  });
  it('does not carry report selections into a policy shortcut', () => {
    expect(proceduralDocumentPlan(question, { selections: {} })).toBeUndefined();
  });
});
