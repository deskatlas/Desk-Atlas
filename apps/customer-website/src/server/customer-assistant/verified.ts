// MS78-R01/R03: server-only private authority, bounded safe context and final rechecks.
import {
  CustomerAssistanceService, CustomerAssistanceSupabaseRepository,
  type CustomerAssistanceContext,
} from '@deskatlas/domain';
import { getCustomerServices, getBearerToken } from '../../app/api/customer/_services';

if (typeof window !== 'undefined') throw new Error('Server-only customer assistance');

export class VerifiedCustomerError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly retryAfterSeconds?: number) { super(code); }
}

export async function authorizeVerifiedCustomer(request: Request, query = false) {
  if (process.env.NODE_ENV === 'production' && !process.env.REWARDS_RATE_LIMIT_SECRET) throw new VerifiedCustomerError('ASSISTANT_UNAVAILABLE', 503);
  const token = getBearerToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new VerifiedCustomerError('ACCESS_EXPIRED', 401);
  const { customerService, rateLimiterService } = getCustomerServices();
  const customer = await customerService.verifyAccessToken(token, undefined, 'REWARDS_AND_ASSISTANT_ACCESS');
  if (!customer) {
    const rewardsOnly = await customerService.verifyAccessToken(token);
    throw new VerifiedCustomerError(rewardsOnly ? 'ASSISTANT_VERIFICATION_REQUIRED' : 'ACCESS_EXPIRED', rewardsOnly ? 403 : 401);
  }
  const admitted = await rateLimiterService.consumeTogether(query
    ? [{ scope: 'CUSTOMER_TOKEN', subject: token }, { scope: 'ASSISTANT_TOKEN', subject: token }]
    : [{ scope: 'CUSTOMER_TOKEN', subject: token }]);
  if (!admitted.allowed) throw new VerifiedCustomerError('RATE_LIMITED', 429, admitted.retryAfterSeconds);
  const reauthorize = async () => {
    const current = await customerService.verifyAccessToken(token, undefined, 'REWARDS_AND_ASSISTANT_ACCESS');
    if (!current || current.id !== customer.id) throw new VerifiedCustomerError('ACCESS_EXPIRED', 401);
  };
  return { customerId: customer.id, reauthorize };
}

export function getCustomerAssistanceService(signal?: AbortSignal) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new VerifiedCustomerError('ASSISTANT_UNAVAILABLE', 503);
  return new CustomerAssistanceService(new CustomerAssistanceSupabaseRepository({ supabaseUrl, serviceRoleKey, signal }));
}

export function customerFactSummary(context: CustomerAssistanceContext): string {
  const f = context.facts;
  const label = (code: string) => code === 'UNKNOWN' ? 'unavailable' : code.toLowerCase().replaceAll('_', ' ');
  const eligibility = (v: boolean | 'UNKNOWN') => v === 'UNKNOWN' ? 'eligibility unavailable' : v ? 'available for review' : 'not currently eligible';
  const reasons: Record<string, string> = {
    STATUS_NOT_CONFIRMED: 'the reservation is not confirmed', ALREADY_CHECKED_IN: 'check-in has already occurred',
    COMPLETED: 'the reservation is completed', NO_SCHEDULE: 'a confirmed schedule is unavailable',
    START_PASSED: 'the scheduled start has passed', CUTOFF_PASSED: 'the current cutoff has passed',
    RESCHEDULE_USED: 'the self-service reschedule has already been used',
  };
  const format = (date: string) => {
    if (context.business_timezone) {
      try { return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: context.business_timezone }).format(new Date(date))} (${context.business_timezone})`; } catch { /* Keep the exact UTC timestamp. */ }
    }
    return new Date(date).toISOString();
  };
  const lines = [`Reservation status: ${label(f.status)}. Payment status: ${label(f.payment_status)}.`];
  if (f.workspace) lines.push(`Assigned workspace: ${f.workspace}.`);
  if (f.start_at && f.end_at) lines.push(`Schedule: ${format(f.start_at)} to ${format(f.end_at)}.`);
  lines.push(`Cancellation: ${eligibility(f.cancel)}${f.cancel === false && reasons[f.cancel_reason] ? ` because ${reasons[f.cancel_reason]}` : ''}.`);
  lines.push(`Rescheduling: ${eligibility(f.reschedule)}${f.reschedule === false && reasons[f.reschedule_reason] ? ` because ${reasons[f.reschedule_reason]}` : ''}.`);
  lines.push(`Relocation: ${eligibility(f.relocation)}.`);
  if (f.recovery === 'REVIEW_REQUIRED') lines.push('A workspace change requires review through the existing booking workflow.');
  return lines.join('\n');
}

// A bounded refresh: callers may compose again once; a second change releases no actions.
export async function prepareVerifiedAnswer(
  auth: Awaited<ReturnType<typeof authorizeVerifiedCustomer>>,
  selectedId?: string,
  filter: 'UPCOMING' | 'HISTORY' = 'UPCOMING',
  compose?: (facts: CustomerAssistanceContext['facts']) => Promise<void>,
  signal?: AbortSignal,
) {
  const service = getCustomerAssistanceService(signal);
  const resolved = await service.resolve(auth.customerId, selectedId, filter);
  if (resolved.kind !== 'CONTEXT') { await auth.reauthorize(); return resolved; }
  let context = resolved.context;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (compose) await compose(context.facts);
    const check = await service.revalidate(auth.customerId, context);
    await auth.reauthorize();
    if (check.kind === 'RESERVATION_UNAVAILABLE') return check;
    if (check.kind === 'CURRENT') return { kind: 'CONTEXT' as const, context: check.context, summary: customerFactSummary(check.context) };
    context = check.context;
  }
  return { kind: 'BOOKING_CHANGED' as const };
}
