import type {
  CreatePromotionalRateInput,
  PromotionalRate,
  UpdatePromotionalRateInput,
} from '../models/promotionalRate';

export interface PromotionalRateRepository {
  listPromotions(options?: { onlyActive?: boolean }): Promise<PromotionalRate[]>;
  getPromotionById(id: string): Promise<PromotionalRate | null>;
  createPromotion(input: CreatePromotionalRateInput): Promise<PromotionalRate>;
  updatePromotion(id: string, input: UpdatePromotionalRateInput): Promise<PromotionalRate>;
  deletePromotion(id: string): Promise<boolean>;
}
