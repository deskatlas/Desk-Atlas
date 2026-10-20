import { exportPromoAnalytics, isPromoAnalyticsRange } from '@deskatlas/domain';
import { NextRequest, NextResponse } from 'next/server';
import {
  authorizePromoAnalytics,
  promoAnalyticsForbidden,
  promoAnalyticsFailure,
} from '../_lib/analytics';

export const runtime = 'nodejs';

// MS-74: PRD-F15, PRD-F25, SDD-C11, QAD-TC43.9.
export async function GET(request: NextRequest) {
  try {
    const service = await authorizePromoAnalytics(request);
    if (!service) return promoAnalyticsForbidden();

    const params = request.nextUrl.searchParams;
    const range = params.get('range') ?? '30d';
    const type = params.get('type') ?? 'summary';
    const format = params.get('format') ?? 'xlsx';

    if (
      !isPromoAnalyticsRange(range) ||
      (type !== 'summary' && type !== 'bookings') ||
      (format !== 'xlsx' && format !== 'csv')
    ) {
      return NextResponse.json({ error: 'Invalid export options.' }, { status: 400 });
    }

    const report = await exportPromoAnalytics(await service.getSnapshot(range), type, format);
    const body = typeof report.body === 'string' ? report.body : Buffer.from(report.body);
    return new NextResponse(body, {
      headers: {
        'Content-Type': report.contentType,
        'Content-Disposition': `attachment; filename="${report.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return promoAnalyticsFailure();
  }
}
