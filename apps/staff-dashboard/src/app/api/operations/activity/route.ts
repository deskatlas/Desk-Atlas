import { NextRequest, NextResponse } from "next/server";
import {
  createStaffOperationsService,
  ReservationSupabaseRepository,
  StaffOperationsConflictError,
  StaffOperationsError,
} from "@deskatlas/domain";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const typeParam = (request.nextUrl.searchParams.get("type") ?? request.nextUrl.searchParams.get("activityType"))?.toUpperCase();
    const filter = (typeParam === "CHECK_IN" || typeParam === "REENTRY" || typeParam === "CHECK_OUT")
      ? { activityType: typeParam as "CHECK_IN" | "REENTRY" | "CHECK_OUT" }
      : undefined;
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    const activity = await service.listOperationalActivity(limitParam, filter);
    return NextResponse.json({ activity });
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load operational activity.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
