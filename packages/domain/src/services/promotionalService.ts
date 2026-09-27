import type {
  CreatePromotionalRateInput,
  PromotionalRate,
  RateTargetType,
  ResolvedPricing,
  UpdatePromotionalRateInput,
} from '../models/promotionalRate';
import type { PromotionalRateRepository } from './promotionalRateRepository';
import { resolveEffectivePrice } from './promotionalPricingService';

export class PromotionalService {
  constructor(private readonly repository: PromotionalRateRepository) {}

  async listPromotions(options?: { onlyActive?: boolean }): Promise<PromotionalRate[]> {
    return this.repository.listPromotions(options);
  }

  async getPromotionById(id: string): Promise<PromotionalRate | null> {
    return this.repository.getPromotionById(id);
  }

  async createPromotion(input: CreatePromotionalRateInput): Promise<PromotionalRate> {
    return this.repository.createPromotion(input);
  }

  async updatePromotion(id: string, input: UpdatePromotionalRateInput): Promise<PromotionalRate> {
    return this.repository.updatePromotion(id, input);
  }

  async deletePromotion(id: string): Promise<boolean> {
    return this.repository.deletePromotion(id);
  }

  async resolvePricingForTemplate(
    templateId: string,
    rateType: RateTargetType,
    regularPrice: number,
    targetDateTime: string | Date,
    durationHours: number = 1
  ): Promise<ResolvedPricing> {
    const activePromotions = await this.repository.listPromotions({ onlyActive: true });
    return resolveEffectivePrice(templateId, rateType, regularPrice, targetDateTime, activePromotions, durationHours);
  }
}

export function createPromotionalService(repository: PromotionalRateRepository): PromotionalService {
  return new PromotionalService(repository);
}
