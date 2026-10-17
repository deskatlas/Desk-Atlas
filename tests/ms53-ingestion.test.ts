import { expect, it } from 'vitest';
import { auditKnowledgeStructure, prepareKnowledgeReview, type KnowledgeStructureContext } from '../packages/domain/src/services/knowledgeStructure';
import { KnowledgePublishSchema } from '../packages/validation/src/knowledgeSchema';

// MS53-TC10/11/13 / QAD-TC45: routine review and uncertain applicability.
function chunk(section_id: string, content: string, patch: Partial<KnowledgeStructureContext> = {}) {
  return { content, section_context: { version: 2, section_id, dependencies: [], unresolved: false,
    ancestors: [], references: [], scope: 'UNREVIEWED', structure_known: true, unresolved_references: false,
    ...patch } as KnowledgeStructureContext };
}

it('prepares one complete headingless source without technical section tagging', () => {
  const chunks = [chunk('s1', 'First check the reference. Never add an unauthorized fee.')];
  const prepared = prepareKnowledgeReview(chunks);
  expect(prepared.exceptions).toEqual([]);
  expect(prepared.reviews[0].scope).toBe('DOCUMENT');
  expect(auditKnowledgeStructure(chunks, prepared.reviews).canPublish).toBe(true);
  expect(chunks[0].section_context.scope).toBe('UNREVIEWED');
});

it('keeps conditional and negative cross-topic scope as an explicit exception', () => {
  for (const policy of ['Only managers approve changes.', 'Do not add a fee.', 'If a balance remains, consult reception.', 'Hindi puwede ang dagdag na bayad.']) {
    const prepared = prepareKnowledgeReview([chunk('s1', policy), chunk('s2', 'Kitchen opens at eight.')]);
    expect(prepared.exceptions.map(issue => issue.sectionId)).toEqual(['s1']);
    expect(prepared.reviews[0].scope).toBe('UNREVIEWED');
  }
});

it('does not hide broken references, unknown structure or OCR reading order', () => {
  const broken = chunk('s1', 'See missing guidance.', { unresolved_references: true, unresolved: true });
  expect(prepareKnowledgeReview([broken]).exceptions).toHaveLength(1);
  expect(prepareKnowledgeReview([chunk('s1', 'Unreadable layout.', { structure_known: false })]).exceptions).toHaveLength(1);
  expect(prepareKnowledgeReview([{ ...chunk('s1', 'Scanned text.'), extraction_method: 'OCR' }]).exceptions).toHaveLength(1);
});

it('validates complete approval identity and keeps legacy explicit review compatible', () => {
  const base = { expected_revision: 1, audience: 'ADMIN_ONLY', acknowledge_warnings: true,
    acknowledge_structure: true, request_id: '00000000-0000-4000-8000-000000000001' };
  const identity = { source_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64),
    structure_manifest_sha256: 'c'.repeat(64), generation: 1, audience: 'ADMIN_ONLY' };
  expect(KnowledgePublishSchema.safeParse({ ...base, document_review: identity }).success).toBe(true);
  expect(KnowledgePublishSchema.safeParse({ ...base, document_review: { ...identity, content_sha256: 'missing' } }).success).toBe(false);
  expect(KnowledgePublishSchema.safeParse(base).success).toBe(true);
});
