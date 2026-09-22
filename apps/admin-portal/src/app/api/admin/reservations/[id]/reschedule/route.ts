import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../_lib/reservationService";
import { getAdminSettingsService } from "../../../settings/_lib/settingsService";

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
    const startAt = typeof body.startAt === "string" ? body.startAt.trim() : "";
    const endAt = typeof body.endAt === "string" ? body.endAt.trim() : "";
    const workspaceInstanceId =
      typeof body.workspaceInstanceId === "string" ? body.workspaceInstanceId.trim() : undefined;

    if (!startAt || !endAt) {
      return NextResponse.json(
        { error: "startAt and endAt are required." },
        { status: 400 }
      );
    }

    const [settingsOverview] = await Promise.all([
      getAdminSettingsService().getSettingsOverview().catch(() => null),
    ]);
    const maxAdvanceValue = settingsOverview?.businessSettings?.rescheduleMaxAdvanceValue ?? 30;
    const maxAdvanceUnit = settingsOverview?.businessSettings?.rescheduleMaxAdvanceUnit ?? "DAYS";
    const maxAdvanceHours = maxAdvanceUnit === "HOURS" ? maxAdvanceValue : maxAdvanceValue * 24;

    const service = getAdminReservationService();
    const result = await service.rescheduleReservation({
      reservationId: id,
      startAt,
      endAt,
      workspaceInstanceId,
      actorRole: "ADMIN",
      maxAdvanceValue,
      maxAdvanceUnit,
      maxAdvanceHours,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reschedule reservation.";
    const status = message.includes("not found")
      ? 404
      : message.includes("already booked") || message.includes("occupied")
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
