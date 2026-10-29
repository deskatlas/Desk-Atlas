import { NextRequest, NextResponse } from 'next/server';
import { AdditionalServiceValidationError } from '@deskatlas/domain';
import { updateAdditionalServiceSchema } from '@deskatlas/validation';
import { getAdminAdditionalServiceService } from '../_lib/additionalServiceService';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(params);
    const service = getAdminAdditionalServiceService();
    const item = await service.getServiceById(id);
    if (!item) {
      return NextResponse.json({ error: 'Additional service not found' }, { status: 404 });
    }
    return NextResponse.json({ data: item });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(params);
    const body = await request.json().catch(() => ({}));

    const normalizedInput = {
      ...body,
      hourlyRate:
        body.hourlyRate !== undefined && body.hourlyRate !== null && body.hourlyRate !== ''
          ? Number(body.hourlyRate)
          : body.hourlyRate === '' ? null : body.hourlyRate,
      dailyRate:
        body.dailyRate !== undefined && body.dailyRate !== null && body.dailyRate !== ''
          ? Number(body.dailyRate)
          : body.dailyRate === '' ? null : body.dailyRate,
      totalInventory:
        body.totalInventory !== undefined && body.totalInventory !== null && body.totalInventory !== ''
          ? Number(body.totalInventory)
          : undefined,
      availableInventory:
        body.availableInventory !== undefined && body.availableInventory !== null && body.availableInventory !== ''
          ? Number(body.availableInventory)
          : undefined,
    };

    const parsed = updateAdditionalServiceSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation error' },
        { status: 400 }
      );
    }

    const service = getAdminAdditionalServiceService();
    const updated = await service.updateService(id, parsed.data);
    return NextResponse.json({ data: updated });
  } catch (error: unknown) {
    if (error instanceof AdditionalServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to update service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await Promise.resolve(params);
    const service = getAdminAdditionalServiceService();
    const success = await service.deleteService(id);
    return NextResponse.json({ success, message: 'Successfully deleted additional service' });
  } catch (error: unknown) {
    if (error instanceof AdditionalServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : 'Failed to delete service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

