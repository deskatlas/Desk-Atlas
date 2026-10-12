import { createClient } from '@supabase/supabase-js';
import {
  CampaignMemoryRepository,
  CampaignService,
  CampaignSupabaseRepository,
  type CampaignRepository,
} from '@deskatlas/domain';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

let customRepository: CampaignRepository | null = null;
let serviceInstance: CampaignService | null = null;

export function setCustomCampaignRepository(repo: CampaignRepository | null): void {
  customRepository = repo;
  serviceInstance = repo ? new CampaignService(repo) : null;
}

export function getAdminCampaignService(): CampaignService {
  if (serviceInstance) {
    return serviceInstance;
  }

  if (customRepository) {
    serviceInstance = new CampaignService(customRepository);
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const repo = new CampaignSupabaseRepository(supabase);
    serviceInstance = new CampaignService(repo);
  } else {
    const memoryRepo = new CampaignMemoryRepository();
    serviceInstance = new CampaignService(memoryRepo);
  }

  return serviceInstance;
}
