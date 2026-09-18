import { NextRequest, NextResponse } from "next/server";
import {
  createGuestReservationTrackingService,
  GuestReservationTrackingError,
  ReservationSupabaseRepository,
  SupabaseSettingsRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const requestLog = new Map<string, number[]>();

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `track:${ip}`;
}

function consumeRateLimit(key: string, nowMs: number) {
  const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;
  const attempts = (requestLog.get(key) ?? []).filter((entry) => entry >= windowStart);
  attempts.push(nowMs);
  requestLog.set(key, attempts);
  return attempts.length <= RATE_LIMIT_MAX_ATTEMPTS;
}

export async function POST(request: NextRequest) {
  const nowMs = Date.now();
  if (!consumeRateLimit(getClientKey(request), nowMs)) {
    return NextResponse.json(
      { error: "Too many tracking attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration is missing.");
    }

    const repository = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });
    const settingsRepository = new SupabaseSettingsRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });
    const service = createGuestReservationTrackingService(repository, settingsRepository);
    const body = await request.json();

    const result = await service.getReservationTracking({
      referenceCode: body.referenceCode,
      customerEmail: body.customerEmail,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GuestReservationTrackingError) {
      const status =
        error.message === "Reservation tracking details were not found." ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message =
      error instanceof Error ? error.message : "Unable to track reservation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
