import { type AdminReportExportType, type AdminReportRange } from "@deskatlas/domain";
import { NextRequest, NextResponse } from "next/server";
import { getAdminReportsService } from "../_lib/reportsService";

const allowedExportTypes = new Set<AdminReportExportType>([
  "operations-summary",
  "workspace",
  "reservations",
  "payment",
  "booking-activity",
  "cancellation",
  "checkin",
  "rentals",
]);

const validRanges = new Set<AdminReportRange>(["today", "7days", "30days", "month", "year"]);

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const exportType = request.nextUrl.searchParams.get("type") as AdminReportExportType | null;
  const rangeParam = request.nextUrl.searchParams.get("range") as AdminReportRange | null;
  const formatParam = request.nextUrl.searchParams.get("format") as "xlsx" | "csv" | null;
  const format: "xlsx" | "csv" = formatParam === "csv" ? "csv" : "xlsx";
  const range = rangeParam && validRanges.has(rangeParam) ? rangeParam : undefined;

  if (!exportType || !allowedExportTypes.has(exportType)) {
    return NextResponse.json({ error: "Invalid report export type." }, { status: 400 });
  }

  try {
    const report = await getAdminReportsService().exportAdminReport(exportType, range, format);
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
    const message = error instanceof Error ? error.message : "Failed to export admin report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
