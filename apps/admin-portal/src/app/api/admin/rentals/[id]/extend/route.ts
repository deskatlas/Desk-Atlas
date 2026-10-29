import { NextRequest, NextResponse } from 'next/server';
import { extendRentalSchema } from '@deskatlas/validation';
import { getAdminRentalService } from '../../_lib/rentalService';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params);
    const rentalId = resolvedParams.id;
    const body = await req.json().catch(() => ({}));

    const parseResult = extendRentalSchema.safeParse({
      ...body,
      rentalId: rentalId || body.rentalId,
    });

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return NextResponse.json(
        { error: issue?.message || 'Invalid rental extension input' },
        { status: 400 }
      );
    }

    const rentalService = getAdminRentalService();
    const data = parseResult.data;
    const rental = await rentalService.extendRental({
      rentalId: (rentalId || data.rentalId) as string,
      extensionMode: data.extensionMode as 'hourly' | 'daily',
      additionalUnits: data.additionalUnits as number,
      staffUserId: data.staffUserId,
    });

    return NextResponse.json({ rental });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extend rental';
    const isValidationError =
      message.includes('required') ||
      message.includes('not found') ||
      message.includes('returned') ||
      message.includes('mode');
    return NextResponse.json({ error: message }, { status: isValidationError ? 400 : 500 });
  }
}
