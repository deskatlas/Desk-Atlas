import { NextRequest, NextResponse } from 'next/server';
import { CampaignRuleInputSchema } from '@deskatlas/validation';
import type { CampaignRule, RuleDefinitionV1 } from '@deskatlas/domain';
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
        { error: { code: 'FORBIDDEN', message: 'Only administrators may configure campaign rules' } },
        { status: 403 }
      );
    }

    const { id: campaignId } = await context.params;
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' } },
        { status: 400 }
      );
    }

    const parseResult = CampaignRuleInputSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid campaign rule configuration',
            fieldErrors: formatZodErrors(parseResult.error),
          },
        },
        { status: 400 }
      );
    }

    const validated = parseResult.data;
    const service = getAdminCampaignService();

    const campaign = await service.getCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Campaign not found' } },
        { status: 404 }
      );
    }

    if (validated.supersedes_rule_id) {
      // Successor rule publication
      const successor = await service.addSuccessorRule(
        validated.supersedes_rule_id,
        {
          label: validated.label,
          reward_type: validated.reward_type,
          reward_value: validated.reward_value,
          max_discount_amount: validated.max_discount_amount,
          voucher_validity_days: validated.voucher_validity_days,
          rule_definition: validated.rule_definition as RuleDefinitionV1,
        }
      );
      return NextResponse.json({ data: successor }, { status: 201 });
    }

    // Direct rule creation on DRAFT campaigns
    if (campaign.status !== 'DRAFT') {
      return NextResponse.json(
        {
          error: {
            code: 'LIFECYCLE_CONFLICT',
            message: 'Adding a new rule to an active or archived campaign requires superseding an existing rule',
          },
        },
        { status: 409 }
      );
    }

    // Creating initial rule for draft
    const existingRules = campaign.rules || [];
    if (existingRules.length > 0) {
      const successor = await service.addSuccessorRule(existingRules[0].id, {
        label: validated.label,
        reward_type: validated.reward_type,
        reward_value: validated.reward_value,
        max_discount_amount: validated.max_discount_amount,
        voucher_validity_days: validated.voucher_validity_days,
        rule_definition: validated.rule_definition as RuleDefinitionV1,
      });
      return NextResponse.json({ data: successor }, { status: 201 });
    }

    const newRule: CampaignRule = {
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      label: validated.label,
      version: 1,
      supersedes_rule_id: null,
      effective_from: new Date().toISOString(),
      retired_at: null,
      rule_definition: validated.rule_definition as RuleDefinitionV1,
      reward_type: validated.reward_type,
      reward_value: validated.reward_value,
      max_discount_amount: validated.max_discount_amount || null,
      voucher_validity_days: validated.voucher_validity_days || 30,
      created_at: new Date().toISOString(),
    };

    return NextResponse.json({ data: newRule }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create campaign rule';
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
