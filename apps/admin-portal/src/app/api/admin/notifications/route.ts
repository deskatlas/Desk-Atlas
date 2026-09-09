import { NextRequest, NextResponse } from "next/server";
import { getAdminNotificationService } from "./_lib/notificationService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;

    const service = getAdminNotificationService();
    const result = await service.listNotifications(safeLimit);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
