import { NextRequest, NextResponse } from "next/server";
import {
  BookingAccessError,
  createBookingAccessService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  try {
    const { token } = await context.params;
    const decodedToken = decodeURIComponent(token || "").trim();
    const searchParams = _request.nextUrl?.searchParams;
    let actorUserId = searchParams?.get("actorUserId") || searchParams?.get("userId") || _request.headers.get("x-actor-user-id") || "";
    let actorRole: "ADMIN" | "STAFF" = searchParams?.get("actorRole") === "ADMIN" || _request.headers.get("x-actor-role") === "ADMIN" ? "ADMIN" : "STAFF";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
      const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceRoleKey) {
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
              if (profiles[0].role === "ADMIN") {
                actorRole = "ADMIN";
              }
            }
          }
        } catch {
          // fallback
        }
      }
    }

    const actor = actorUserId ? { userId: actorUserId, role: actorRole } : undefined;
    const service = createBookingAccessService(new ReservationSupabaseRepository());
    const result = await service.resolveBookingAccess(decodedToken, actor);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to resolve booking access token.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
