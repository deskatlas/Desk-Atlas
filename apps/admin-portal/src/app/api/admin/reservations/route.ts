import { NextRequest, NextResponse } from "next/server";
import { AdminReservationFilter } from "@deskatlas/domain";
import { getAdminReservationService } from "./_lib/reservationService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const filterParam = (request.nextUrl.searchParams.get("filter") ?? "active") as AdminReservationFilter;
    const searchParam = request.nextUrl.searchParams.get("search") ?? undefined;

    const service = getAdminReservationService();
    const result = await service.listReservations(filterParam, searchParam);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load admin reservations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
