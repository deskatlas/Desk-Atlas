import { NextResponse } from "next/server";
import { getAdminWorkspaceService } from "../../workspaces/_lib/workspaceService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = getAdminWorkspaceService();
    const catalog = await service.listCatalog();
    const maintenanceInstances = catalog.instances.filter(
      (inst) => inst.operationalStatus === "MAINTENANCE"
    );
    return NextResponse.json(maintenanceInstances);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load maintenance workspaces";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
