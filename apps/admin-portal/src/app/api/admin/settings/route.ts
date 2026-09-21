import { NextRequest, NextResponse } from "next/server";
import { SettingsValidationError } from "@deskatlas/domain";
import { getAdminSettingsService } from "./_lib/settingsService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const service = getAdminSettingsService();
    const overview = await service.getSettingsOverview();
    return NextResponse.json({ data: overview });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to load settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const service = getAdminSettingsService();

    const actorUserId = request.headers.get("x-user-id") ?? undefined;
    const actorRole = request.headers.get("x-user-role") ?? "ADMIN";

    const updated = await service.updateBusinessSettings(
      {
        businessName: body.businessName,
        timezone: body.timezone,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        facebookUrl: body.facebookUrl,
        instagramUrl: body.instagramUrl,
        twitterUrl: body.twitterUrl,
        websiteUrl: body.websiteUrl,
        bookingIntervalMinutes: Number(body.bookingIntervalMinutes),
        paymentExpiryMinutes: Number(body.paymentExpiryMinutes),
        kioskTimeoutMinutes:
          body.kioskTimeoutMinutes !== undefined && body.kioskTimeoutMinutes !== null
            ? Number(body.kioskTimeoutMinutes)
            : null,
        kioskAllowanceMinutes:
          body.kioskAllowanceMinutes !== undefined && body.kioskAllowanceMinutes !== null
            ? Number(body.kioskAllowanceMinutes)
            : 5,
        bookingEndAlertMinutes:
          body.bookingEndAlertMinutes !== undefined && body.bookingEndAlertMinutes !== null
            ? Number(body.bookingEndAlertMinutes)
            : 5,
        customerSessionTimeoutMinutes:
          body.customerSessionTimeoutMinutes !== undefined && body.customerSessionTimeoutMinutes !== null
            ? Number(body.customerSessionTimeoutMinutes)
            : 20,
        customerRescheduleCutoffHours:
          body.customerRescheduleCutoffHours !== undefined && body.customerRescheduleCutoffHours !== null
            ? Number(body.customerRescheduleCutoffHours)
            : 12,
        landingPreviewPhotos: body.landingPreviewPhotos,
        statusColors: body.statusColors,
        cancellationPolicyPdfUrl: body.cancellationPolicyPdfUrl,
        cancellationPolicyPdfFilename: body.cancellationPolicyPdfFilename,
        cancellationPolicyUpdatedAt: body.cancellationPolicyUpdatedAt,
      },
      actorUserId ? { id: actorUserId, name: "Admin", role: "admin" } : null
    );

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    if (error instanceof SettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to update business settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
