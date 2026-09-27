export type RateTargetType = 'HOURLY' | 'DAY_PASS' | 'NIGHT_PASS' | 'WHOLE_DAY_PASS' | 'HALF_DAY_PASS';

export interface PromotionalRate {
  id: string;
  name: string;
  workspaceTemplateIds: string[];
  rateType: RateTargetType;
  promotionalPrice: number;
  startAt: string;
  endAt: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePromotionalRateInput {
  name: string;
  workspaceTemplateIds: string[];
  rateType: RateTargetType;
  promotionalPrice: number;
  startAt: string;
  endAt: string;
  isActive?: boolean;
}

export interface UpdatePromotionalRateInput {
  name?: string;
  workspaceTemplateIds?: string[];
  rateType?: RateTargetType;
  promotionalPrice?: number;
  startAt?: string;
  endAt?: string;
  isActive?: boolean;
}

export interface ResolvedPricing {
  regularPrice: number;
  effectivePrice: number;
  isPromotional: boolean;
  promotionalRateId?: string | null;
  promoName?: string | null;
  rateType: RateTargetType;
  estimatedTotal: number;
}
