import { NextResponse } from 'next/server';
import { PaidRecoveryService, ReservationSupabaseRepository, DatabaseInterruptionError } from '@deskatlas/domain';
import { paidRecoveryReadSchema, paidRecoveryCommandSchema } from '@deskatlas/validation';
import { getCustomerServices } from '../../customer/_services';
import { trustedClientIp } from '../../../../server/customer-assistant/security';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, private' };

// MS83-R05: reference alone never authorizes a private recovery read or command.
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Open tracking on this website.' }, { status: 403, headers });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'JSON required.' }, { status: 415, headers });
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers });
    const raw: unknown = JSON.parse(text);
    const mutation = Boolean(raw && typeof raw === 'object' && 'remedy' in raw);
    const parsed = mutation ? paidRecoveryCommandSchema.safeParse(raw) : paidRecoveryReadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Enter your booking reference and registered email, and review the recovery details.' }, { status: 400, headers });
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey || !process.env.REWARDS_RATE_LIMIT_SECRET) throw new Error('Recovery unavailable');
    const { rateLimiterService } = getCustomerServices();
    const limit = await rateLimiterService.consumeTogether([
      { scope: 'PROMO_IP', subject: `recovery:${trustedClientIp(request)}` },
      { scope: 'PROMO_EMAIL', subject: `recovery:${parsed.data.customerEmail}` },
    ]);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many recovery attempts. Please try again later.' }, { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSeconds || 60) } });
    const service = new PaidRecoveryService(new ReservationSupabaseRepository({ supabaseUrl, serviceRoleKey }));
    const context = mutation ? await service.commit(parsed.data) : await service.read(parsed.data);
    return NextResponse.json({ context }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers });
    if (error instanceof DatabaseInterruptionError) return NextResponse.json({ error: 'The result could not be verified. Refresh tracking before trying another action.', outcomeUnknown: error.outcomeUnknown }, { status: 503, headers });
    // Database details and persisted private facts are never exposed in errors.
    return NextResponse.json({ error: 'Recovery could not be completed. Refresh tracking and availability. If this continues, contact support.' }, { status: 409, headers });
  }
}
