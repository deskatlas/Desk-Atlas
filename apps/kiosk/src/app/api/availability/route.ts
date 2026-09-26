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
    const occupiedNow = searchParams.get('occupiedNow') === 'true' || searchParams.get('scope') === 'occupied_now';
    const upcoming = searchParams.get('upcoming') === 'true' || searchParams.get('nextReservation') === 'true';

    const CACHE_HEADERS = {
      'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
    };

    if (upcoming) {
      const result = await service.getNextUpcomingBooking(workspaceInstanceId, nowIso);
      return NextResponse.json(result, { headers: CACHE_HEADERS });
    }

    if (occupiedNow) {
      const result = await service.listOccupiedInstances({
        nowIso,
        durationMinutes: !isNaN(durationMinutes) && durationMinutes > 0 ? durationMinutes : undefined,
      });
      return NextResponse.json(result, { headers: CACHE_HEADERS });
    }

    if (templateId) {
      const result = await service.listTemplateAvailability({
        templateId,
        date: searchParams.get('date') ?? '',
        durationMinutes,
        startTime: searchParams.get('startTime') ?? undefined,
        nowIso,
      });
      return NextResponse.json(result, { headers: CACHE_HEADERS });
    }

    if (searchParams.has('date')) {
      const result = await service.listTimeAvailability({
        workspaceInstanceId,
        date: searchParams.get('date') ?? '',
        durationMinutes,
        nowIso,
      });
      return NextResponse.json(result, { headers: CACHE_HEADERS });
    }

    const result = await service.listDateAvailability({
      workspaceInstanceId,
      startDate: searchParams.get('startDate') ?? '',
      endDate: searchParams.get('endDate') ?? '',
      durationMinutes,
      nowIso,
    });
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    if (error instanceof AvailabilityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Unable to load availability';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
