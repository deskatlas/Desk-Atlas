import { NextResponse } from "next/server";
import { getAdminDashboardService } from "../_lib/dashboardService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = getAdminDashboardService();
    const summary = await service.getCurrentOccupancySummary();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load current occupancy summary.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
