import { NextRequest, NextResponse } from "next/server";
import {
  StaffManagementAuthorizationError,
  StaffManagementConflictError,
  StaffManagementError,
  validatePassword,
} from "@deskatlas/domain";
import { getStaffManagementService } from "../_lib/staffService";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Staff user ID is required." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { displayName, role, isActive, password } = body;

    if (password !== undefined && password !== null && String(password).trim().length > 0) {
      const validation = validatePassword(String(password).trim());
      if (!validation.isValid) {
        return NextResponse.json(
          { error: `Password does not meet security requirements: ${validation.errors.join(' ')}` },
          { status: 400 }
        );
      }
    }

    const actorUserId = request.headers.get("x-user-id") ?? body.actorUserId ?? undefined;
    const actorRole = (request.headers.get("x-user-role") ?? body.actorRole ?? "ADMIN") as "ADMIN" | "STAFF";
    const actorIsSuperAdmin =
      request.headers.get("x-user-is-super-admin") === "true" ||
      body.actorIsSuperAdmin === true ||
      body.actorIsSuperAdmin === "true";

    const service = getStaffManagementService();
    const updated = await service.updateStaff({
      staffUserId: id,
      displayName,
      role: role ? (role.toUpperCase() as "ADMIN" | "STAFF") : undefined,
      isActive,
      password,
      actorUserId,
      actorRole,
      actorIsSuperAdmin,
    });

    return NextResponse.json({ staff: updated });
  } catch (error: any) {
    if (error instanceof StaffManagementConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof StaffManagementAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof StaffManagementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to update staff account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Staff user ID is required." }, { status: 400 });
    }

    const actorUserId = request.headers.get("x-user-id") ?? undefined;
    const actorRole = (request.headers.get("x-user-role") ?? "ADMIN") as "ADMIN" | "STAFF";
    const actorIsSuperAdmin = request.headers.get("x-user-is-super-admin") === "true";

    const service = getStaffManagementService();
    const staff = await service.getStaffById(
      id,
      actorUserId ? { userId: actorUserId, role: actorRole, isSuperAdmin: actorIsSuperAdmin } : undefined
    );

    if (!staff) {
      return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
    }

    const deletionCheck = await service.checkStaffDeletionEligibility(
      id,
      actorUserId ? { userId: actorUserId, role: actorRole, isSuperAdmin: actorIsSuperAdmin } : undefined
    );

    return NextResponse.json({
      staff: {
        ...staff,
        canDelete: deletionCheck.canDelete,
        deleteBlockReason: deletionCheck.reason,
        deletionReferences: deletionCheck.references,
      },
    });
  } catch (error: any) {
    if (error instanceof StaffManagementAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof StaffManagementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to retrieve staff member.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Staff user ID is required." }, { status: 400 });
    }

    const actorUserId = request.headers.get("x-user-id") ?? "system-admin";
    const actorRole = (request.headers.get("x-user-role") ?? "ADMIN") as "ADMIN" | "STAFF";
    const actorIsSuperAdmin = request.headers.get("x-user-is-super-admin") === "true";

    const service = getStaffManagementService();
    const result = await service.deleteStaff(id, {
      userId: actorUserId,
      role: actorRole,
      isSuperAdmin: actorIsSuperAdmin,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof StaffManagementConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof StaffManagementAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof StaffManagementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to delete staff account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

