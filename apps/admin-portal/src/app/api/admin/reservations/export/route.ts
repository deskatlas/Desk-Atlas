import { NextRequest, NextResponse } from "next/server";
import {
  AdminReservationAdvancedFilters,
  AdminReservationFilter,
  DateRangePreset,
  generateReservationsCsv,
  generateReservationsCsvFilename,
} from "@deskatlas/domain";
import { getAdminReservationService } from "../_lib/reservationService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filterParam = (searchParams.get("filter") ?? "active") as AdminReservationFilter;
    const searchParam = searchParams.get("search") ?? undefined;

    const datePreset = (searchParams.get("datePreset") ?? undefined) as DateRangePreset | undefined;
    const startDate = searchParams.get("startDate") ?? searchParams.get("from") ?? undefined;
    const endDate = searchParams.get("endDate") ?? searchParams.get("to") ?? undefined;
    const workspaceTemplate = searchParams.get("workspaceTemplate") ?? searchParams.get("template") ?? undefined;
    const paymentMethod = searchParams.get("paymentMethod") ?? undefined;
    const paymentStatus = searchParams.get("paymentStatus") ?? undefined;
    const source = searchParams.get("source") ?? undefined;

    const hasAdvanced =
      Boolean(datePreset) ||
      Boolean(startDate) ||
      Boolean(endDate) ||
      Boolean(workspaceTemplate) ||
      Boolean(paymentMethod) ||
      Boolean(paymentStatus) ||
      Boolean(source);

    const advancedFilters: AdminReservationAdvancedFilters | undefined = hasAdvanced
      ? {
          datePreset,
          startDate,
          endDate,
          workspaceTemplate,
          paymentMethod,
          paymentStatus,
          source,
        }
      : undefined;

    const service = getAdminReservationService();
    const result = await service.listReservations(filterParam, searchParam, advancedFilters);

    const csvContent = generateReservationsCsv(result.reservations);
    const filename = generateReservationsCsvFilename();

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export reservations CSV.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
