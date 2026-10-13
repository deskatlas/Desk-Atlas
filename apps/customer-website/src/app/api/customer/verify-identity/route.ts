import { NextRequest, NextResponse } from 'next/server';
import {
  customerVerifyIdentitySchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { customerVerifyRateLimiter } from '@deskatlas/domain';
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
    const identifier = `${customer_code.trim().toUpperCase()}:${email.trim().toLowerCase()}`;

    // Check anti-brute-force rate limit
    const rateCheck = customerVerifyRateLimiter.checkRateLimit('customer', identifier, ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many failed verification attempts. Please try again in 5 minutes.',
            retryAfterSeconds: rateCheck.retryAfterSeconds,
            lockedUntil: rateCheck.lockedUntil,
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds || 60),
          },
        }
      );
    }

    const { customerService } = getCustomerServices();
    const verification = await customerService.createAccessChallenge(customer_code, email);

    if (!verification) {
      const failResult = customerVerifyRateLimiter.recordFailedAttempt('customer', identifier, ip);
      if (failResult.locked) {
        return NextResponse.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many failed verification attempts. Please try again in 5 minutes.',
              retryAfterSeconds: failResult.retryAfterSeconds,
              lockedUntil: failResult.lockedUntil,
            },
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(failResult.retryAfterSeconds || 60),
            },
          }
        );
      }

      return NextResponse.json(
        createErrorResponse(
          'MISMATCH_VERIFICATION',
          'Customer ID and email do not match our records. Please check and try again.'
        ),
        { status: 401 }
      );
    }

    // Reset rate limiter on successful identity verification
    customerVerifyRateLimiter.recordSuccessfulLogin('customer', identifier, ip);

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
