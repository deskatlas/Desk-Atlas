import {
  createAdminSettingsService,
  createTransactionalEmailService,
  InMemorySettingsRepository,
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
} from "@deskatlas/domain";

let serviceInstance: ReturnType<typeof createAdminSettingsService> | null = null;

export function getAdminSettingsService() {
  if (serviceInstance) {
    return serviceInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    const settingsRepo = new SupabaseSettingsRepository({ supabaseUrl, serviceRoleKey });
    const reservationRepo = new ReservationSupabaseRepository({ supabaseUrl, serviceRoleKey });
    const emailService = createTransactionalEmailService({
      apiKey: process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN || "mock-token",
      fromEmail: process.env.FROM_EMAIL || process.env.POSTMARK_SENDER_EMAIL || "notifications@deskatlas.com",
      settingsRepository: settingsRepo,
    });

    serviceInstance = createAdminSettingsService(
      settingsRepo,
      reservationRepo,
      emailService
    );
  } else {
    serviceInstance = createAdminSettingsService(new InMemorySettingsRepository());
  }

  return serviceInstance;
}
