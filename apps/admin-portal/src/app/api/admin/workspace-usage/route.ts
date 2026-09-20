import { NextRequest, NextResponse } from "next/server";
import { getAdminWorkspaceUsageService } from "./_lib/workspaceUsageService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get("limit");
    const rangeParam = searchParams.get("range");
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;

    const limit =
      limitParam === "all"
        ? "all"
        : limitParam
        ? parseInt(limitParam, 10)
        : 5;

    const rangePreset =
      rangeParam === "today" || rangeParam === "7d" || rangeParam === "30d"
        ? rangeParam
        : undefined;

    const service = getAdminWorkspaceUsageService();
    const records = await service.getWorkspaceUsageRanking({
      limit,
      rangePreset,
      dateRange: from || to ? { from, to } : undefined,
    });

    return NextResponse.json(records);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load workspace usage ranking.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
