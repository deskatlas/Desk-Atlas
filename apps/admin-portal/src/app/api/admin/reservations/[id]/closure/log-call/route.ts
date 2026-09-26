import { NextRequest, NextResponse } from "next/server";
import { getAdminReservationService } from "../../../_lib/reservationService";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const service = getAdminReservationService();

    const staffUserId = body.staffUserId || request.headers.get("x-user-id") || "admin";
    const staffName = body.staffName || "Admin User";
    const outreachStatus = body.outreachStatus || "LEFT_VOICEMAIL";
    const notes = body.notes || "";

    const result = await service.logClosurePhoneCall({
      reservationId: id,
      staffUserId,
      staffName,
      outreachStatus,
      notes,
    });

    return NextResponse.json({ data: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to log closure outreach.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
