// MS48-TC02/06/13 / SDD-C23,C24: preview the same closure used by SQL.
// This audit assists review; the database remains the publication authority.
export interface KnowledgeStructureContext {
  version: 1 | 2; section_id: string; dependencies: string[]; unresolved: boolean;
  ancestors?: string[]; references?: string[];
  scope?: 'UNREVIEWED' | 'LOCAL' | 'DOCUMENT' | 'UNRESOLVED';
  structure_known?: boolean; unresolved_references?: boolean;
}
export interface KnowledgeStructureReview {
  section_id: string; scope: 'UNREVIEWED' | 'LOCAL' | 'DOCUMENT' | 'UNRESOLVED';
  dependencies: string[]; acknowledge_references: boolean;
}
export interface KnowledgeDocumentReviewIdentity {
  source_sha256: string; content_sha256: string; structure_manifest_sha256: string;
  generation: number; audience: import('../models/knowledge').KnowledgeAudience;
}
// MS53-TC10/11/13: preparation proposes scope; explicit document approval and
// database validation remain necessary. Single-unit sources retain everything.
export function prepareKnowledgeReview(chunks: ReadonlyArray<{
  content: string; heading_path?: string; extraction_method?: string; section_context?: KnowledgeStructureContext | null;
}>) {
  const nodes = new Map<string, { context: KnowledgeStructureContext; content: string; heading: string; ocr: boolean }>();
  for (const chunk of chunks) {
    if (!chunk.section_context) continue;
    const id = chunk.section_context.section_id;
    const previous = nodes.get(id);
    nodes.set(id, { context: chunk.section_context, content: (previous?.content ?? '') + '\n' + chunk.content,
      heading: chunk.heading_path ?? '', ocr: Boolean(previous?.ocr || (chunk.extraction_method && chunk.extraction_method !== 'TEXT')) });
  }
  const exceptions: { sectionId: string; question: string }[] = [];
  const reviews: KnowledgeStructureReview[] = [];
  for (const [section_id, node] of nodes) {
    const c = node.context;
    // This classifier is duplicated in the SQL authority and tested against it.
    const uncertainScope = nodes.size > 1 && section_id !== 's0' &&
      /\b(only|unless|except|never|must|cannot|not|required|always|every|all|before|after|if|when|without|allowed|prohibited|authorize|approve|fee|payment|balance|restriction|policy|shall|should|huwag|maliban|dapat|hindi)\b/i.test(node.content);
    const question = !c.structure_known ? 'Is the reading order complete? Upload a corrected text source if content is missing.' :
      c.unresolved_references ? 'Which source passages contain the referenced guidance?' :
      node.ocr ? 'Compare the reading order and every scanned page with the original, then confirm where this guidance applies.' :
      uncertainScope ? 'Does this guidance apply to this topic or to the whole document?' : '';
    if (question) exceptions.push({ sectionId: section_id, question });
    reviews.push({ section_id, scope: question ? 'UNREVIEWED' : nodes.size === 1 || section_id === 's0' ? 'DOCUMENT' : 'LOCAL',
      dependencies: [...new Set([...(c.ancestors ?? []), ...(c.references ?? [])])], acknowledge_references: false });
  }
  return { reviews, exceptions };
}
export function auditKnowledgeStructure(
  chunks: ReadonlyArray<{ section_context?: KnowledgeStructureContext | null }>,
  reviews?: ReadonlyArray<KnowledgeStructureReview>,
) {
  const nodes = new Map<string, { context: KnowledgeStructureContext; chunks: number }>();
  let requiresReprocessing = chunks.length === 0;
  for (const chunk of chunks) {
    const context = chunk.section_context;
    if (!context || context.version !== 2) requiresReprocessing = true;
    if (!context) continue;
    const node = nodes.get(context.section_id);
    if (node) node.chunks++;
    else nodes.set(context.section_id, { context, chunks: 1 });
  }
  const issues: string[] = [];
  const proposed = new Map(reviews?.map(review => [review.section_id, review]));
  if (reviews && (reviews.length !== nodes.size || proposed.size !== reviews.length ||
      reviews.some(review => !nodes.has(review.section_id)))) issues.push('Review every section exactly once.');
  const globals = reviews?.filter(review => ['DOCUMENT', 'UNRESOLVED'].includes(review.scope)).map(review => review.section_id) ?? [];
  const edges = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  for (const [id, { context }] of nodes) {
    const review = proposed.get(id);
    if (reviews && !review) { issues.push(`Section ${id}: review required.`); unresolved.add(id); }
    if (review) {
      if (review.scope === 'UNREVIEWED' || (id === 's0' && !['DOCUMENT', 'UNRESOLVED'].includes(review.scope)))
        issues.push(`Section ${id}: confirm rule scope.`);
      if (review.scope !== 'UNRESOLVED' && (!context.structure_known ||
          (context.unresolved_references && (!review.acknowledge_references || review.dependencies.length === 0)))) {
        issues.push(`Section ${id}: verify structure and required references.`);
        unresolved.add(id);
      }
      if (review.dependencies.includes(id)) issues.push(`Section ${id}: cannot reference itself.`);
      if (review.scope === 'UNRESOLVED' || review.scope === 'UNREVIEWED') unresolved.add(id);
    } else if (context.unresolved || context.scope === 'UNREVIEWED' || context.scope === 'UNRESOLVED') unresolved.add(id);
    const dependencies = new Set(review ? [...review.dependencies, ...(context.ancestors ?? []), ...(context.references ?? []), ...globals] : context.dependencies);
    dependencies.delete(id);
    edges.set(id, dependencies);
    for (const target of dependencies) if (!nodes.has(target)) {
      issues.push(`Section ${id}: required section ${target} is missing.`);
      unresolved.add(id);
    }
  }
  // Bound preview work independently of untrusted extraction size.
  const withinBounds = nodes.size <= 1000 && [...edges.values()].reduce((count, targets) => count + targets.size, 0) <= 10000;
  if (!withinBounds) issues.push('The dependency graph exceeds the supported review budget.');
  const sections = [...nodes.keys()].map(sectionId => {
    const visited = new Set<string>();
    const pending = [sectionId];
    let blocked = !withinBounds, requiredChunkCount = 0;
    while (withinBounds && pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.get(id);
      if (!node || unresolved.has(id)) blocked = true;
      requiredChunkCount += node?.chunks ?? 0;
      for (const target of edges.get(id) ?? []) if (!visited.has(target)) pending.push(target);
    }
    return { sectionId, blocked, requiredChunkCount };
  });
  return { requiresReprocessing, canPublish: reviews !== undefined && !requiresReprocessing && issues.length === 0, issues: [...new Set(issues)],
    unresolvedSectionIds: [...unresolved], blockedSectionIds: sections.filter(section => section.blocked).map(section => section.sectionId),
    overBudgetSectionIds: sections.filter(section => !section.blocked && section.requiredChunkCount > 6).map(section => section.sectionId), sections };
}
