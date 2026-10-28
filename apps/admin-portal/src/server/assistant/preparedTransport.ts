import { AssistantError } from '@deskatlas/domain';
import { preparedSupportCatalogSchema, preparedSupportEvidenceSchema } from '@deskatlas/validation';

type Catalog = ReturnType<typeof preparedSupportCatalogSchema.parse>;
type Evidence = ReturnType<typeof preparedSupportEvidenceSchema.parse>;
const invalid = () => { throw new AssistantError('KNOWLEDGE_CHANGED', 'Prepared original evidence changed.', 409); };

// SDD-C21/C23 / QAD-TC44: dictionary encoding preserves every original address.
export function discoveryIndexes(documents: Catalog['documents']) {
  return documents.map(index => {
    const closures = index.groups.map(group => {
      const pending = index.groups.some(item => item.scope === 'DOCUMENT') ? index.groups.map(item => item.id)
        : [group.id, ...index.groups.filter(item => item.scope === 'GLOBAL').map(item => item.id)];
      const visited = new Set<number>(), units = new Set<number>();
      while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const current = index.groups.find(item => item.id === id);
        if (!current) return invalid();
        pending.push(...current.requires);
        for (const [first,last] of current.ranges) for (let i=first;i<=last;i++) units.add(i);
      }
      return { id:group.id, units, key:[...units].sort((a,b)=>a-b).join(',') };
    });
    const seen = new Set<string>();
    const entrypoints = closures.filter(closure => {
      if (seen.has(closure.key)) return false;
      seen.add(closure.key); return true;
    }).map(closure => ({ id:closure.id, units:closure.units.size,
      covers:closures.filter(other=>[...other.units].every(unit=>closure.units.has(unit))).map(other=>other.id) }));
    return { ...index, entrypoints, groups: index.groups.map(({ id, label, applies_to, scope }) =>
      ({ id, label, applies_to, scope })) };
  });
}

export function packPreparedOriginals(evidence: Evidence) {
  const expected = new Map<string, Set<number>>();
  for (const index of evidence.indexes) {
    const included = new Set(index.selected_groups);
    if (index.groups.some(group => (included.has(group.id) && group.requires.some(id => !included.has(id)))
      || (group.scope === 'GLOBAL' && !included.has(group.id)))
      || (index.groups.some(group => group.scope === 'DOCUMENT') && included.size !== index.groups.length)) invalid();
    const addresses = new Set<number>();
    for (const group of index.groups.filter(group => included.has(group.id))) {
      for (const [first, last] of group.ranges) for (let i = first; i <= last; i++) addresses.add(i);
    }
    expected.set(index.version_id, addresses);
  }
  const documents: { d: string; v: string; t: string }[] = [], headings: string[] = [], texts: string[] = [];
  const chunks: { c: string; d: number; h: number; s: string }[] = [];
  const versions = new Map<string, number>(), headingIds = new Map<string, number>(), textIds = new Map<string, number>();
  const chunkIds = new Map<string, number>();
  for (const source of evidence.sources) {
    const index = evidence.indexes.find(item => item.version_id === source.version_id);
    if (!index || index.document_id !== source.document_id) invalid();
    if (!versions.has(source.version_id)) {
      versions.set(source.version_id, documents.length);
      documents.push({ d: source.document_id, v: source.version_id, t: source.title });
    }
    if (!headingIds.has(source.heading_path)) { headingIds.set(source.heading_path, headings.length); headings.push(source.heading_path); }
    chunkIds.set(source.chunk_id, chunks.length);
    chunks.push({ c: source.chunk_id, d: versions.get(source.version_id)!, h: headingIds.get(source.heading_path)!, s: source.content_hash });
  }
  const seen = new Map<string, Set<number>>(), usedChunks = new Set<string>(), spans = new Set<string>();
  const units = evidence.units.map(unit => {
    const source = evidence.sources.find(item => item.chunk_id === unit.chunk_id);
    if (!source || source.heading_path !== unit.heading || source.content.slice(unit.start, unit.end) !== unit.text) return invalid();
    const addresses = seen.get(source.version_id) ?? new Set<number>();
    const span = `${unit.chunk_id}:${unit.start}:${unit.end}`;
    if (!expected.get(source.version_id)?.has(unit.i) || addresses.has(unit.i) || spans.has(span)) return invalid();
    addresses.add(unit.i); seen.set(source.version_id, addresses); spans.add(span); usedChunks.add(source.chunk_id);
    if (!textIds.has(unit.text)) { textIds.set(unit.text, texts.length); texts.push(unit.text); }
    return { c: chunkIds.get(unit.chunk_id)!, s: unit.start, e: unit.end, t: textIds.get(unit.text)! };
  });
  if (evidence.sources.some(source => !usedChunks.has(source.chunk_id))
    || [...expected].some(([version, addresses]) => seen.get(version)?.size !== addresses.size)) invalid();
  return { documents, headings, chunks, texts, units };
}
