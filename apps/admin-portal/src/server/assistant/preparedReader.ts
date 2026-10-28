import { createHash } from 'node:crypto';
import { preparedSupportCatalogSchema, preparedSupportSelectionSchema, preparedSupportEvidenceSchema } from '@deskatlas/validation';
import { validateDocumentSupport } from '@deskatlas/domain';
import { AssistantError } from '@deskatlas/domain';
import { discoveryIndexes, packPreparedOriginals } from './preparedTransport';

type Ports = {
  catalog(): Promise<unknown>;
  select(payload: unknown): Promise<unknown>;
  evidence(selections: unknown): Promise<unknown>;
  answer(payload: unknown): Promise<unknown>;
};
// PRD-F26 / QAD-TC44: one negotiated index version, exact original proof.
export async function readPreparedSupport(query: string, expectedEpoch: number, synthesis: boolean, ports: Ports) {
  const catalog = preparedSupportCatalogSchema.parse(await ports.catalog());
  if (catalog.epoch !== expectedEpoch) throw new AssistantError('KNOWLEDGE_CHANGED', 'Knowledge changed. Please retry.', 409);
  if (!catalog.complete) return undefined;
  const parsedSelection = preparedSupportSelectionSchema.safeParse(await ports.select({
    contract: 'ragfix-prepared-v2', query, indexes: discoveryIndexes(catalog.documents),
  }));
  if (!parsedSelection.success) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Workflow selection could not be verified.', 503);
  const selection = parsedSelection.data;
  if (selection.clarification) {
    if (!selection.clarification.trim().endsWith('?')) throw new AssistantError('INVALID_MODEL_OUTPUT', 'Invalid clarification.', 503);
    throw new AssistantError('AMBIGUOUS_SCOPE', selection.clarification, 400);
  }
  if (!selection.selections.length) throw new AssistantError('INCOMPLETE_EVIDENCE', 'No applicable workflow could be selected reliably. Please retry.', 400);
  for (const chosen of selection.selections) {
    const index = catalog.documents.find(document => document.version_id === chosen.version_id);
    if (!index || index.artifact_sha256 !== chosen.artifact_sha256 || new Set(chosen.groups).size !== chosen.groups.length
      || chosen.groups.some(id => !index.groups.some(group => group.id === id))) {
      throw new AssistantError('INVALID_MODEL_OUTPUT', 'Invalid workflow selection.', 503);
    }
  }
  const evidence = preparedSupportEvidenceSchema.parse(await ports.evidence(selection.selections));
  if (evidence.epoch !== expectedEpoch || evidence.indexes.length !== selection.selections.length
    || evidence.indexes.some(index => !selection.selections.some(chosen => chosen.version_id === index.version_id
      && chosen.artifact_sha256 === index.artifact_sha256 && chosen.groups.every(id => index.selected_groups.includes(id))))
    || evidence.sources.some(source => source.epoch !== expectedEpoch
      || !evidence.indexes.some(index => index.version_id === source.version_id)
      || createHash('sha256').update(source.content).digest('hex') !== source.content_hash)) {
    throw new AssistantError('KNOWLEDGE_CHANGED', 'Prepared evidence changed. Please retry.', 409);
  }
  const payload = { contract: 'ragfix-prepared-v2', query, indexes: discoveryIndexes(catalog.documents),
    selected: evidence.indexes.map(({ version_id, artifact_sha256, selected_groups }) => ({ version_id, artifact_sha256, selected_groups })),
    evidence: packPreparedOriginals(evidence), synthesis };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 260000) throw new AssistantError('INCOMPLETE_EVIDENCE', 'Prepared evidence exceeds verified capacity.', 400);
  const binding = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const result = validateDocumentSupport(await ports.answer(payload), binding, evidence.sources, 'ragfix-prepared-v2');
  if (!result || result.spans.some(span => !evidence.units.some(unit => unit.chunk_id === span.chunk_id
    && unit.start === span.start && unit.end === span.end && unit.text === span.quote))) {
    throw new AssistantError('INVALID_MODEL_OUTPUT', 'Prepared support could not be verified.', 503);
  }
  return { result, sources: evidence.sources, selections: selection.selections };
}
