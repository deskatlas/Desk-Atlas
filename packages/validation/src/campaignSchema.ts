import { z } from 'zod';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export const ReservationChannelSchema = z.enum(['WEB', 'KIOSK']);

export const MetricTypeSchema = z.enum(['BOOKING_COUNT', 'NET_SPEND', 'BOOKED_MINUTES']);

export const CombineOperatorSchema = z.enum(['ALL', 'ANY']);

export const RewardTypeSchema = z.enum(['PERCENTAGE_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT']);

export const CampaignStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);

// Condition Schema
export const RuleConditionSchema = z.object({
  metric: MetricTypeSchema,
  threshold: z.number().positive(),
}).strict().superRefine((val, ctx) => {
  if (val.metric === 'BOOKING_COUNT') {
    if (!Number.isInteger(val.threshold) || val.threshold < 1 || val.threshold > 100000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BOOKING_COUNT threshold must be an integer between 1 and 100,000',
        path: ['threshold'],
      });
    }
  } else if (val.metric === 'NET_SPEND') {
    if (val.threshold <= 0 || val.threshold > 99999999.99) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NET_SPEND threshold must be greater than 0 and at most 99,999,999.99',
        path: ['threshold'],
      });
    }
  } else if (val.metric === 'BOOKED_MINUTES') {
    if (!Number.isInteger(val.threshold) || val.threshold < 1 || val.threshold > 10000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BOOKED_MINUTES threshold must be an integer between 1 and 10,000,000',
        path: ['threshold'],
      });
    }
  }
});

// Rule Definition Version 1 Schema
export const RuleDefinitionV1Schema = z.object({
  schema_version: z.literal(1),
  combine: CombineOperatorSchema,
  conditions: z.array(RuleConditionSchema).min(1).max(3),
  recurring: z.boolean(),
  qualification_start_at: z.string().datetime({ offset: true }),
  qualification_end_at: z.string().datetime({ offset: true }).nullable().optional(),
  earning_channels: z.array(ReservationChannelSchema).min(1),
  earning_workspace_type_ids: z.array(z.string().uuid()).max(100).default([]),
  redemption_channels: z.array(ReservationChannelSchema).min(1),
  redemption_workspace_type_ids: z.array(z.string().uuid()).max(100).default([]),
  minimum_booking_amount: z.number().min(0).default(0),
}).strict().superRefine((val, ctx) => {
  // Check condition metric uniqueness
  const metrics = val.conditions.map((c) => c.metric);
  const uniqueMetrics = new Set(metrics);
  if (uniqueMetrics.size !== metrics.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each metric condition must be distinct; duplicate metrics are not allowed',
      path: ['conditions'],
    });
  }

  // Validate qualification window order if end is provided
  if (val.qualification_end_at) {
    const start = new Date(val.qualification_start_at).getTime();
    const end = new Date(val.qualification_end_at).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'qualification_end_at must be strictly after qualification_start_at',
        path: ['qualification_end_at'],
      });
    }
  }
});

// Create/Update Campaign Rule Input Schema
export const CampaignRuleInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  reward_type: RewardTypeSchema,
  reward_value: z.number().positive(),
  max_discount_amount: z.number().positive().nullable().optional(),
  voucher_validity_days: z.number().int().min(1).max(365).default(30),
  rule_definition: RuleDefinitionV1Schema,
  supersedes_rule_id: z.string().uuid().nullable().optional(),
}).strict().superRefine((val, ctx) => {
  if (val.reward_type === 'PERCENTAGE_DISCOUNT') {
    if (val.reward_value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentage discount must be 100% or less',
        path: ['reward_value'],
      });
    }
  } else if (val.reward_type === 'FIXED_AMOUNT_DISCOUNT') {
    if (val.max_discount_amount !== undefined && val.max_discount_amount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_discount_amount is only allowed for percentage discounts',
        path: ['max_discount_amount'],
      });
    }
  }
});

// Create Campaign Input Schema (atomically creates campaign + 1-20 rules)
export const CreateCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  rules: z.array(CampaignRuleInputSchema).min(1).max(20),
}).strict().superRefine((val, ctx) => {
  if (val.starts_at && val.ends_at) {
    const start = new Date(val.starts_at).getTime();
    const end = new Date(val.ends_at).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ends_at must be strictly after starts_at',
        path: ['ends_at'],
      });
    }
  }
});

// Update Campaign Input Schema (for draft campaigns)
export const UpdateCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  expected_revision: z.number().int().positive(),
}).strict().superRefine((val, ctx) => {
  if (val.starts_at && val.ends_at) {
    const start = new Date(val.starts_at).getTime();
    const end = new Date(val.ends_at).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ends_at must be strictly after starts_at',
        path: ['ends_at'],
      });
    }
  }
});

// Campaign Status Transition Schema
export const CampaignStatusTransitionSchema = z.object({
  status: CampaignStatusSchema,
  expected_revision: z.number().int().positive(),
}).strict();

export type ReservationChannel = z.infer<typeof ReservationChannelSchema>;
export type MetricType = z.infer<typeof MetricTypeSchema>;
export type CombineOperator = z.infer<typeof CombineOperatorSchema>;
export type RewardType = z.infer<typeof RewardTypeSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
export type RuleDefinitionV1 = z.infer<typeof RuleDefinitionV1Schema>;
export type CampaignRuleInput = z.infer<typeof CampaignRuleInputSchema>;
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignInputSchema>;
export type CampaignStatusTransition = z.infer<typeof CampaignStatusTransitionSchema>;
