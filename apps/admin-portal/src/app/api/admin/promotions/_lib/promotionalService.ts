import {
  createPromotionalService,
  InMemoryPromotionalRepository,
  SupabasePromotionalRepository,
  type PromotionalService,
} from '@deskatlas/domain';

let serviceInstance: PromotionalService | null = null;

export function getAdminPromotionalService(): PromotionalService {
  if (serviceInstance) {
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    serviceInstance = createPromotionalService(new SupabasePromotionalRepository());
  } else {
    serviceInstance = createPromotionalService(new InMemoryPromotionalRepository());
  }

  return serviceInstance;
}

export function setAdminPromotionalService(service: PromotionalService | null) {
  serviceInstance = service;
}
