import { NextRequest, NextResponse } from 'next/server';
import { UpdateCampaignInputSchema } from '@deskatlas/validation';
import { getAdminCampaignService } from '../_lib/campaignServiceHelper';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export const runtime = 'nodejs';

function formatZodErrors(error: unknown) {
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) {
      const field = issue.path.join('.') || 'root';
      if (!fieldErrors[field]) {
        fieldErrors[field] = [];
      }
      fieldErrors[field].push(issue.message);
    }
    return fieldErrors;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const service = getAdminCampaignService();
    const campaign = await service.getCampaign(id);

    if (!campaign) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Campaign not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: campaign });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve campaign';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actorRole = request.headers.get('x-user-role') || 'ADMIN';
    if (actorRole !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only administrators may edit campaigns' } },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' } },
        { status: 400 }
      );
    }

    const parseResult = UpdateCampaignInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid campaign update payload',
            fieldErrors: formatZodErrors(parseResult.error),
          },
        },
        { status: 400 }
      );
    }

    const validated = parseResult.data;
    const service = getAdminCampaignService();

    const existing = await service.getCampaign(id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Campaign not found' } },
        { status: 404 }
      );
    }

    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: { code: 'LIFECYCLE_CONFLICT', message: 'Only DRAFT campaigns can be modified directly' } },
        { status: 409 }
      );
    }

    try {
      const updated = await service.updateCampaign(
        id,
        {
          name: validated.name,
          description: validated.description,
          starts_at: validated.starts_at,
          ends_at: validated.ends_at,
        },
        validated.expected_revision
      );
      return NextResponse.json({ data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if (msg.includes('Optimistic locking conflict')) {
        return NextResponse.json(
          { error: { code: 'REVISION_CONFLICT', message: msg } },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update campaign';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actorRole = request.headers.get('x-user-role') || 'ADMIN';
    if (actorRole !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only administrators may delete campaigns' } },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    const service = getAdminCampaignService();

    const existing = await service.getCampaign(id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Campaign not found' } },
        { status: 404 }
      );
    }

    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: { code: 'LIFECYCLE_CONFLICT', message: 'Only unused DRAFT campaigns can be deleted' } },
        { status: 409 }
      );
    }

    try {
      await service.deleteDraftCampaign(id);
      return NextResponse.json({ data: { deleted: true } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: msg } },
        { status: 409 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete campaign';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
