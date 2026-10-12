import { NextRequest, NextResponse } from 'next/server';
import { CampaignStatusTransitionSchema } from '@deskatlas/validation';
import { getAdminCampaignService } from '../../_lib/campaignServiceHelper';

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actorRole = request.headers.get('x-user-role') || 'ADMIN';
    if (actorRole !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only administrators may change campaign status' } },
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

    const parseResult = CampaignStatusTransitionSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid status transition payload',
            fieldErrors: formatZodErrors(parseResult.error),
          },
        },
        { status: 400 }
      );
    }

    const { status, expected_revision } = parseResult.data;
    const service = getAdminCampaignService();

    try {
      const updated = await service.transitionCampaignStatus(id, status, expected_revision);
      return NextResponse.json({ data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Status transition failed';
      if (msg.includes('Optimistic locking conflict') || msg.includes('revision mismatch')) {
        return NextResponse.json(
          { error: { code: 'REVISION_CONFLICT', message: msg } },
          { status: 409 }
        );
      }
      if (msg.includes('Invalid transition') || msg.includes('terminal')) {
        return NextResponse.json(
          { error: { code: 'LIFECYCLE_CONFLICT', message: msg } },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to transition campaign status';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
