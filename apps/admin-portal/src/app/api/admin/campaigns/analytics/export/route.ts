import { exportCampaignAnalytics, isCampaignAnalyticsRange } from '@deskatlas/domain';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCampaignAnalytics, analyticsForbidden, analyticsFailure } from '../_lib/analytics';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const service = await authorizeCampaignAnalytics(request);
    if (!service) return analyticsForbidden();
    const params = request.nextUrl.searchParams;
    const range = params.get('range') ?? '30d';
    const type = params.get('type') ?? 'summary';
    const format = params.get('format') ?? 'xlsx';
    if (!isCampaignAnalyticsRange(range) || (type !== 'summary' && type !== 'redemptions') || (format !== 'xlsx' && format !== 'csv')) {
      return NextResponse.json({ error: 'Invalid export options.' }, { status: 400 });
    }
    const report = await exportCampaignAnalytics(await service.getSnapshot(range), type, format);
    return new NextResponse(report.body, { headers: { 'Content-Type': report.contentType, 'Content-Disposition': `attachment; filename="${report.filename}"`, 'Cache-Control': 'no-store' } });
  } catch { return analyticsFailure(); }
}
