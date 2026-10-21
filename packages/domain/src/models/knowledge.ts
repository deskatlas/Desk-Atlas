// SPEC-5: PRD-F27, ERD-E24 through ERD-E29, QAD-TC45.
export type KnowledgeAudience = 'ADMIN_ONLY' | 'ADMIN_AND_STAFF' | 'CUSTOMER';
export type KnowledgePrincipal = 'ADMIN' | 'STAFF' | 'PUBLIC_VISITOR' | 'VERIFIED_CUSTOMER';
// MS76-TC01: management authority does not grant conversational retrieval.
export function knowledgeAudienceAllowed(audience: KnowledgeAudience, principal: KnowledgePrincipal): boolean {
  if (principal === 'ADMIN') return audience === 'ADMIN_ONLY' || audience === 'ADMIN_AND_STAFF';
  if (principal === 'STAFF') return audience === 'ADMIN_AND_STAFF';
  return (principal === 'PUBLIC_VISITOR' || principal === 'VERIFIED_CUSTOMER') && audience === 'CUSTOMER';
}
export type KnowledgeStatus = 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'SUPERSEDED' | 'FAILED' | 'REMOVED';
export interface KnowledgeVersion {
  id: string; document_id: string; version_number: number; status: KnowledgeStatus;
  original_filename: string; warning_codes: string[]; created_at: string;
  reviewed_at: string | null; published_at: string | null; chunk_count: number | null;
  expected_revision: number; generation: number;
  automatic_preparation?: boolean;
}
export interface KnowledgeDocument {
  id: string; title: string; audience: KnowledgeAudience; revision: number;
  active_version_id: string | null; deleted_at: string | null;
  versions: KnowledgeVersion[]; jobs: { id: string; version_id: string; kind: string; status: string; stage: string | null; last_error_code: string | null }[];
}
export interface KnowledgeNotice {
  id: string; document_id: string; version_id: string; kind: 'AVAILABLE' | 'READY_FOR_REVIEW' | 'PROCESSING_FAILED' | 'PURGE_FAILED';
  created_at: string; read_at: string | null; error_code: string | null;
}
// MS64-TC13 / PRD-F27: display only, never a document identity or replacement key.
export function knowledgeDisplayTitle(filename: string): string {
  return Array.from(filename.normalize('NFC').replace(/\.(md|docx?|pdf)$/i, '')
    .replace(/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ').trim()).slice(0, 200).join('') || 'Untitled document';
}
export function knowledgeProcessingRemedy(code?: string | null): string {
  if (code === 'ENCRYPTED_FILE') return 'Upload an unlocked copy of this file.';
  if (['STORAGE_FAILED', 'EMBEDDING_FAILED', 'RESOURCE_LIMIT'].includes(code ?? '')) return 'Processing was interrupted. Try Retry.';
  if (code === 'CONTENT_LIMIT') return 'Upload separate documents for each procedure, keeping its conditions and exceptions together.';
  if (code === 'FORBIDDEN') return 'An active administrator needs to upload this file again.';
  if (code === 'VERSION_CONFLICT') return 'This document changed. Upload a replacement using its current settings.';
  if (['PARSER_FAILED', 'PARSER_REVISION_MISMATCH'].includes(code ?? '')) return 'The document processor is unavailable or needs an update. Ask an administrator to check it, then Retry.';
  if (code === 'MANIFEST_INVALID') return 'We could not verify the complete document. Try Retry. If this continues, ask an administrator to check document processing.';
  return 'We could not prepare the complete file. Upload a clearer copy with all instructions and references included.';
}
// MS-51 / PRD-F27 / DSD-UI17: working files exclude retained lifecycle history.
export function knowledgeWorkingDocument(document: KnowledgeDocument): KnowledgeDocument | null {
  if (document.deleted_at) return null;
  const versions = document.versions.filter(version => version.status !== 'REMOVED' && version.status !== 'SUPERSEDED')
    .sort((a, b) => {
      if (a.id === document.active_version_id) return -1;
      if (b.id === document.active_version_id) return 1;
      return b.version_number - a.version_number;
    });
  if (!versions.length) return null;
  return { ...document, versions, jobs: document.jobs.filter(job => job.kind === 'INGEST' && versions.some(version => version.id === job.version_id)) };
}
export interface KnowledgeCleanup {
  id: string; title: string; revision: number; pending: number; failed: number;
  waiting_upload?: number; cleaning_chunks?: number; retrying?: number; running?: number; awaiting_worker?: number;
}
export function knowledgeCanRetrieve(document: Pick<KnowledgeDocument, 'active_version_id' | 'deleted_at' | 'audience'>,
  version: Pick<KnowledgeVersion, 'id' | 'status'>, role: KnowledgePrincipal, fingerprint: string, activeFingerprint: string): boolean {
  return !document.deleted_at && document.active_version_id === version.id && version.status === 'PUBLISHED'
    && fingerprint === activeFingerprint && knowledgeAudienceAllowed(document.audience, role);
}
