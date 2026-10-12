import { NextRequest, NextResponse } from 'next/server';
import { CreateCampaignInputSchema } from '@deskatlas/validation';
import type { RuleDefinitionV1 } from '@deskatlas/domain';
import { getAdminCampaignService } from './_lib/campaignServiceHelper';

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const service = getAdminCampaignService();
    const { campaigns, total } = await service.listCampaigns({
      status: status as 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | undefined,
      search,
      limit,
      offset,
    });

    return NextResponse.json({
      data: campaigns,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list campaigns';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Resolve admin actor
    const actorRole = request.headers.get('x-user-role') || 'ADMIN';
    if (actorRole !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Only administrators may configure campaigns' } },
        { status: 403 }
      );
    }

    const actorUserId = request.headers.get('x-user-id') || '00000000-0000-0000-0000-000000000001';

    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' } },
        { status: 400 }
      );
    }

    const parseResult = CreateCampaignInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid campaign configuration',
            fieldErrors: formatZodErrors(parseResult.error),
          },
        },
        { status: 400 }
      );
    }

    const validated = parseResult.data;
    const service = getAdminCampaignService();

    const campaign = await service.createCampaign(
      {
        name: validated.name,
        description: validated.description,
        starts_at: validated.starts_at,
        ends_at: validated.ends_at,
        created_by: actorUserId,
      },
      validated.rules.map((r) => ({
        label: r.label,
        reward_type: r.reward_type,
        reward_value: r.reward_value,
        max_discount_amount: r.max_discount_amount,
        voucher_validity_days: r.voucher_validity_days,
        rule_definition: r.rule_definition as RuleDefinitionV1,
      }))
    );

    return NextResponse.json({ data: campaign }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create campaign';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
