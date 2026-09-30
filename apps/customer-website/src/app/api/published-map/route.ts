import { NextRequest, NextResponse } from 'next/server';
import {
  PublishedMapNotFoundError,
  SupabasePublishedMapRepository,
  createPublishedMapService,
} from '@deskatlas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const service = createPublishedMapService(new SupabasePublishedMapRepository());
    const floorId = request.nextUrl.searchParams.get('floorId') ?? undefined;
    const includeAllFloors = request.nextUrl.searchParams.get('includeAllFloors') === 'true';

    const [floors, published, allFloors] = await Promise.all([
      service.listPublishedFloors(),
      service.loadPublishedFloorMap(floorId, { audience: 'CUSTOMER' }),
      includeAllFloors ? service.loadAllPublishedFloorMaps({ audience: 'CUSTOMER' }) : Promise.resolve(undefined),
    ]);

    return NextResponse.json(
      {
        floors,
        published,
        ...(allFloors !== undefined ? { allFloors } : {}),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=60',
          'CDN-Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
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
