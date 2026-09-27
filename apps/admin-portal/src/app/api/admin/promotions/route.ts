import { NextRequest, NextResponse } from 'next/server';
import { PromotionalValidationError } from '@deskatlas/domain';
import { getAdminPromotionalService } from './_lib/promotionalService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const onlyActive = searchParams.get('onlyActive') === 'true';
    const id = searchParams.get('id');
    const service = getAdminPromotionalService();

    if (id) {
      const promotion = await service.getPromotionById(id);
      if (!promotion) {
        return NextResponse.json({ error: 'Promotion not found' }, { status: 404 });
      }
      return NextResponse.json({ data: promotion });
    }

    const promotions = await service.listPromotions({ onlyActive });
    return NextResponse.json({ data: promotions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch promotions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const service = getAdminPromotionalService();

    if (body.templatePrices && typeof body.templatePrices === 'object') {
      const templatePrices = body.templatePrices as Record<string, number>;
      const selectedIds = (body.workspaceTemplateIds || body.workspace_template_ids || Object.keys(templatePrices)) as string[];
      
      const priceToTemplateIds = new Map<number, string[]>();
      for (const [templateId, price] of Object.entries(templatePrices)) {
        if (selectedIds.includes(templateId)) {
          const numPrice = Number(price);
          if (!isNaN(numPrice) && numPrice >= 0) {
            const list = priceToTemplateIds.get(numPrice) || [];
            list.push(templateId);
            priceToTemplateIds.set(numPrice, list);
          }
        }
      }

      if (priceToTemplateIds.size > 0) {
        const createdList = [];
        for (const [price, templateIds] of priceToTemplateIds.entries()) {
          const promo = await service.createPromotion({
            name: body.name,
            workspaceTemplateIds: templateIds,
            rateType: body.rateType || body.rate_type || 'HOURLY',
            promotionalPrice: price,
            startAt: body.startAt || body.start_at,
            endAt: body.endAt || body.end_at,
            isActive: body.isActive !== undefined ? Boolean(body.isActive) : (body.is_active !== undefined ? Boolean(body.is_active) : true),
          });
          createdList.push(promo);
        }
        return NextResponse.json({ data: createdList[0], all: createdList }, { status: 201 });
      }
    }

    const promotion = await service.createPromotion({
      name: body.name,
      workspaceTemplateIds: body.workspaceTemplateIds || body.workspace_template_ids,
      rateType: body.rateType || body.rate_type || 'HOURLY',
      promotionalPrice: Number(body.promotionalPrice ?? body.promotional_price),
      startAt: body.startAt || body.start_at,
      endAt: body.endAt || body.end_at,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : (body.is_active !== undefined ? Boolean(body.is_active) : true),
    });

    return NextResponse.json({ data: promotion }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof PromotionalValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to create promotion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get('id') || body.id;

    if (!id) {
      return NextResponse.json({ error: 'Promotion id is required' }, { status: 400 });
    }

    const service = getAdminPromotionalService();

    if (body.templatePrices && typeof body.templatePrices === 'object') {
      const templatePrices = body.templatePrices as Record<string, number>;
      const selectedIds = (body.workspaceTemplateIds || body.workspace_template_ids || Object.keys(templatePrices)) as string[];
      
      const priceToTemplateIds = new Map<number, string[]>();
      for (const [templateId, price] of Object.entries(templatePrices)) {
        if (selectedIds.includes(templateId)) {
          const numPrice = Number(price);
          if (!isNaN(numPrice) && numPrice >= 0) {
            const list = priceToTemplateIds.get(numPrice) || [];
            list.push(templateId);
            priceToTemplateIds.set(numPrice, list);
          }
        }
      }

      if (priceToTemplateIds.size > 0) {
        const entries = Array.from(priceToTemplateIds.entries());
        const [firstPrice, firstTemplateIds] = entries[0];
        
        const updated = await service.updatePromotion(id, {
          name: body.name,
          workspaceTemplateIds: firstTemplateIds,
          rateType: body.rateType || body.rate_type,
          promotionalPrice: firstPrice,
          startAt: body.startAt || body.start_at,
          endAt: body.endAt || body.end_at,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : (body.is_active !== undefined ? Boolean(body.is_active) : undefined),
        });

        // Create any additional records if there are other prices
        for (let i = 1; i < entries.length; i++) {
          const [price, templateIds] = entries[i];
          await service.createPromotion({
            name: body.name,
            workspaceTemplateIds: templateIds,
            rateType: body.rateType || body.rate_type || 'HOURLY',
            promotionalPrice: price,
            startAt: body.startAt || body.start_at,
            endAt: body.endAt || body.end_at,
            isActive: body.isActive !== undefined ? Boolean(body.isActive) : (body.is_active !== undefined ? Boolean(body.is_active) : true),
          });
        }

        return NextResponse.json({ data: updated });
      }
    }

    const updated = await service.updatePromotion(id, {
      name: body.name,
      workspaceTemplateIds: body.workspaceTemplateIds || body.workspace_template_ids,
      rateType: body.rateType || body.rate_type,
      promotionalPrice: body.promotionalPrice !== undefined || body.promotional_price !== undefined
        ? Number(body.promotionalPrice ?? body.promotional_price)
        : undefined,
      startAt: body.startAt || body.start_at,
      endAt: body.endAt || body.end_at,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : (body.is_active !== undefined ? Boolean(body.is_active) : undefined),
    });

    return NextResponse.json({ data: updated });
  } catch (error: unknown) {
    if (error instanceof PromotionalValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to update promotion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  return PUT(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const body = await request.json().catch(() => ({}));
    const id = searchParams.get('id') || body.id;

    if (!id) {
      return NextResponse.json({ error: 'Promotion id is required' }, { status: 400 });
    }

    const service = getAdminPromotionalService();
    const success = await service.deletePromotion(id);
    return NextResponse.json({ success });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete promotion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
