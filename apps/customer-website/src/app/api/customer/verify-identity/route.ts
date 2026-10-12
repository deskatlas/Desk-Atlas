import { NextRequest, NextResponse } from 'next/server';
import {
  customerVerifyIdentitySchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { getCustomerServices, getClientIp } from '../_services';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parseResult = customerVerifyIdentitySchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        createErrorResponse('MISMATCH_VERIFICATION', 'Customer ID and email do not match our records. Please check and try again.'),
        { status: 400 }
      );
    }

    const { customer_code, email } = parseResult.data;
    const ip = getClientIp(request);
    const { customerService, rateLimiterService } = getCustomerServices();

    // Check rate limits for IP and email
    const ipCheck = await rateLimiterService.checkAndRecord('VERIFY_IP', ip);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        createErrorResponse('RATE_LIMITED'),
        {
          status: 429,
          headers: { 'Retry-After': String(ipCheck.retryAfterSeconds || 60) },
        }
      );
    }

    const emailCheck = await rateLimiterService.checkAndRecord('VERIFY_EMAIL', email);
    if (!emailCheck.allowed) {
      return NextResponse.json(
        createErrorResponse('RATE_LIMITED'),
        {
          status: 429,
          headers: { 'Retry-After': String(emailCheck.retryAfterSeconds || 60) },
        }
      );
    }

    const verification = await customerService.createAccessChallenge(customer_code, email);
    if (!verification) {
      return NextResponse.json(
        createErrorResponse(
          'MISMATCH_VERIFICATION',
          'Customer ID and email do not match our records. Please check and try again.'
        ),
        { status: 401 }
      );
    }

    return NextResponse.json(
      createSuccessResponse({
        access_token: verification.accessToken,
        expires_at: verification.expiresAt,
        customer: {
          customer_code: verification.customer.customerCode,
          first_name: verification.customer.firstName,
          last_name: verification.customer.lastName,
          created_at: verification.customer.createdAt,
        },
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
      createErrorResponse('MISMATCH_VERIFICATION', 'Customer ID and email do not match our records. Please check and try again.'),
      { status: 401 }
    );
  }
}
