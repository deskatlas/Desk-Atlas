import { NextRequest, NextResponse } from 'next/server';
import {
  validatePromoSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { PromoValidationError } from '@deskatlas/domain';
import { getCustomerServices, getClientIp } from '../../customer/_services';

export const runtime = 'nodejs';

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
    const { rateLimiterService, voucherService } = getCustomerServices();

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

    // Extract main candidate to estimate base gross price
    const mainCandidate = booking_context.candidates.find((c) => c.rank === 0);
    if (!mainCandidate) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Main candidate is required in booking context' } },
        { status: 400 }
      );
    }

    // Calculate gross duration / price
    const start = new Date(mainCandidate.startAt);
    const end = new Date(mainCandidate.endAt);
    const durationHours = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
    // Default hourly base amount estimate if catalog not loaded
    const baseHourlyRate = 50; // standard hourly rate default
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
