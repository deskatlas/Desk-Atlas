import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../_lib/reservationService";

export const runtime = "nodejs";

export async function POST(
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

    const service = getAdminReservationService();
    const result = await service.extendReservation({
      reservationId: id,
      extensionMinutes,
      additionalFee,
      paymentMethod,
      actorRole: "ADMIN",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extend reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("reserved") || message.includes("occupied") || message.includes("overlap")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
