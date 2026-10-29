import { NextRequest, NextResponse } from 'next/server';
import { assignRentalSchema } from '@deskatlas/domain';
import { getStaffRentalService } from './_lib/rentalService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const reservationId = searchParams.get('reservationId') || undefined;

    const rentalService = getStaffRentalService();
    const rentals = await rentalService.listRentals({ status, reservationId });

    return NextResponse.json(
      { rentals },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list equipment rentals';
    return NextResponse.json({ error: message, rentals: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parseResult = assignRentalSchema.safeParse(body);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return NextResponse.json(
        { error: issue?.message || 'Invalid rental assignment input' },
        { status: 400 }
      );
    }

    const rentalService = getStaffRentalService();
    const data = parseResult.data;
    const rental = await rentalService.assignRental({
      reservationId: data.reservationId as string,
      serviceId: data.serviceId as string,
      billingMode: data.billingMode as 'hourly' | 'daily',
      durationUnits: data.durationUnits as number,
      idVerified: Boolean(data.idVerified),
      idNotes: data.idNotes,
      staffUserId: data.staffUserId,
      notes: data.notes,
    });

    return NextResponse.json({ rental }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign rental';
    const isValidationError =
      message.includes('required') ||
      message.includes('stock') ||
      message.includes('active') ||
      message.includes('checked-in') ||
      message.includes('verified');
    return NextResponse.json({ error: message }, { status: isValidationError ? 400 : 500 });
  }
}
