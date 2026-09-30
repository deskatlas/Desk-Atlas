import type { PromotionalRate } from '../models/promotionalRate';

export type PromotionalStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'INACTIVE';

export interface PromotionalFilterCriteria {
  searchQuery?: string;
  workspaceId?: string;
  rateType?: string;
  status?: string;
  now?: number | Date;
}

export function getPromotionalStatus(
  promo: PromotionalRate,
  referenceDate: number | Date = Date.now()
): PromotionalStatus {
  if (!promo.isActive) {
    return 'INACTIVE';
  }

  const nowMs = typeof referenceDate === 'number' ? referenceDate : referenceDate.getTime();
  const startMs = new Date(promo.startAt).getTime();
  const endMs = new Date(promo.endAt).getTime();

  if (nowMs < startMs) {
    return 'UPCOMING';
  }
  if (nowMs >= endMs) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

export function filterPromotionalRates(
  promotions: PromotionalRate[],
  criteria: PromotionalFilterCriteria
): PromotionalRate[] {
  const query = (criteria.searchQuery || '').trim().toLowerCase();
  const workspaceId = criteria.workspaceId || 'ALL';
  const rateType = criteria.rateType || 'ALL';
  const status = criteria.status || 'ALL';
  const now = criteria.now !== undefined ? criteria.now : Date.now();

  return promotions.filter((promo) => {
    // 1. Text Search Filter (name)
    if (query && !promo.name.toLowerCase().includes(query)) {
      return false;
    }

    // 2. Workspace Filter
    if (workspaceId !== 'ALL') {
      if (!promo.workspaceTemplateIds || !promo.workspaceTemplateIds.includes(workspaceId)) {
        return false;
      }
    }

    // 3. Rate Type Filter
    if (rateType !== 'ALL') {
      if (promo.rateType !== rateType) {
        return false;
      }
    }

    // 4. Status Filter
    if (status !== 'ALL') {
      const promoStatus = getPromotionalStatus(promo, now);
      if (promoStatus !== status) {
        return false;
      }
    }

    return true;
  });
}
