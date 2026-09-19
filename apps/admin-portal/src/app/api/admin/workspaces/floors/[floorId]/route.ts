import { NextResponse } from 'next/server';
import { getAdminWorkspaceService } from '../../_lib/workspaceService';
import { workspaceErrorResponse } from '../../_lib/errors';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ floorId: string }> }
) {
  try {
    const { floorId } = await context.params;
    const result = await getAdminWorkspaceService().deleteFloor(floorId, {
      actorRole: 'ADMIN',
      actorUserId: null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
