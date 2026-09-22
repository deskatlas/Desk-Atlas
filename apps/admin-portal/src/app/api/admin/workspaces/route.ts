import { NextResponse } from 'next/server';
import { getAdminWorkspaceService } from './_lib/workspaceService';
import { workspaceErrorResponse } from './_lib/errors';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const service = getAdminWorkspaceService();
    const [spaces, catalog, mapPlacedInstanceIds] = await Promise.all([
      service.listAdminSpaces(),
      service.listCatalog(),
      service.getMapPlacedInstanceIds(),
    ]);
    return NextResponse.json({
      spaces,
      templates: catalog.templates,
      floors: catalog.floors,
      instances: catalog.instances,
      mapPlacedInstanceIds: Array.from(mapPlacedInstanceIds),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
