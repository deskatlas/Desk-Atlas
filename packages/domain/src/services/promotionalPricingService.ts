import type {
  CreatePromotionalRateInput,
  PromotionalRate,
  RateTargetType,
  ResolvedPricing,
  UpdatePromotionalRateInput,
} from '../models/promotionalRate';

export class PromotionalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionalValidationError';
  }
}

export function validatePromotionalRateInput(
  input: CreatePromotionalRateInput | UpdatePromotionalRateInput,
  isUpdate: boolean = false
): void {
  if (!isUpdate || input.name !== undefined) {
    if (!input.name || input.name.trim() === '') {
      throw new PromotionalValidationError('Promotion name cannot be blank.');
    }
  }

  if (!isUpdate || input.workspaceTemplateIds !== undefined) {
    if (!Array.isArray(input.workspaceTemplateIds) || input.workspaceTemplateIds.length === 0) {
      throw new PromotionalValidationError('At least one workspace template must be selected.');
    }
  }

  if (!isUpdate || input.rateType !== undefined) {
    const validRateTypes: RateTargetType[] = ['HOURLY', 'DAY_PASS', 'NIGHT_PASS', 'WHOLE_DAY_PASS', 'HALF_DAY_PASS'];
    if (!input.rateType || !validRateTypes.includes(input.rateType)) {
      throw new PromotionalValidationError('Invalid rate type specified.');
    }
  }

  if (!isUpdate || input.promotionalPrice !== undefined) {
    if (typeof input.promotionalPrice !== 'number' || isNaN(input.promotionalPrice) || input.promotionalPrice < 0) {
      throw new PromotionalValidationError('Promotional price must be a non-negative number.');
    }
  }

  if (input.startAt !== undefined && input.endAt !== undefined) {
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      throw new PromotionalValidationError('Invalid start or end date format.');
    }
    if (startMs >= endMs) {
      throw new PromotionalValidationError('End date must be strictly after start date.');
    }
  } else if (!isUpdate) {
    if (!input.startAt || !input.endAt) {
      throw new PromotionalValidationError('Both start date and end date are required.');
    }
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();
    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      throw new PromotionalValidationError('End date must be strictly after start date.');
    }
  }
}

export function resolveEffectivePrice(
  templateId: string,
  rateType: RateTargetType,
  regularPrice: number,
  targetDateTime: string | Date,
  activePromotions: PromotionalRate[],
  durationHours: number = 1
): ResolvedPricing {
  const targetMs = new Date(targetDateTime).getTime();

  // Find matching active promotion for this template, rate type, and time window
  const match = activePromotions.find((promo) => {
    if (!promo.isActive) return false;
    if (promo.rateType !== rateType) return false;
    if (!promo.workspaceTemplateIds.includes(templateId)) return false;

    const startMs = new Date(promo.startAt).getTime();
    const endMs = new Date(promo.endAt).getTime();
    return targetMs >= startMs && targetMs < endMs;
  });

  if (!match) {
    const total = rateType === 'HOURLY' ? regularPrice * durationHours : regularPrice;
    return {
      regularPrice,
      effectivePrice: regularPrice,
      isPromotional: false,
      rateType,
      estimatedTotal: Math.round(total * 100) / 100,
    };
  }

  const promoTotal = rateType === 'HOURLY'
    ? match.promotionalPrice * durationHours
    : match.promotionalPrice;

  return {
    regularPrice,
    effectivePrice: match.promotionalPrice,
    isPromotional: true,
    promotionalRateId: match.id,
    promoName: match.name,
    rateType,
    estimatedTotal: Math.round(promoTotal * 100) / 100,
  };
}
