import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      reservationId: string;
    }>;
  }
) {
  try {
    const { reservationId } = await context.params;
    if (!reservationId || reservationId.trim() === "") {
      return NextResponse.json({ error: "Reservation ID is required." }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const durationParam = searchParams.get("extensionMinutes") || searchParams.get("durationMinutes") || searchParams.get("minutes");
    const extensionMinutes = durationParam ? Number(durationParam) : undefined;

    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const result = await service.checkExtendAvailability({
      reservationId: reservationId.trim(),
      extensionMinutes,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to check extension availability.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
