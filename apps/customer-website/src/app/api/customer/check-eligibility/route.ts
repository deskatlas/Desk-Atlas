import { NextRequest, NextResponse } from 'next/server';
import {
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { getCustomerServices, getBearerToken } from '../_services';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const { customerService, rateLimiterService, voucherService } = getCustomerServices();

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

    const eligibility = await voucherService.checkEligibility(customer.id);

    return NextResponse.json(
      createSuccessResponse({
        new_vouchers: eligibility.newVouchers.map((v) => ({
          id: v.id,
          promo_code: v.promoCode,
          status: v.status,
          campaign_name_snapshot: v.campaignNameSnapshot,
          reward_snapshot: v.rewardSnapshot,
          issued_at: v.issuedAt,
          expires_at: v.expiresAt,
        })),
        existing_vouchers: eligibility.existingVouchers.map((v) => ({
          id: v.id,
          promo_code: v.promoCode,
          status: v.status,
          campaign_name_snapshot: v.campaignNameSnapshot,
          reward_snapshot: v.rewardSnapshot,
          issued_at: v.issuedAt,
          expires_at: v.expiresAt,
          redeemed_at: v.redeemedAt || null,
          redeemed_discount_amount: v.redeemedDiscountAmount || null,
        })),
        progress: eligibility.progress.map((p) => ({
          campaign_id: p.campaignId,
          rule_id: p.ruleId,
          label: p.label,
          combine: p.combine,
          conditions: p.conditions.map((c) => ({
            metric: c.metric,
            current: c.current,
            threshold: c.threshold,
            remaining: c.remaining,
          })),
          next_milestone: p.nextMilestone,
          completed: p.completed,
        })),
        reconciliation_pending: eligibility.reconciliationPending,
        server_now: eligibility.serverNow,
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
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to check rewards eligibility' } },
      { status: 500 }
    );
  }
}
