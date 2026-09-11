import { NextRequest, NextResponse } from "next/server";
import {
  createBookingSurveyService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";

export const runtime = "nodejs";

async function handleCron(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
    }

    const trackingBaseUrl =
      process.env.TRACKING_BASE_URL ??
      process.env.DESKATLAS_PUBLIC_APP_URL ??
      request.nextUrl.origin.replace(/\/$/, "");

    const repository = new ReservationSupabaseRepository({
      supabaseUrl,
      serviceRoleKey: supabaseKey,
    });

    const surveyService = createBookingSurveyService(repository, {
      trackingBaseUrl,
      surveyFormUrl: process.env.SURVEY_FORM_URL || process.env.NEXT_PUBLIC_SURVEY_FORM_URL,
      bookAgainUrl: process.env.DESKATLAS_PUBLIC_APP_URL || request.nextUrl.origin.replace(/\/$/, ""),
    });

    const result = await surveyService.processEndedBookings();
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("[Cron:CompleteBookings] Error running survey checker:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
