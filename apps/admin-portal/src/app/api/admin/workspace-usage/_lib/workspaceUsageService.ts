import {
  WorkspaceUsageService,
  WorkspaceUsageSupabaseRepository,
} from "@deskatlas/domain";

export function getAdminWorkspaceUsageService() {
  const repo = new WorkspaceUsageSupabaseRepository();
  return new WorkspaceUsageService(repo);
}
