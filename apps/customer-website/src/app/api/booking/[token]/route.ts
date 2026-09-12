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
    const service = createBookingAccessService(repository);
    const result = await service.getBookingAccess(token);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingAccessError) {
      const status = error.message.includes("Invalid booking token") ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message =
      error instanceof Error ? error.message : "Unable to load booking access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
