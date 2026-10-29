import { AdminReportRange } from "@deskatlas/domain";
import { NextRequest, NextResponse } from "next/server";
import { getAdminReportsService } from "../_lib/reportsService";

export const runtime = "nodejs";

const validRanges = new Set<AdminReportRange>(["today", "7days", "30days", "month", "year"]);

export async function GET(request: NextRequest) {
  const rangeParam = request.nextUrl.searchParams.get("range") as AdminReportRange | null;
  const range = rangeParam && validRanges.has(rangeParam) ? rangeParam : "month";

  try {
    const service = getAdminReportsService();
    const snapshot = await service.getAdminReportsSnapshot(range);
    const rentals = snapshot.rentalAnalytics ? snapshot.rentalAnalytics : null;
    return NextResponse.json({
      success: true,
      range,
      snapshot: snapshot.rentalAnalytics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load rental analytics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

