import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailChangeOtpSchema } from '@deskatlas/validation';
import { RateLimitedError, EmailChangeError } from '@deskatlas/domain';
import { getCustomerServices, getClientIp } from '../../_services';

export const runtime = 'nodejs';

const responseHeaders = {
  'Cache-Control': 'no-store, private',
};

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    const protoHeader = request.headers.get('x-forwarded-proto');
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost || request.headers.get('host');
    let proto = protoHeader || (url.protocol ? url.protocol.replace(':', '') : 'http');
    if (!protoHeader && host && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(host)) {
      proto = 'https';
    }
    const requestOrigin = host ? `${proto}://${host}` : url.origin;

    if (origin && origin !== requestOrigin && origin !== url.origin && origin !== `${url.protocol}//${host}`) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Cross-origin request forbidden.' } },
        { status: 403, headers: responseHeaders }
      );
    }

    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
      return NextResponse.json(
        { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' } },
        { status: 415, headers: responseHeaders }
      );
    }

    const text = await request.text();
    if (text.length > 2048) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' } },
        { status: 413, headers: responseHeaders }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Invalid JSON payload' } },
        { status: 400, headers: responseHeaders }
      );
    }

    const parseResult = verifyEmailChangeOtpSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: parseResult.error.errors[0]?.message || 'Invalid verification code format.',
          },
        },
        { status: 400, headers: responseHeaders }
      );
    }

    const clientIp = getClientIp(request);
    const { emailChangeService } = getCustomerServices();

    const result = await emailChangeService.verifyOtp({
      email: parseResult.data.email,
      otp: parseResult.data.otp,
      clientIp,
    });

    return NextResponse.json(
      {
        data: {
          customer_code: result.customerCode,
          verification_token: result.verificationToken,
        },
      },
      { status: 200, headers: responseHeaders }
    );
  } catch (err: unknown) {
    if (err instanceof RateLimitedError) {
      const retryAfterSeconds = err.retryAfterSeconds || 300;
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many verification attempts. Please try again in a few minutes.',
            retryAfterSeconds,
          },
        },
        {
          status: 429,
          headers: {
            ...responseHeaders,
            'Retry-After': String(retryAfterSeconds),
          },
        }
      );
    }

    if (err instanceof EmailChangeError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, ...err.details } },
        { status: 400, headers: responseHeaders }
      );
    }

    console.error('[VerifyOtpRoute] Internal error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' } },
      { status: 500, headers: responseHeaders }
    );
  }
}

