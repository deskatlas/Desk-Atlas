import { NextRequest, NextResponse } from 'next/server';
import {
  AvailabilityValidationError,
  SupabaseAvailabilityRepository,
  createAvailabilityService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const service = createAvailabilityService(new SupabaseAvailabilityRepository());
    const searchParams = request.nextUrl.searchParams;
    const templateId = searchParams.get('templateId');
    const workspaceInstanceId = searchParams.get('workspaceInstanceId') ?? '';
    const durationMinutes = Number(searchParams.get('durationMinutes') ?? '');
    const nowIso = searchParams.get('nowIso') ?? undefined;
    const channelParam = searchParams.get('channel') as 'ONLINE' | 'KIOSK' | null;
    const channel: 'ONLINE' | 'KIOSK' = channelParam || 'ONLINE';
    const minimumLeadMinutes = searchParams.has('minimumLeadMinutes')
      ? Number(searchParams.get('minimumLeadMinutes'))
      : (channel === 'ONLINE' ? 30 : 0);

    if (templateId) {
      const result = await service.listTemplateAvailability({
        templateId,
        date: searchParams.get('date') ?? '',
        durationMinutes,
        startTime: searchParams.get('startTime') ?? undefined,
        nowIso,
        channel,
        minimumLeadMinutes,
      });
      return NextResponse.json(result);
    }

    if (searchParams.has('date')) {
      const result = await service.listTimeAvailability({
        workspaceInstanceId,
        date: searchParams.get('date') ?? '',
        durationMinutes,
        nowIso,
        channel,
        minimumLeadMinutes,
      });
      return NextResponse.json(result);
    }

    const result = await service.listDateAvailability({
      workspaceInstanceId,
      startDate: searchParams.get('startDate') ?? '',
      endDate: searchParams.get('endDate') ?? '',
      durationMinutes,
      nowIso,
      channel,
      minimumLeadMinutes,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AvailabilityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Unable to load availability';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
