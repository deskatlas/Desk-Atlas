import { NextResponse } from "next/server";
import { getAdminReservationService } from "../../admin/reservations/_lib/reservationService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = getAdminReservationService();
    const result = await service.getClosureAlerts();
    return NextResponse.json(result);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to load closure alerts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
