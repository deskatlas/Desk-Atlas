import { NextRequest, NextResponse } from 'next/server';
import {
  customerEmailVoucherSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { PromoValidationError } from '@deskatlas/domain';
import { getCustomerServices, getBearerToken } from '../_services';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const { customerService, rateLimiterService, voucherService, emailService } = getCustomerServices();

    const customer = await customerService.verifyAccessToken(token);
    if (!customer) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parseResult = customerEmailVoucherSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'voucher_id and request_id are required UUIDs' } },
        { status: 400 }
      );
    }

    const { voucher_id, request_id } = parseResult.data;

    // Distributed rate limits (ERD-E23):
    // 1 per customer/voucher per 5 minutes
    const voucherKey = `${customer.id}:${voucher_id}`;
    const voucherCheck = await rateLimiterService.checkAndRecord('EMAIL_VOUCHER', voucherKey, request_id);
    if (!voucherCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(voucherCheck.retryAfterSeconds || 300) },
      });
    }

    // 10 per customer per rolling hour
    const customerCheck = await rateLimiterService.checkAndRecord('EMAIL_CUSTOMER', customer.id, request_id);
    if (!customerCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(customerCheck.retryAfterSeconds || 3600) },
      });
    }

    const result = await voucherService.emailVoucher({
      customerId: customer.id,
      voucherId: voucher_id,
      requestId: request_id,
      emailService,
    });

    return NextResponse.json(
      createSuccessResponse({
        notification_id: result.notificationId,
        status: result.status,
      }),
      {
        status: 202,
        headers: {
          'Cache-Control': 'no-store, private',
        },
      }
    );
  } catch (error: unknown) {
    if (error instanceof PromoValidationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to email voucher' } },
      { status: 500 }
    );
  }
}
