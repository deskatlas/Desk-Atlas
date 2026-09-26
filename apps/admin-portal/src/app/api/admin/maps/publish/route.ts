import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAdminMapService } from '../_lib/mapService';
import { mapErrorResponse } from '../_lib/errors';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await getAdminMapService().publishDraft({
      floorId: body.floorId,
      actorUserId: body.actorUserId ?? null,
    });
    try {
      revalidateTag('published-map', 'max');
    } catch {
      // Ignore if revalidateTag is called outside of Next request context in tests
    }
    return NextResponse.json(result);
  } catch (error) {
    return mapErrorResponse(error);
  }
}
