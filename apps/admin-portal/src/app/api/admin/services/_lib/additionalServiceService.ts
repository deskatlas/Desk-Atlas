import {
  AdditionalServiceService,
  createAdditionalServiceService,
  InMemoryAdditionalServiceRepository,
  SupabaseAdditionalServiceRepository,
} from '@deskatlas/domain';

let serviceInstance: AdditionalServiceService | null = null;

export function getAdminAdditionalServiceService(): AdditionalServiceService {
  if (serviceInstance) {
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    serviceInstance = createAdditionalServiceService(new SupabaseAdditionalServiceRepository());
  } else {
    serviceInstance = createAdditionalServiceService(new InMemoryAdditionalServiceRepository());
  }

  return serviceInstance;
}

export function setAdminAdditionalServiceService(service: AdditionalServiceService | null) {
  serviceInstance = service;
}

