import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
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

    const body = await request.json().catch(() => ({}));
    const extensionMinutes = Number(body.extensionMinutes) || 0;
    const additionalFee = body.additionalFee !== undefined ? Number(body.additionalFee) : undefined;
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "CASH";

    if (extensionMinutes <= 0) {
      return NextResponse.json(
        { error: "A valid positive extension duration in minutes is required." },
        { status: 400 }
      );
    }

    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const result = await service.extendReservation({
      reservationId: reservationId.trim(),
      extensionMinutes,
      additionalFee,
      paymentMethod,
      actorRole: "STAFF",
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to extend reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("reserved") || message.includes("occupied") || message.includes("overlap")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
