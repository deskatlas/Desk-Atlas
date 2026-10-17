import { expect, it } from 'vitest';
import { auditKnowledgeStructure, type KnowledgeStructureContext } from '../packages/domain/src/services/knowledgeStructure';

// MS48-TC02/06/13, QAD-TC45: the reported global unresolved dependency pattern.
const context = (section_id: string, patch: Partial<KnowledgeStructureContext> = {}): KnowledgeStructureContext => ({
  version: 2, section_id, dependencies: [], unresolved: false, ancestors: [], references: [],
  scope: 'LOCAL', structure_known: true, unresolved_references: false, ...patch,
});
const chunk = (section_context: KnowledgeStructureContext) => ({ section_context });

it('identifies a single unresolved legacy section blocking all 119 sections', () => {
  const chunks = Array.from({ length: 119 }, (_, i) => chunk(context(`s${i + 1}`, {
    version: 1, dependencies: i === 0 ? [] : ['s1'], unresolved: i === 0,
  })));
  const audit = auditKnowledgeStructure(chunks);
  expect(audit.requiresReprocessing).toBe(true);
  expect(audit.unresolvedSectionIds).toEqual(['s1']);
  expect(audit.blockedSectionIds).toHaveLength(119);
});

it('previews reviewed local scope without dropping explicit required approval', () => {
  const chunks = [chunk(context('s1', { references: ['s2'] })), chunk(context('s2')), chunk(context('s3'))];
  const audit = auditKnowledgeStructure(chunks, chunks.map(c => ({ section_id: c.section_context.section_id,
    scope: 'LOCAL', dependencies: [], acknowledge_references: false })));
  expect(audit.canPublish).toBe(true);
  expect(audit.sections.find(s => s.sectionId === 's1')?.requiredChunkCount).toBe(2);
  expect(audit.sections.find(s => s.sectionId === 's3')?.requiredChunkCount).toBe(1);
});

it('makes unresolved scope visibly disable every section before publication', () => {
  const chunks = [chunk(context('s1')), chunk(context('s2'))];
  const audit = auditKnowledgeStructure(chunks, [
    { section_id: 's1', scope: 'UNRESOLVED', dependencies: [], acknowledge_references: false },
    { section_id: 's2', scope: 'LOCAL', dependencies: [], acknowledge_references: false },
  ]);
  expect(audit.canPublish).toBe(true);
  expect(audit.blockedSectionIds).toEqual(['s1', 's2']);
});

it('never treats ingestion metadata alone as publication approval', () => {
  expect(auditKnowledgeStructure([chunk(context('s1', { scope: 'UNREVIEWED' }))]).canPublish).toBe(false);
  expect(auditKnowledgeStructure([{}]).requiresReprocessing).toBe(true);
});

it('rejects missing, duplicate, self-referential and nonexistent review targets', () => {
  const chunks = [chunk(context('s1')), chunk(context('s2'))];
  const review = { section_id: 's1', scope: 'LOCAL' as const, dependencies: [], acknowledge_references: false };
  for (const reviews of [[review], [review, review], [review, { ...review, section_id: 's2', dependencies: ['s99'] }],
    [{ ...review, dependencies: ['s1'] }, { ...review, section_id: 's2' }]]) {
    expect(auditKnowledgeStructure(chunks, reviews).canPublish).toBe(false);
  }
});

it('requires explicit reference resolution and preserves document-wide context', () => {
  const chunks = [chunk(context('s0')), chunk(context('s1', { unresolved: true, unresolved_references: true })), chunk(context('s2'))];
  const reviews = chunks.map(c => ({ section_id: c.section_context.section_id,
    scope: c.section_context.section_id === 's0' ? 'DOCUMENT' as const : 'LOCAL' as const,
    dependencies: [], acknowledge_references: false }));
  expect(auditKnowledgeStructure(chunks, reviews).canPublish).toBe(false);
  expect(auditKnowledgeStructure(chunks, reviews).blockedSectionIds).toEqual(['s1']);
  const resolved = reviews.map(r => r.section_id === 's1' ? { ...r, dependencies: ['s2'], acknowledge_references: true } : r);
  const audit = auditKnowledgeStructure(chunks, resolved);
  expect(audit.canPublish).toBe(true);
  expect(audit.blockedSectionIds).toEqual([]);
  expect(audit.sections.find(s => s.sectionId === 's1')?.requiredChunkCount).toBe(3);
});

it('counts complete multi-chunk cyclic closures once and reports the six-source limit', () => {
  const chunks = [chunk(context('s1', { dependencies: ['s2'] })), chunk(context('s2', { dependencies: ['s1'] })),
    ...Array.from({ length: 5 }, () => chunk(context('s2', { dependencies: ['s1'] })))];
  const audit = auditKnowledgeStructure(chunks);
  expect(audit.sections.map(s => s.requiredChunkCount)).toEqual([7, 7]);
  expect(audit.overBudgetSectionIds).toEqual(['s1', 's2']);
  expect(audit.blockedSectionIds).toEqual([]);
});
