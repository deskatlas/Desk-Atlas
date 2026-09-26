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

    const floors = await service.listPublishedFloors();
    if (floors.length === 0) {
      return NextResponse.json(
        { floors: [], published: null, error: 'No published floor map is available' },
        { status: 404 }
      );
    }
    const [published, allFloors] = await Promise.all([
      service.loadPublishedFloorMap(floorId, { audience: 'STAFF' }),
      includeAllFloors ? service.loadAllPublishedFloorMaps({ audience: 'STAFF' }) : Promise.resolve(undefined),
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
      return NextResponse.json({ error: error.message, floors: [], published: null }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : 'Unable to load published map';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
