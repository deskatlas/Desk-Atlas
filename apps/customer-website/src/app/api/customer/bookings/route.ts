import { NextRequest, NextResponse } from 'next/server';
import {
  customerBookingsQuerySchema,
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

    const { customerService, rateLimiterService, voucherRepo } = getCustomerServices();

    // Verify Bearer token
    const customer = await customerService.verifyAccessToken(token);
    if (!customer) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    // Rate limit: 60 protected requests per token per minute
    const tokenCheck = await rateLimiterService.checkAndRecord('CUSTOMER_TOKEN', token);
    if (!tokenCheck.allowed) {
      return NextResponse.json(createErrorResponse('RATE_LIMITED'), {
        status: 429,
        headers: { 'Retry-After': String(tokenCheck.retryAfterSeconds || 60) },
      });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parseResult = customerBookingsQuerySchema.safeParse(rawBody);
    const limit = parseResult.success ? parseResult.data.limit : 20;
    const cursor = parseResult.success ? parseResult.data.cursor : undefined;

    // Get qualifying booking facts count
    const facts = await voucherRepo.listQualifyingFactsForCustomer(customer.id);
    const qualifying_booking_count = facts.length;

    let items: Array<{
      id: string;
      reference_code: string;
      source: string;
      status: string;
      start_at: string;
      end_at: string;
      workspace_name?: string | null;
      amount_due: number;
      currency: string;
      created_at: string;
      is_pre_cutover: boolean;
    }> = [];

    if (voucherRepo.findCustomerReservations) {
      items = await voucherRepo.findCustomerReservations(customer.id, limit);
    }

    return NextResponse.json(
      createSuccessResponse({
        items,
        next_cursor: null,
        qualifying_booking_count,
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
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to retrieve bookings' } },
      { status: 500 }
    );
  }
}
