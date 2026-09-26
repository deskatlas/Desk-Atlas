import { NextRequest, NextResponse } from 'next/server';
import {
  PublishedMapNotFoundError,
  SupabasePublishedMapRepository,
  createPublishedMapService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const service = createPublishedMapService(new SupabasePublishedMapRepository());
    const floorId = request.nextUrl.searchParams.get('floorId') ?? undefined;
    const includeAllFloors = request.nextUrl.searchParams.get('includeAllFloors') === 'true';

    const [floors, published, allFloors] = await Promise.all([
      service.listPublishedFloors(),
      service.loadPublishedFloorMap(floorId, { audience: 'KIOSK' }),
      includeAllFloors ? service.loadAllPublishedFloorMaps({ audience: 'KIOSK' }) : Promise.resolve(undefined),
    ]);

    return NextResponse.json(
      {
        floors,
        published,
        ...(allFloors !== undefined ? { allFloors } : {}),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          'CDN-Cache-Control': 'public, s-maxage=3600',
        },
      }
    );
  } catch (error) {
    if (error instanceof PublishedMapNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : 'Unable to load published map';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
