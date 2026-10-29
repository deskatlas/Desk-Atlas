import { NextResponse } from 'next/server';
import { getCustomerAdditionalServiceService } from './_lib/additionalServiceService';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const service = getCustomerAdditionalServiceService();
    // Only active services are discoverable to customer guests
    const allActive = await service.listServices({ isActive: true });

    const rentals = allActive
      .filter((s) => s.serviceType === 'rental')
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        serviceType: s.serviceType,
        hourlyRate: s.hourlyRate,
        dailyRate: s.dailyRate,
        totalInventory: s.totalInventory,
        availableInventory: s.availableInventory,
        inStock: s.availableInventory > 0,
        details: s.details,
        isActive: s.isActive,
      }));

    const oneTimeServices = allActive
      .filter((s) => s.serviceType === 'one_time')
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        serviceType: s.serviceType,
        details: s.details,
        isActive: s.isActive,
      }));

    return NextResponse.json(
      {
        rentals,
        oneTimeServices,
        data: {
          rentals,
          oneTimeServices,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch services';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

