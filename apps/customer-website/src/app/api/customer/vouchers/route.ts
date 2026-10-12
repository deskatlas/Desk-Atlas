import { NextRequest, NextResponse } from 'next/server';
import {
  customerVouchersQuerySchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { getEffectiveVoucherStatus } from '@deskatlas/domain';
import { getCustomerServices, getBearerToken } from '../_services';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const { customerService, rateLimiterService, voucherRepo } = getCustomerServices();

    const customer = await customerService.verifyAccessToken(token);
    if (!customer) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const tokenCheck = await rateLimiterService.checkAndRecord('CUSTOMER_TOKEN', token);
    if (!tokenCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(tokenCheck.retryAfterSeconds || 60) },
      });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parseResult = customerVouchersQuerySchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Status must be AVAILABLE, USED, or EXPIRED' } },
        { status: 400 }
      );
    }

    const { status, limit } = parseResult.data;
    const now = new Date();

    // Fetch all vouchers for customer and compute effective status
    const allVouchers = await voucherRepo.findVouchersByCustomerId(customer.id);
    const matching = allVouchers
      .map((v) => ({
        ...v,
        effectiveStatus: getEffectiveVoucherStatus(v, now),
      }))
      .filter((v) => v.effectiveStatus === status);

    const paginated = matching.slice(0, limit);

    const items = paginated.map((v) => ({
      id: v.id,
      promo_code: v.promoCode,
      status: v.effectiveStatus,
      campaign_name_snapshot: v.campaignNameSnapshot,
      reward_snapshot: v.rewardSnapshot,
      issued_at: v.issuedAt,
      expires_at: v.expiresAt,
      redeemed_at: v.redeemedAt || v.redeemed_at || null,
      redeemed_reservation_id: v.redeemedReservationId || v.redeemed_reservation_id || null,
      redeemed_discount_amount: v.redeemedDiscountAmount ?? v.redeemed_discount_amount ?? null,
    }));

    return NextResponse.json(
      createSuccessResponse({
        items,
        next_cursor: null,
        server_now: now.toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to retrieve vouchers' } },
      { status: 500 }
    );
  }
}
