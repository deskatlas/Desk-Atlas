import { NextRequest, NextResponse } from "next/server";
import { SettingsValidationError } from "@deskatlas/domain";
import { getAdminSettingsService } from "../../_lib/settingsService";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const service = getAdminSettingsService();

    const preview = await service.previewClosureImpact({
      date: body.date,
      endDate: body.endDate || null,
      closureType: body.closureType || "FULL_DAY",
      opensAt: body.opensAt || null,
      closesAt: body.closesAt || null,
      reason: body.reason || null,
    });

    return NextResponse.json({ data: preview });
  } catch (error: any) {
    if (error instanceof SettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to preview closure impact.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
