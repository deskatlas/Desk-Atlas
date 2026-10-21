import { NextRequest, NextResponse } from 'next/server';
import {
  customerVerifyIdentitySchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { customerVerifyRateLimiter } from '@deskatlas/domain';
import { getCustomerServices } from '../_services';
import { trustedClientIp as getClientIp } from '../../../../server/customer-assistant/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const response = await verifyIdentity(request);
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

async function verifyIdentity(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    const host = request.headers.get('host');
    const requestOrigin = host ? `${url.protocol}//${host}` : url.origin;
    if (origin && origin !== requestOrigin) return NextResponse.json(createErrorResponse('FORBIDDEN', 'Open verification from this website and try again.'), { status: 403 });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return NextResponse.json(createErrorResponse('INVALID_INPUT'), { status: 415 });
    const rawBody = await request.json();
    const parseResult = customerVerifyIdentitySchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        createErrorResponse('MISMATCH_VERIFICATION', 'Customer ID and email do not match our records. Please check and try again.'),
        { status: 400 }
      );
    }

    const { customer_code, email, access_intent } = parseResult.data;
    const ip = getClientIp(request);
    const identifier = `${customer_code.trim().toUpperCase()}:${email.trim().toLowerCase()}`;

    // MS78-TC17: shared counters include every valid-shaped attempt, including successes.
    // The existing local lockout remains an additional UI compatibility safeguard.
    if (process.env.NODE_ENV === 'production' && (!process.env.REWARDS_RATE_LIMIT_SECRET || !(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
      return NextResponse.json(createErrorResponse('UNAVAILABLE', 'Verification is temporarily unavailable.'), { status: 503 });
    }
    const { customerService, rateLimiterService } = getCustomerServices();
    const sharedLimit = await rateLimiterService.consumeTogether([
      { scope: 'VERIFY_IP', subject: ip }, { scope: 'VERIFY_EMAIL', subject: email },
    ]);
    if (!sharedLimit.allowed) {
      const retryAfterSeconds = sharedLimit.retryAfterSeconds || 900;
      return NextResponse.json({ error: {
        code: 'RATE_LIMITED', message: 'Too many verification attempts. Please try again later.',
        retryAfterSeconds, lockedUntil: Date.now() + retryAfterSeconds * 1000,
      } }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store, private' } });
    }

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

    const purpose = access_intent === 'REWARDS_AND_ASSISTANT' ? 'REWARDS_AND_ASSISTANT_ACCESS' : 'REWARDS_ACCESS';
    const verification = await customerService.createAccessChallenge(customer_code, email, purpose);

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
        purpose,
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
  } catch (error) {
    if (!(error instanceof SyntaxError)) return NextResponse.json(
      createErrorResponse('UNAVAILABLE', 'Verification is temporarily unavailable.'),
      { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
    );
    return NextResponse.json(
      createErrorResponse('MISMATCH_VERIFICATION', 'Customer ID and email do not match our records. Please check and try again.'),
      { status: 401 }
    );
  }
}
