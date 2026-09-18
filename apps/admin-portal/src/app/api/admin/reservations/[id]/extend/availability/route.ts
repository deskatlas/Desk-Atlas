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
    const durationParam = searchParams.get("extensionMinutes") || searchParams.get("durationMinutes") || searchParams.get("minutes");
    const extensionMinutes = durationParam ? Number(durationParam) : undefined;

    const service = getAdminReservationService();
    const result = await service.checkExtendAvailability({
      reservationId: id,
      extensionMinutes,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check extension availability.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
