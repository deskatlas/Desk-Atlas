import { NextResponse } from 'next/server';
import { customerAssistanceReservationsSchema } from '@deskatlas/validation';
import { authorizeVerifiedCustomer, getCustomerAssistanceService, VerifiedCustomerError } from '../../../../server/customer-assistant/verified';
import { customerRequestBody, CustomerAssistantError } from '../../../../server/customer-assistant/security';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, private', Vary: 'Authorization, Origin' };

// MS78-R02: one bounded page, current combined-purpose authorization on every read.
export async function POST(request: Request) {
  try {
    const body = await customerRequestBody(request);
    const auth = await authorizeVerifiedCustomer(request);
    if (process.env.CUSTOMER_ASSISTANT_VERIFIED_ENABLED !== 'true') throw new VerifiedCustomerError('ASSISTANT_UNAVAILABLE', 503);
    const parsed = customerAssistanceReservationsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: { code: 'INVALID_INPUT' } }, { status: 400, headers });
    const data = await getCustomerAssistanceService(request.signal).list(auth.customerId, parsed.data.filter, parsed.data.cursor);
    await auth.reauthorize();
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    if (error instanceof CustomerAssistantError) return NextResponse.json({ error: { code: error.code } }, { status: error.status, headers });
    if (error instanceof VerifiedCustomerError) return NextResponse.json({ error: { code: error.code,
      message: error.status === 403 ? 'Verify Customer ID and email to enable private assistance.'
        : error.status === 503 ? 'Reservation assistance is temporarily unavailable.'
        : error.status === 429 ? 'Too many requests. Please try again later.'
        : error.status === 413 ? 'Request is too large.' : 'Re-enter Customer ID and registered email to continue.' } },
      { status: error.status, headers: { ...headers, ...(error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {}) } });
    if (error instanceof SyntaxError || error instanceof Error && error.name === 'ZodError') return NextResponse.json({ error: { code: 'INVALID_INPUT' } }, { status: 400, headers });
    return NextResponse.json({ error: { code: 'ASSISTANT_UNAVAILABLE' } }, { status: 503, headers });
  }
}
