import { NextRequest, NextResponse } from 'next/server';
import { getAdminWorkspaceService } from '../_lib/workspaceService';
import { workspaceErrorResponse } from '../_lib/errors';
import type { CreateFloorInput } from '@deskatlas/domain';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const service = getAdminWorkspaceService();
    const catalog = await service.listCatalog();
    return NextResponse.json({ floors: catalog.floors });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateFloorInput;
    const service = getAdminWorkspaceService();
    const floor = await service.createFloor(body);
    return NextResponse.json(floor, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    let floorId = url.searchParams.get('floorId');
    if (!floorId) {
      const body = await request.json().catch(() => ({}));
      floorId = body.floorId || body.id;
    }
    const service = getAdminWorkspaceService();
    const result = await service.deleteFloor(floorId || '', { actorRole: 'ADMIN', actorUserId: null });
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

