import {
  RentalService,
  createRentalService,
  InMemoryRentalRepository,
  SupabaseRentalRepository,
} from '@deskatlas/domain';

let serviceInstance: RentalService | null = null;

export function getAdminRentalService(): RentalService {
  if (serviceInstance) {
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    serviceInstance = createRentalService(new SupabaseRentalRepository());
  } else {
    serviceInstance = createRentalService(new InMemoryRentalRepository());
  }

  return serviceInstance;
}

export function setAdminRentalService(service: RentalService | null) {
  serviceInstance = service;
}

