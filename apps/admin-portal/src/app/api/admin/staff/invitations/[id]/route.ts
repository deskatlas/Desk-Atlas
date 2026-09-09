import { NextRequest, NextResponse } from "next/server";
import {
  StaffManagementAuthorizationError,
  StaffManagementError,
} from "@deskatlas/domain";
import { getStaffManagementService } from "../../_lib/staffService";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let actorUserId = request.headers.get("x-user-id") ?? undefined;
    const actorRole = (request.headers.get("x-user-role") ?? "ADMIN") as "ADMIN" | "STAFF";

    const service = getStaffManagementService();
    const success = await service.cancelStaffInvitation(id, actorUserId ? {
      userId: actorUserId,
      role: actorRole,
    } : undefined);

    return NextResponse.json({ success });
  } catch (error: any) {
    if (error instanceof StaffManagementAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof StaffManagementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to cancel invitation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
