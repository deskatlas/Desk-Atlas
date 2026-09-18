import { NextRequest, NextResponse } from "next/server";
import {
  createBookingSurveyService,
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      reservationId: string;
    }>;
  }
) {
  try {
    const { reservationId } = await context.params;
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    let actorUserId = String(body.actor?.userId ?? body.actorUserId ?? "").trim();
    let actorRole = String(body.actor?.role ?? body.actorRole ?? "").trim().toUpperCase();

    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/staff_profiles?user_id=eq.${actorUserId}&select=user_id,role&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: "no-store",
            }
          );
          if (res.ok) {
            const profiles = await res.json();
            if (Array.isArray(profiles) && profiles[0]?.role) {
              actorRole = profiles[0].role;
            }
          }
        } catch {
          // fallback
        }
      } else {
        try {
          const res = await fetch(
            `${supabaseUrl.replace(/\/$/, "")}/rest/v1/staff_profiles?select=user_id,role&is_active=eq.true&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              cache: "no-store",
            }
          );
          if (res.ok) {
            const profiles = await res.json();
            if (Array.isArray(profiles) && profiles[0]?.user_id) {
              actorUserId = profiles[0].user_id;
              actorRole = profiles[0].role || "STAFF";
            }
          }
        } catch {
          // fallback
        }
      }
    }
    const resolvedRole: "ADMIN" | "STAFF" = actorRole === "ADMIN" ? "ADMIN" : "STAFF";

    const result = await service.checkOutReservation({
      reservationId,
      actor: {
        userId: actorUserId,
        role: resolvedRole,
      },
    });

    try {
      const surveyService = createBookingSurveyService(new ReservationSupabaseRepository(), {
        surveyFormUrl: process.env.SURVEY_FORM_URL || process.env.NEXT_PUBLIC_SURVEY_FORM_URL,
        bookAgainUrl: process.env.DESKATLAS_PUBLIC_APP_URL,
      });
      await surveyService.sendSurveyForReservation(result.reservationId);
    } catch (surveyErr) {
      console.warn("[CheckOut] Failed to dispatch survey email:", surveyErr);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to check out reservation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
