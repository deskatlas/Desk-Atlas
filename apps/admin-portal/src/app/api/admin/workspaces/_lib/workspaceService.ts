import { createWorkspaceService, InMemoryWorkspaceRepository } from '@deskatlas/domain';
import { SupabaseWorkspaceRepository } from './supabaseWorkspaceRepository';

let serviceInstance: ReturnType<typeof createWorkspaceService> | null = null;

export function getAdminWorkspaceService() {
  if (serviceInstance) {
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    serviceInstance = createWorkspaceService(new SupabaseWorkspaceRepository());
  } else {
    serviceInstance = createWorkspaceService(new InMemoryWorkspaceRepository());
  }

  return serviceInstance;
}

export function setAdminWorkspaceService(service: ReturnType<typeof createWorkspaceService> | null) {
  serviceInstance = service;
}

