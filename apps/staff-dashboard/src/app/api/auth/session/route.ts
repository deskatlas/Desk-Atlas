import { NextRequest, NextResponse } from "next/server";
import {
  createStaffManagementService,
  StaffManagementSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

function getStaffService() {
  return createStaffManagementService(new StaffManagementSupabaseRepository());
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId =
      request.headers.get("x-user-id") ||
      searchParams.get("userId") ||
      searchParams.get("id");
    const email =
      request.headers.get("x-user-email") ||
      searchParams.get("email");

    if (!userId && !email) {
      return NextResponse.json({
        active: false,
        deactivated: false,
      });
    }

    const service = getStaffService();
    let staff = null;

    if (userId) {
      staff = await service.getStaffById(userId);
    }

    if (!staff && email) {
      const allStaff = await service.listStaff();
      staff = allStaff.find(
        (s) => s.email.toLowerCase() === email.trim().toLowerCase()
      ) || null;
    }

    if (!staff) {
      return NextResponse.json(
        {
          active: false,
          deactivated: true,
          error: "Account deactivated or not authorized",
        },
        { status: 403 }
      );
    }

    if (!staff.isActive) {
      return NextResponse.json(
        {
          active: false,
          deactivated: true,
          error: "Account deactivated or not authorized",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      active: true,
      deactivated: false,
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role.toLowerCase(),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        active: false,
        deactivated: false,
        error: error?.message || "Failed to verify session",
      },
      { status: 500 }
    );
  }
}
