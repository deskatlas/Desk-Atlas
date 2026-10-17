import { assistantPresentationSchema, type AssistantAnswer, type AssistantEvidenceSpan } from '@deskatlas/validation';

type ExactAtom = NonNullable<AssistantAnswer['presentation']>['atoms'][number];

// MS62-TC02/03/04: this is a render projection, never a replacement for proof.
// Only a leading heading cluster can prove that a title/path is redundant.
// Body text, actions, later stage headings and cross-source labels never qualify.
export function exactAssistantMainAtoms(
  spans: NonNullable<AssistantAnswer['evidence_spans']>, atoms: ExactAtom[], citations: AssistantAnswer['citations'],
): { atoms: ExactAtom[]; omitted: number; status: 'STRUCTURAL_ONLY' | 'ORIGINAL_EXACT' } {
  const omitted = new Set<ExactAtom>();
  const label = (text: string) => text.replace(/^#{1,6}\s+/, '').trim();
  spans.forEach((span, evidence) => {
    const source = citations.find(item => item.chunk_id === span.chunk_id);
    if (!source) return;
    const local = atoms.filter(atom => atom.evidence === evidence);
    const cluster: ExactAtom[] = [];
    for (const atom of local) {
      const text = span.quote.slice(atom.start, atom.end).replace(/\r$/, '');
      if (atom.kind !== 'heading' && !(atom.kind === 'text' && (text === source.title || text === source.heading_path))) break;
      cluster.push(atom);
    }
    const headingNames = new Set(cluster.filter(atom => atom.kind === 'heading').map(atom => label(span.quote.slice(atom.start, atom.end))));
    let previousHeading: string | undefined;
    for (const atom of cluster) {
      const text = span.quote.slice(atom.start, atom.end).replace(/\r$/, '');
      if (atom.kind === 'heading') {
        // Repetitions after any operative content start a different stage.
        if (previousHeading === label(text)) omitted.add(atom);
        previousHeading = label(text);
      } else if (atom.kind === 'text' &&
        (text === source.title || text === source.heading_path) &&
        text.split(' / ').every(part => headingNames.has(part.trim()))) {
        omitted.add(atom);
      } else break;
    }
  });
  return { atoms: atoms.filter(atom => !omitted.has(atom)), omitted: omitted.size,
    status: omitted.size ? 'STRUCTURAL_ONLY' : 'ORIGINAL_EXACT' };
}

// MS59-TC05/17: retain exact complete proof and original order, split only at lines.
export function exactAssistantPresentation(spans: AssistantEvidenceSpan[]): AssistantAnswer['presentation'] {
  const atoms: { kind: 'heading' | 'text' | 'step' | 'bullet'; evidence: number; start: number; end: number }[] = [];
  let fenced = false;
  spans.forEach((span, evidence) => {
    let offset = 0;
    for (const line of span.quote.split('\n')) {
      const start = offset, end = start + line.length; offset = end + 1;
      const fence = /^\s*(```|~~~)/.test(line);
      if (line.trim()) atoms.push({ kind: fenced || fence || /^ {4}/.test(line) ? 'text'
        : /^#{1,6}\s/.test(line) ? 'heading' : /^\s{0,3}\d+\\?[.)]\s/.test(line) ? 'step'
          : /^\s{0,3}[-*+]\s/.test(line) ? 'bullet' : 'text', evidence, start, end });
      if (fence) fenced = !fenced;
    }
  });
  if (atoms.filter(atom => atom.kind === 'step').length > 12) return undefined;
  const parsed = assistantPresentationSchema.safeParse({ version: 'ms59-v1', atoms });
  return parsed.success ? parsed.data : undefined;
}
