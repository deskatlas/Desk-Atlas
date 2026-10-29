import { NextRequest, NextResponse } from 'next/server';
import {
  AdditionalServiceValidationError,
  type AdditionalServiceType,
} from '@deskatlas/domain';
import { createAdditionalServiceSchema } from '@deskatlas/validation';
import { getAdminAdditionalServiceService } from './_lib/additionalServiceService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const isActiveParam = searchParams.get('isActive');
    const serviceTypeParam = searchParams.get('serviceType');
    const id = searchParams.get('id');

    const service = getAdminAdditionalServiceService();

    if (id) {
      const item = await service.getServiceById(id);
      if (!item) {
        return NextResponse.json({ error: 'Additional service not found' }, { status: 404 });
      }
      return NextResponse.json({ data: item });
    }

    const filter: { isActive?: boolean; serviceType?: AdditionalServiceType } = {};
    if (isActiveParam !== null && isActiveParam !== undefined) {
      filter.isActive = isActiveParam === 'true';
    }
    if (serviceTypeParam === 'rental' || serviceTypeParam === 'one_time') {
      filter.serviceType = serviceTypeParam;
    }

    const services = await service.listServices(filter);
    return NextResponse.json({ data: services });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch services';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // Normalize numeric fields if passed as strings
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
    };

    const parsed = createAdditionalServiceSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation error' },
        { status: 400 }
      );
    }

    const service = getAdminAdditionalServiceService();
    const created = await service.createService({
      ...parsed.data,
      name: parsed.data.name!,
      serviceType: parsed.data.serviceType!,
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AdditionalServiceValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to create service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
