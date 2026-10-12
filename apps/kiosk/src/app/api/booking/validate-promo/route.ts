import { NextRequest, NextResponse } from 'next/server';
import {
  validatePromoSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import {
  CustomerMemoryRepository,
  CustomerSupabaseRepository,
  VoucherMemoryRepository,
  VoucherSupabaseRepository,
  RateLimiterService,
  VoucherService,
  PromoValidationError,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

const sharedCustomerMemoryRepo = new CustomerMemoryRepository();
const sharedVoucherMemoryRepo = new VoucherMemoryRepository();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const parseResult = validatePromoSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        createErrorResponse('PROMO_INVALID', 'Invalid promo code. Please check and try again.'),
        { status: 400 }
      );
    }

    const { promo_code, email, booking_context } = parseResult.data;
    const ip = getClientIp(request);

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

    const rateLimiterService = new RateLimiterService(customerRepo);
    const voucherService = new VoucherService(voucherRepo, customerRepo);

    // Rate limits: 10 promo validations per hashed IP and email per minute
    const ipCheck = await rateLimiterService.checkAndRecord('PROMO_IP', ip);
    if (!ipCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(ipCheck.retryAfterSeconds || 60) },
      });
    }

    const emailCheck = await rateLimiterService.checkAndRecord('PROMO_EMAIL', email);
    if (!emailCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(emailCheck.retryAfterSeconds || 60) },
      });
    }

    const mainCandidate = booking_context.candidates.find((c) => c.rank === 0);
    if (!mainCandidate) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Main candidate is required in booking context' } },
        { status: 400 }
      );
    }

    const start = new Date(mainCandidate.startAt);
    const end = new Date(mainCandidate.endAt);
    const durationHours = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
    const baseHourlyRate = 50;
    const computedGross = Math.round(durationHours * baseHourlyRate * 100) / 100;
    const estimatedGross = typeof booking_context.grossAmount === 'number' && booking_context.grossAmount > 0
      ? booking_context.grossAmount
      : computedGross;

    const result = await voucherService.validatePromoForBooking({
      promoCode: promo_code,
      email,
      channel: booking_context.channel,
      grossAmount: estimatedGross,
      now: new Date(),
    });

    return NextResponse.json(
      createSuccessResponse({
        gross_amount: result.grossAmount,
        discount_amount: result.discountAmount,
        amount_due: result.amountDue,
        currency: 'PHP',
        terms: result.terms,
        server_now: result.serverNow,
      }),
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
        },
      }
    );
  } catch (error: unknown) {
    if (error instanceof PromoValidationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      createErrorResponse('PROMO_INVALID', 'Invalid promo code. Please check and try again.'),
      { status: 400 }
    );
  }
}
