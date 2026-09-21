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
    const searchParams = request.nextUrl.searchParams;
    const searchParam = searchParams.get("search") ?? undefined;
    const statusParam = searchParams.get("status") ?? searchParams.get("filter") ?? undefined;
    const service = createStaffOperationsService(new ReservationSupabaseRepository());
    let reservations = await service.listOperationalReservations(searchParam);

    if (statusParam && statusParam.trim() !== "" && statusParam.toLowerCase() !== "all") {
      const targetStatus = statusParam.trim().toUpperCase();
      reservations = reservations.filter((r) => {
        if (targetStatus === "CANCELLED") {
          return r.reservationStatus === "CANCELLED";
        }
        if (targetStatus === "EXPIRED") {
          return (
            r.reservationStatus === "EXPIRED" ||
            r.reservationStatus === "REJECTED" ||
            r.status?.toUpperCase() === "REJECTED" ||
            r.paymentStatus?.toUpperCase().includes("REJECTED") ||
            r.paymentAttemptStatus?.toUpperCase() === "REJECTED"
          );
        }
        if (targetStatus === "REJECTED") {
          return (
            r.reservationStatus === "REJECTED" ||
            r.status?.toUpperCase() === "REJECTED" ||
            r.paymentStatus?.toUpperCase().includes("REJECTED") ||
            r.paymentAttemptStatus?.toUpperCase() === "REJECTED"
          );
        }
        if (targetStatus === "CONFIRMED") {
          return r.reservationStatus === "CONFIRMED";
        }
        if (targetStatus === "CHECKED_IN") {
          return r.reservationStatus === "CHECKED_IN" || r.checkInState === "CHECKED_IN";
        }
        if (targetStatus === "COMPLETED") {
          return r.reservationStatus === "COMPLETED" || r.checkInState === "CHECKED_OUT";
        }
        return r.reservationStatus === targetStatus;
      });
    }

    return NextResponse.json({ reservations });
  } catch (error) {
    if (error instanceof StaffOperationsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof StaffOperationsConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load operational reservations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
