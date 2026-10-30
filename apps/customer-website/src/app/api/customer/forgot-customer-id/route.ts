import { NextRequest, NextResponse } from 'next/server';
import { forgotCustomerIdSchema } from '@deskatlas/validation';
import { resolveCustomerRewardsPortalUrl } from '@deskatlas/domain';
import { getCustomerServices } from '../_services';

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

    const parseResult = forgotCustomerIdSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: parseResult.error.errors[0]?.message || 'Please enter a valid email address.',
          },
        },
        { status: 400, headers: responseHeaders }
      );
    }

    const { email } = parseResult.data;
    const normalizedEmail = email.trim().toLowerCase();

    const { customerRepo, rateLimiterService, emailService } = getCustomerServices();

    // Consume rate limit for customer ID recovery (2 per 24 hours per email)
    const limitCheck = await rateLimiterService.checkAndRecord('CUSTOMER_ID_RECOVERY', normalizedEmail);
    if (!limitCheck.allowed) {
      const retryAfterSeconds = limitCheck.retryAfterSeconds || 86400;
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'You have reached the maximum limit of 2 Customer ID recovery requests for today. Please check your inbox or try again tomorrow.',
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

    // Lookup customer by email (zero mutation invariant)
    const customer = await customerRepo.findCustomerByEmail(normalizedEmail);
    if (customer) {
      const rewardsPortalUrl = resolveCustomerRewardsPortalUrl(undefined, requestOrigin);
      await emailService.sendCustomerIdReminderEmail({
        to: customer.email,
        customerCode: customer.customerCode,
        customerFirstName: customer.firstName,
        customerLastName: customer.lastName,
        customerEmail: customer.email,
        rewardsPortalUrl,
      });
    }

    // Anti-enumeration: identical response regardless of whether email exists
    return NextResponse.json(
      {
        success: true,
        message: 'If this email address is registered with DeskAtlas, your Customer ID has been sent.',
      },
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: errorMsg } },
      { status: 500, headers: responseHeaders }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } },
    { status: 405, headers: responseHeaders }
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } },
    { status: 405, headers: responseHeaders }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } },
    { status: 405, headers: responseHeaders }
  );
}

