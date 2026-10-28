import { createHash } from 'node:crypto';
import { preparedSupportArtifactSchema, type AssistantSource } from '@deskatlas/validation';

// PRD-F27 / SDD-C23 / QAD-TC45: server publication validates original bytes,
// while independent preparation checks the semantic scope/dependency claims.
export function validatePreparedOriginals(candidate: unknown, sources: AssistantSource[]): boolean {
  const parsed = preparedSupportArtifactSchema.safeParse(candidate);
  if (!parsed.success || new Set(sources.map(source => source.chunk_id)).size !== sources.length) return false;
  const artifact = parsed.data;
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const identities = sources.map(source => ({ document_id: source.document_id, version_id: source.version_id,
    chunk_id: source.chunk_id, heading_path: source.heading_path, content_hash: source.content_hash }));
  if (hash(JSON.stringify(identities)) !== artifact.source_binding
    || sources.some(source => hash(source.content) !== source.content_hash)
    || artifact.units.some(unit => !sources.some(source => source.chunk_id === unit.chunk_id))) return false;
  let expectedIndex = 0;
  for (const source of sources) {
    const prefix = source.heading_path ? `${source.heading_path}\n\n` : '';
    let cursor = prefix && source.content.startsWith(prefix) ? prefix.length : 0;
    const units = artifact.units.filter(unit => unit.chunk_id === source.chunk_id);
    if (!units.length) return false;
    for (const unit of units) {
      if (unit.i !== expectedIndex++ || unit.heading !== source.heading_path || unit.start < cursor
        || unit.end > source.content.length || source.content.slice(unit.start, unit.end) !== unit.text
        || /\S/u.test(source.content.slice(cursor, unit.start))) return false;
      cursor = unit.end;
    }
    if (/\S/u.test(source.content.slice(cursor))) return false;
  }
  return expectedIndex === artifact.units.length;
}
