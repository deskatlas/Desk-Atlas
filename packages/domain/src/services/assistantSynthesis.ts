import { assistantSynthesisSchema, assistantSupportVerdictSchema, type AssistantCoverage, type AssistantEvidenceSpan, type AssistantSource, type AssistantSynthesis } from '@deskatlas/validation';

// MS60-TC25/26: stable action indexes derived from unchanged proof, never model text.
export function assistantMainActions(spans: AssistantEvidenceSpan[]): { index: number; evidence: number; text: string }[] {
  const actions: { index: number; evidence: number; text: string }[] = [];
  let fenced = false;
  spans.forEach((span, evidence) => {
    for (const line of span.quote.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced || /^ {4}/.test(line)) continue;
      const match = /^\s{0,3}(?:\d+\\?[.)]|[-*+])\s+(.+)$/.exec(line);
      if (match) actions.push({ index: actions.length, evidence, text: match[1] });
    }
  });
  return actions;
}

// MS57 / SDD-C20/C21: independent mechanical checks, separate from semantic
// support review. Conservative rejection reuses the verified exact answer.
export function validateAssistantSynthesis(value: unknown, coverage: AssistantCoverage, spans: AssistantEvidenceSpan[], sources: AssistantSource[], question = ''): AssistantSynthesis | undefined {
  const parsed = assistantSynthesisSchema.safeParse(value);
  if (!parsed.success || !spans.length) return undefined;
  const candidate = parsed.data;
  // QAD-TC44: identical factual blocks share proof; ordered procedures retain repetitions.
  if (!candidate.main_blocks && !['COMPLETE_PROCEDURE', 'DOCUMENT_WIDE'].includes(candidate.scope)) {
    const unique: typeof candidate.blocks = [];
    for (const block of candidate.blocks) {
      const existing = unique.find(other => other.kind === block.kind && other.text === block.text);
      if (existing) existing.support = [...new Set([...existing.support, ...block.support])];
      else unique.push({ ...block, support: [...block.support] });
    }
    candidate.blocks = unique;
  }
  if (candidate.scope !== coverage.scope || candidate.outcome !== coverage.outcome || JSON.stringify(candidate.gaps) !== JSON.stringify(coverage.gaps)) return undefined;
  if (spans.some(span => {
    const source = sources.find(s => s.chunk_id === span.chunk_id);
    return !source || source.content.slice(span.start, span.end) !== span.quote || span.end - span.start !== span.quote.length;
  })) return undefined;
  if (candidate.main_blocks && (candidate.blocks.length !== spans.length || candidate.blocks.some((block, i) =>
    block.kind !== 'text' || block.text !== spans[i].quote || block.support.length !== 1 || block.support[0] !== i))) return undefined;
  const main = candidate.main_blocks ?? candidate.blocks;
  // QAD-TC44: misclassified scope cannot hide numbered workflow duties.
  if (/\b(?:how (?:do|can|should|would) (?:i|we|staff)|what (?:should|do|can) (?:i|we) (?:do|check|prepare)|steps|procedure|before .*arriv|before .*open|opening duties|closing duties)\b/i.test(question)) {
    let fenced = false, cursor = 0;
    const text = main.map(block => block.text).join('\n');
    for (const span of spans) for (const line of span.quote.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      const duty = fenced || /^ {4}/.test(line) ? undefined : /^\s{0,3}\d+\\?[.)]\s+(.+)$/.exec(line)?.[1];
      if (!duty) continue;
      const position = text.indexOf(duty, cursor);
      if (position < 0) return undefined;
      cursor = position + duty.length;
    }
  }
  const referenced = new Set(main.flatMap(b => b.support));
  if (referenced.size !== spans.length || [...referenced].some(i => i >= spans.length)) return undefined;
  if (candidate.main_blocks) {
    const actions = assistantMainActions(spans);
    const mapped = candidate.main_blocks.flatMap(block => block.actions);
    if (candidate.scope === 'COMPLETE_PROCEDURE') {
      if (mapped.length !== actions.length || mapped.some((id, i) => id !== i) || candidate.main_blocks.some(block =>
        block.actions.length && (block.kind !== 'step' || block.actions.length !== 1 || !block.support.includes(actions[block.actions[0]]?.evidence)))) return undefined;
    } else if (mapped.length) return undefined;
  }
  for (const block of main) {
    const actionIndexes = candidate.main_blocks?.find(item => item === block)?.actions;
    const action = actionIndexes?.length === 1 ? assistantMainActions(spans)[actionIndexes[0]] : undefined;
    const support = action?.text ?? block.support.map(i => spans[i].quote).join('\n');
    // MS59-TC05: a title is never a work action; a packed source procedure
    // cannot become one outer synthetic action containing another numbered list.
    if (block.kind === 'step' && (block.support.every(i => {
      const source = sources.find(s => s.chunk_id === spans[i].chunk_id);
      return source && source.content.split(/\n\s*\n/).every(part => !part.trim() || source.heading_path.includes(part.trim().replace(/^#{1,6}\s*/, '')));
    }) || (block.text.match(/^\s*\d+\\?[.)]\s/gm) ?? []).length > 1)) return undefined;
    // Generated URLs/markup never become navigation, and numbers/quoted UI labels
    // cannot be invented. Semantic review additionally checks units/conditions.
    if (/https?:\/\/|<\/?\w|\]\(/i.test(block.text)) return undefined;
    const tokens = block.text.match(/\b\d+(?:[.,:]\d+)*\b|`[^`]+`|"[^"\n]+"/g) ?? [];
    if (tokens.some(token => !support.includes(token))) return undefined;
    const negation = /\b(?:not|never|cannot|without|no|hindi|bawal|walang)\b|\b(?:mustn't|can't|don't|doesn't)\b/i;
    const exactLine = candidate.main_blocks && block.support.some(i => spans[i].quote.split('\n').some(line =>
      line.replace(/^\s{0,3}(?:\d+\\?[.)]|[-*+])\s+/, '') === block.text));
    // A verbatim canonical line cannot introduce a paraphrased permission.
    // Other mandatory restrictions still require full independent review.
    if (!exactLine && negation.test(support) && !negation.test(block.text)) return undefined;
    const roles = block.text.match(/\b(?:staff|admin(?:istrator)?s?|management|guests?|customers?)\b/gi) ?? [];
    if (roles.some(role => !new RegExp(`\\b${role}\\b`, 'i').test(support))) return undefined;
    const quantities: string[] = block.text.match(/(?:[$₱€£]\s*)?\d+(?:[.,:]\d+)*(?:\s*(?:minutes?|hours?|days?|weeks?|months?|years?|PHP|USD|pesos?|percent|%))?/gi) ?? [];
    if (quantities.some(quantity => !support.toLowerCase().includes(quantity.toLowerCase()))) return undefined;
  }
  // Complete procedures retain exact ordered steps and all restrictions. An
  // introduction may be generated, but paraphrasing required steps is not needed.
  if (candidate.scope === 'COMPLETE_PROCEDURE' || candidate.scope === 'DOCUMENT_WIDE') {
    const text = candidate.blocks.map(b => b.text).join('\n\n');
    let cursor = 0;
    for (const span of spans) {
      const offset = text.indexOf(span.quote, cursor);
      if (offset < 0) return undefined;
      cursor = offset + span.quote.length;
    }
  }
  return candidate;
}

export function assistantSynthesisSupported(value: unknown, candidate: AssistantSynthesis): boolean {
  const verdict = assistantSupportVerdictSchema.safeParse(value);
  return verdict.success && verdict.data.complete && verdict.data.consistent && verdict.data.evidence_safe &&
    verdict.data.supported.length === (candidate.main_blocks ?? candidate.blocks).length && verdict.data.supported.every(Boolean);
}
