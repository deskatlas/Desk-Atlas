// SPEC-5: PRD-F27, ERD-E24 through ERD-E29, QAD-TC45.
export type KnowledgeAudience = 'ADMIN_ONLY' | 'ADMIN_AND_STAFF';
export type KnowledgeStatus = 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'SUPERSEDED' | 'FAILED' | 'REMOVED';
export interface KnowledgeVersion {
  id: string; document_id: string; version_number: number; status: KnowledgeStatus;
  original_filename: string; warning_codes: string[]; created_at: string;
  reviewed_at: string | null; published_at: string | null; chunk_count: number | null;
  expected_revision: number; generation: number;
}
export interface KnowledgeDocument {
  id: string; title: string; audience: KnowledgeAudience; revision: number;
  active_version_id: string | null; deleted_at: string | null;
  versions: KnowledgeVersion[]; jobs: { id: string; version_id: string; kind: string; status: string; stage: string | null; last_error_code: string | null }[];
}
export interface KnowledgeNotice {
  id: string; document_id: string; version_id: string; kind: 'READY_FOR_REVIEW' | 'PROCESSING_FAILED' | 'PURGE_FAILED';
  created_at: string; read_at: string | null; error_code: string | null;
}
export function knowledgeCanRetrieve(document: Pick<KnowledgeDocument, 'active_version_id' | 'deleted_at' | 'audience'>,
  version: Pick<KnowledgeVersion, 'id' | 'status'>, role: 'ADMIN' | 'STAFF', fingerprint: string, activeFingerprint: string): boolean {
  return !document.deleted_at && document.active_version_id === version.id && version.status === 'PUBLISHED'
    && fingerprint === activeFingerprint && (role === 'ADMIN' || document.audience === 'ADMIN_AND_STAFF');
}
