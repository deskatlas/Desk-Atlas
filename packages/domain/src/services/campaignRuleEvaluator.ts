import type {
  CampaignRule,
  ConditionProgress,
  QualifyingBookingFact,
  RuleCondition,
  RuleDefinitionV1,
  RuleEvaluationProgress,
  VoucherStatus,
} from '../models/campaign';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

// 32-character alphabet specified in SPEC-1 and SPEC-2
export const PROMO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate an unbiased random 8-character promo code from the 32-symbol alphabet.
 */
export function generatePromoCode(): string {
  let result = '';
  const alphabetLength = PROMO_CODE_ALPHABET.length;
  // Use crypto if available (Node or Browser), otherwise fallback to Math.random
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  if (hasCrypto) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 8; i++) {
      // 256 is an exact multiple of 32 (32 * 8 = 256), so modulo has zero bias!
      result += PROMO_CODE_ALPHABET[bytes[i] % alphabetLength];
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(Math.random() * alphabetLength);
      result += PROMO_CODE_ALPHABET[idx];
    }
  }
  return result;
}

/**
 * Calculate effective voucher status taking current time into account.
 * USED if redeemed, otherwise EXPIRED if now >= expires_at, otherwise AVAILABLE.
 */
export function calculateEffectiveVoucherStatus(voucher: {
  status: VoucherStatus;
  expires_at: string;
  redeemed_at?: string | null;
  redeemed_reservation_id?: string | null;
  pending_reservation_id?: string | null;
}, nowIso?: string): VoucherStatus {
  if (voucher.redeemed_at || voucher.redeemed_reservation_id || voucher.status === 'USED') {
    return 'USED';
  }
  if (voucher.pending_reservation_id || voucher.status === 'PENDING_REDEMPTION') {
    return 'PENDING_REDEMPTION';
  }
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const expiry = new Date(voucher.expires_at).getTime();
  if (now >= expiry) {
    return 'EXPIRED';
  }
  return 'AVAILABLE';
}

/**
 * Calculate discount amount with centavo precision and the mandatory PHP 0.01 payable floor.
 */
export function calculateDiscountAmount(params: {
  grossAmount: number;
  rewardType: 'PERCENTAGE_DISCOUNT' | 'FIXED_AMOUNT_DISCOUNT';
  rewardValue: number;
  maxDiscountAmount?: number | null;
}): {
  rawDiscount: number;
  effectiveDiscount: number;
  payableAmount: number;
} {
  const { grossAmount, rewardType, rewardValue, maxDiscountAmount } = params;

  // Round gross to centavos
  const grossCentavos = Math.round(grossAmount * 100);

  let calculatedDiscountCentavos = 0;

  if (rewardType === 'PERCENTAGE_DISCOUNT') {
    // Percentage discount rounded half-up once to centavos
    calculatedDiscountCentavos = Math.round((grossCentavos * rewardValue) / 100);
    if (maxDiscountAmount !== undefined && maxDiscountAmount !== null && maxDiscountAmount > 0) {
      const maxCapCentavos = Math.round(maxDiscountAmount * 100);
      calculatedDiscountCentavos = Math.min(calculatedDiscountCentavos, maxCapCentavos);
    }
  } else {
    // Fixed amount discount in centavos
    calculatedDiscountCentavos = Math.round(rewardValue * 100);
  }

  const rawDiscount = calculatedDiscountCentavos / 100;

  // SPEC-2 invariant: Every voucher discount is capped so at least PHP 0.01 remains payable.
  // Maximum discount allowed = max(0, gross - 0.01)
  const maxAllowableDiscountCentavos = Math.max(0, grossCentavos - 1);
  const effectiveDiscountCentavos = Math.min(calculatedDiscountCentavos, maxAllowableDiscountCentavos);

  const effectiveDiscount = effectiveDiscountCentavos / 100;
  const payableCentavos = grossCentavos - effectiveDiscountCentavos;
  const payableAmount = payableCentavos / 100;

  return {
    rawDiscount,
    effectiveDiscount,
    payableAmount,
  };
}

/**
 * Check if a booking fact satisfies all rule-specific qualification constraints.
 */
export function isFactQualifyingForRule(
  fact: QualifyingBookingFact,
  ruleDef: RuleDefinitionV1,
  evaluationCutoffIso: string
): boolean {
  // Fact must be actively qualifying (not cancelled)
  if (!fact.is_qualifying) {
    return false;
  }

  const factTime = new Date(fact.confirmed_at).getTime();
  const cutoffTime = new Date(evaluationCutoffIso).getTime();

  // Evaluated only on or before the job's immutable cutoff
  if (factTime > cutoffTime) {
    return false;
  }

  // Qualification window: half-open [qualification_start_at, qualification_end_at)
  const startTime = new Date(ruleDef.qualification_start_at).getTime();
  if (factTime < startTime) {
    return false;
  }

  if (ruleDef.qualification_end_at) {
    const endTime = new Date(ruleDef.qualification_end_at).getTime();
    if (factTime >= endTime) {
      return false;
    }
  }

  // Channel filter
  if (ruleDef.earning_channels && ruleDef.earning_channels.length > 0) {
    if (!ruleDef.earning_channels.includes(fact.source)) {
      return false;
    }
  }

  // Workspace template filter (empty means all)
  if (ruleDef.earning_workspace_type_ids && ruleDef.earning_workspace_type_ids.length > 0) {
    if (!ruleDef.earning_workspace_type_ids.includes(fact.workspace_type_id)) {
      return false;
    }
  }

  // Minimum booking amount filter
  if (ruleDef.minimum_booking_amount && ruleDef.minimum_booking_amount > 0) {
    if (fact.net_paid_amount < ruleDef.minimum_booking_amount) {
      return false;
    }
  }

  return true;
}

/**
 * Aggregate facts for a specific metric.
 */
export function calculateMetricTotal(
  facts: QualifyingBookingFact[],
  metric: 'BOOKING_COUNT' | 'NET_SPEND' | 'BOOKED_MINUTES'
): number {
  if (metric === 'BOOKING_COUNT') {
    return facts.length;
  }
  if (metric === 'NET_SPEND') {
    const totalCentavos = facts.reduce((acc, f) => acc + Math.round(f.net_paid_amount * 100), 0);
    return totalCentavos / 100;
  }
  if (metric === 'BOOKED_MINUTES') {
    return facts.reduce((acc, f) => acc + f.booked_minutes, 0);
  }
  return 0;
}

/**
 * Evaluate customer progress and milestone cycles against a campaign rule.
 */
export function evaluateRuleProgress(
  rule: CampaignRule,
  facts: QualifyingBookingFact[],
  evaluationCutoffIso: string
): {
  targetCycles: number;
  progress: RuleEvaluationProgress;
} {
  const ruleDef = rule.rule_definition;
  const qualifyingFacts = facts.filter((f) => isFactQualifyingForRule(f, ruleDef, evaluationCutoffIso));

  const conditionProgressList: ConditionProgress[] = ruleDef.conditions.map((cond: RuleCondition) => {
    const total = calculateMetricTotal(qualifyingFacts, cond.metric);
    const cycles = Math.floor(total / cond.threshold);

    let remainingToNext = 0;
    if (!ruleDef.recurring && cycles >= 1) {
      remainingToNext = 0;
    } else {
      const nextCycle = cycles + 1;
      const targetForNext = nextCycle * cond.threshold;
      if (cond.metric === 'NET_SPEND') {
        const remainingCentavos = Math.max(0, Math.round((targetForNext - total) * 100));
        remainingToNext = remainingCentavos / 100;
      } else {
        remainingToNext = Math.max(0, targetForNext - total);
      }
    }

    return {
      metric: cond.metric,
      current: total,
      threshold: cond.threshold,
      remaining_to_next: remainingToNext,
      cycles,
    };
  });

  const cycleCounts = conditionProgressList.map((cp) => cp.cycles);
  let targetCycles = 0;

  if (ruleDef.combine === 'ALL') {
    targetCycles = Math.min(...cycleCounts);
  } else {
    // ANY
    targetCycles = Math.max(...cycleCounts);
  }

  if (!ruleDef.recurring) {
    targetCycles = targetCycles >= 1 ? 1 : 0;
  }

  const isCompleted = !ruleDef.recurring && targetCycles >= 1;
  const nextMilestone = isCompleted ? null : targetCycles + 1;

  const progress: RuleEvaluationProgress = {
    rule_id: rule.id,
    rule_label: rule.label,
    combine: ruleDef.combine,
    conditions: conditionProgressList,
    earned_milestones: targetCycles,
    next_milestone: nextMilestone,
    is_completed: isCompleted,
  };

  return {
    targetCycles,
    progress,
  };
}
