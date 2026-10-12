import { NextRequest, NextResponse } from 'next/server';
import {
  customerEmailVoucherStatusSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@deskatlas/validation';
import { getCustomerServices, getBearerToken } from '../../_services';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const { customerService, voucherService } = getCustomerServices();

    const customer = await customerService.verifyAccessToken(token);
    if (!customer) {
      return NextResponse.json(createErrorResponse('ACCESS_EXPIRED'), { status: 401 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const parseResult = customerEmailVoucherStatusSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'notification_id is required' } },
        { status: 400 }
      );
    }

    const { notification_id } = parseResult.data;
    const result = await voucherService.getNotificationStatus(notification_id, customer.id);

    return NextResponse.json(
      createSuccessResponse({
        status: result.status,
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
      { error: { code: 'NOT_FOUND', message: 'Notification not found' } },
      { status: 404 }
    );
  }
}
