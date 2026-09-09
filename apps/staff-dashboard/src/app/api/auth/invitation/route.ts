import { NextRequest, NextResponse } from "next/server";
import {
  createStaffManagementService,
  StaffManagementSupabaseRepository,
  StaffInvitationInvalidCodeError,
  StaffManagementError,
  validatePassword,
} from "@deskatlas/domain";

export const runtime = "nodejs";

function getStaffService() {
  return createStaffManagementService(new StaffManagementSupabaseRepository());
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const service = getStaffService();
    const invitation = await service.getStaffInvitationByToken(token);

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    const now = Date.now();
    const isExpired = new Date(invitation.expiresAt).getTime() < now;

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        displayName: invitation.displayName,
        role: invitation.role,
        status: isExpired && invitation.status === 'PENDING' ? 'EXPIRED' : invitation.status,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to load invitation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, verificationCode, password } = body;

    if (!token || !verificationCode) {
      return NextResponse.json(
        { error: "Invitation token and 2FA verification code are required." },
        { status: 400 }
      );
    }

    if (password !== undefined && password !== null && String(password).length > 0) {
      const validation = validatePassword(String(password));
      if (!validation.isValid) {
        return NextResponse.json(
          { error: `Password does not meet security requirements: ${validation.errors.join(' ')}` },
          { status: 400 }
        );
      }
    }

    const service = getStaffService();
    const result = await service.confirmStaffInvitation({
      token: String(token).trim(),
      verificationCode: String(verificationCode).trim(),
      password: password ? String(password) : undefined,
    });

    return NextResponse.json({
      success: true,
      message: "Staff account successfully activated.",
      staff: result.staff,
    });
  } catch (error: any) {
    if (error instanceof StaffInvitationInvalidCodeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StaffManagementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to confirm invitation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
