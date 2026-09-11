import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../../_lib/reservationService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { error: "Reservation ID is required." },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const startAt = searchParams.get("startAt") || undefined;
    const endAt = searchParams.get("endAt") || undefined;
    const date = searchParams.get("date") || undefined;
    const durationParam = searchParams.get("durationHours") || searchParams.get("duration") || searchParams.get("durationMinutes");
    const durationHours = durationParam ? Number(durationParam) : undefined;
    const workspaceInstanceId = searchParams.get("workspaceInstanceId") || undefined;

    if (!date && (!startAt || !endAt)) {
      return NextResponse.json(
        { error: "Either date or startAt and endAt query parameters are required." },
        { status: 400 }
      );
    }

    const service = getAdminReservationService();
    const result = await service.checkRescheduleAvailability({
      reservationId: id,
      startAt,
      endAt,
      date,
      durationHours,
      workspaceInstanceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check availability.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
