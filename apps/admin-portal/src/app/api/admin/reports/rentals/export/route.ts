import { AdminReportRange } from "@deskatlas/domain";
import { NextRequest, NextResponse } from "next/server";
import { getAdminReportsService } from "../../_lib/reportsService";

export const runtime = "nodejs";

const validRanges = new Set<AdminReportRange>(["today", "7days", "30days", "month", "year"]);

export async function GET(request: NextRequest) {
  const rangeParam = request.nextUrl.searchParams.get("range") as AdminReportRange | null;
  const formatParam = request.nextUrl.searchParams.get("format") as "xlsx" | "csv" | null;
  const format: "xlsx" | "csv" = formatParam === "xlsx" ? "xlsx" : "csv";
  const range = rangeParam && validRanges.has(rangeParam) ? rangeParam : undefined;

  try {
    const report = await getAdminReportsService().exportAdminReport("rentals", range, format);
    const body = report.buffer ? new Uint8Array(report.buffer) : report.content;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": report.contentType,
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export rental report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

