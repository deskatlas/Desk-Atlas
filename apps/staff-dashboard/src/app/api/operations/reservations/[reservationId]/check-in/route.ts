import { NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      reservationId: string;
    }>;
  }
) {
  try {
    const { reservationId } = await context.params;
    const body = await request.json();
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

    const result = await service.checkInReservation({
      reservationId,
      actor: {
        userId: actorUserId,
        role: resolvedRole,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const isEarlyCheckIn = rawMsg.includes("Reservation is not currently active for check-in");

    if (error instanceof StaffOperationsError || isEarlyCheckIn) {
      const message = isEarlyCheckIn
        ? "Reservation is not currently active for check-in."
        : error instanceof Error ? error.message : "Staff operation error.";
      return NextResponse.json({
        error: message,
        code: isEarlyCheckIn ? "EARLY_CHECK_IN" : "STAFF_OPERATIONS_ERROR",
      }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to check in reservation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
