// MS-104: Advance Reservation Reminder Background Cron Runner (Admin Portal Endpoint)
// Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C11, ERD-E2, ERD-E10, QAD-TC50, MS104-TC01..04

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  ReservationSupabaseRepository,
  createTransactionalEmailService,
  processAdvanceReservationReminders,
  SupabaseSettingsRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) {
    return false;
  }
  try {
    const supplied = createHash("sha256").update(token).digest();
    const expected = createHash("sha256").update(cronSecret).digest();
    return timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

async function handleCron(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
    }

    let nowOption: Date | undefined;
    if (request.method === "POST") {
      try {
        const body = await request.clone().json().catch(() => null);
        if (body?.now) {
          nowOption = new Date(body.now);
        }
      } catch {
        // Ignore body parsing failure
      }
    }

    const reservationRepo = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const settingsRepo = new SupabaseSettingsRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const emailService = createTransactionalEmailService({
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL,
      webhookUrl: process.env.TRANSACTIONAL_EMAIL_WEBHOOK_URL,
    });

    const origin = new URL(request.url).origin.replace(/\/$/, "");
    const customerWebsiteUrl =
      process.env.DESKATLAS_PUBLIC_APP_URL ??
      process.env.NEXT_PUBLIC_CUSTOMER_URL ??
      origin;

    const result = await processAdvanceReservationReminders({
      reservationRepo,
      settingsRepo,
      emailService,
      customerWebsiteUrl,
      now: nowOption,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error("[Cron:Reminders] Error processing advance reservation reminders:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
