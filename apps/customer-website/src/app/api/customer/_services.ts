import {
  CustomerMemoryRepository,
  CustomerSupabaseRepository,
  CustomerService,
  RateLimiterService,
  VoucherMemoryRepository,
  VoucherSupabaseRepository,
  VoucherService,
  createTransactionalEmailService,
  CustomerEmailChangeMemoryRepository,
  CustomerEmailChangeSupabaseRepository,
  CustomerEmailChangeService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

// Shared in-memory instances for memory mode / testing
const sharedCustomerMemoryRepo = new CustomerMemoryRepository();
const sharedVoucherMemoryRepo = new VoucherMemoryRepository();
const sharedEmailChangeMemoryRepo = new CustomerEmailChangeMemoryRepository(sharedCustomerMemoryRepo);

export function getSharedMemoryRepos() {
  return {
    customerRepo: sharedCustomerMemoryRepo,
    voucherRepo: sharedVoucherMemoryRepo,
    emailChangeRepo: sharedEmailChangeMemoryRepo,
  };
}

export function getCustomerServices() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const customerRepo = supabaseUrl && supabaseKey
    ? new CustomerSupabaseRepository({
        supabaseUrl,
        serviceRoleKey: supabaseKey,
      })
    : sharedCustomerMemoryRepo;

  const voucherRepo = supabaseUrl && supabaseKey
    ? new VoucherSupabaseRepository({
        supabaseUrl,
        serviceRoleKey: supabaseKey,
      })
    : sharedVoucherMemoryRepo;

  const emailChangeRepo = supabaseUrl && supabaseKey
    ? new CustomerEmailChangeSupabaseRepository({
        supabaseUrl,
        serviceRoleKey: supabaseKey,
      })
    : sharedEmailChangeMemoryRepo;

  const customerService = new CustomerService(customerRepo);
  const rateLimiterService = new RateLimiterService(customerRepo);
  const emailService = createTransactionalEmailService();
  const voucherService = new VoucherService(voucherRepo, customerRepo, emailService);
  const emailChangeService = new CustomerEmailChangeService(
    emailChangeRepo,
    customerRepo,
    rateLimiterService,
    emailService
  );

  return {
    customerRepo,
    voucherRepo,
    emailChangeRepo,
    customerService,
    rateLimiterService,
    voucherService,
    emailService,
    emailChangeService,
  };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1].trim();
  }
  return null;
}
