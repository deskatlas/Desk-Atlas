import type {
  CreatePromotionalRateInput,
  PromotionalRate,
  UpdatePromotionalRateInput,
} from '../models/promotionalRate';
import type { PromotionalRateRepository } from './promotionalRateRepository';
import { PromotionalValidationError, validatePromotionalRateInput } from './promotionalPricingService';

export class InMemoryPromotionalRepository implements PromotionalRateRepository {
  private promotions: PromotionalRate[] = [];

  constructor(initialPromotions: PromotionalRate[] = []) {
    this.promotions = [...initialPromotions];
  }

  async listPromotions(options?: { onlyActive?: boolean }): Promise<PromotionalRate[]> {
    if (options?.onlyActive) {
      return this.promotions.filter((p) => p.isActive);
    }
    return [...this.promotions];
  }

  async getPromotionById(id: string): Promise<PromotionalRate | null> {
    const promo = this.promotions.find((p) => p.id === id);
    return promo ? { ...promo } : null;
  }

  async createPromotion(input: CreatePromotionalRateInput): Promise<PromotionalRate> {
    validatePromotionalRateInput(input);
    const newPromo: PromotionalRate = {
      id: `promo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: input.name.trim(),
      workspaceTemplateIds: [...input.workspaceTemplateIds],
      rateType: input.rateType,
      promotionalPrice: input.promotionalPrice,
      startAt: new Date(input.startAt).toISOString(),
      endAt: new Date(input.endAt).toISOString(),
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.promotions.push(newPromo);
    return { ...newPromo };
  }

  async updatePromotion(id: string, input: UpdatePromotionalRateInput): Promise<PromotionalRate> {
    const index = this.promotions.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new PromotionalValidationError(`Promotion not found: ${id}`);
    }
    validatePromotionalRateInput(input, true);

    const existing = this.promotions[index];
    const updated: PromotionalRate = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      workspaceTemplateIds: input.workspaceTemplateIds !== undefined ? [...input.workspaceTemplateIds] : existing.workspaceTemplateIds,
      rateType: input.rateType !== undefined ? input.rateType : existing.rateType,
      promotionalPrice: input.promotionalPrice !== undefined ? input.promotionalPrice : existing.promotionalPrice,
      startAt: input.startAt !== undefined ? new Date(input.startAt).toISOString() : existing.startAt,
      endAt: input.endAt !== undefined ? new Date(input.endAt).toISOString() : existing.endAt,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      updatedAt: new Date().toISOString(),
    };

    if (new Date(updated.startAt).getTime() >= new Date(updated.endAt).getTime()) {
      throw new PromotionalValidationError('End date must be strictly after start date.');
    }

    this.promotions[index] = updated;
    return { ...updated };
  }

  async deletePromotion(id: string): Promise<boolean> {
    const initialLength = this.promotions.length;
    this.promotions = this.promotions.filter((p) => p.id !== id);
    return this.promotions.length < initialLength;
  }

  async deletePromotions(ids: string[]): Promise<boolean> {
    const idSet = new Set(ids);
    const initialLength = this.promotions.length;
    this.promotions = this.promotions.filter((p) => !idSet.has(p.id));
    return this.promotions.length < initialLength;
  }
}

export { InMemoryPromotionalRepository as PromotionalMemoryRepository };
