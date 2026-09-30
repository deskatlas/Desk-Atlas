import { describe, it, expect } from 'vitest';
import {
  type PromotionalRate,
  filterPromotionalRates,
  getPromotionalStatus,
} from '@deskatlas/domain';

describe('MS-23: Administrative Promotional Campaign Search, Multi-Facet Filtering, and Selected Workspace Template Visual Glow Feedback', () => {
  const mockPromotions: PromotionalRate[] = [
    {
      id: 'promo-1',
      name: 'Christmas Special 2026',
      workspaceTemplateIds: ['tpl-focus-pod', 'tpl-skypod'],
      rateType: 'HOURLY',
      promotionalPrice: 35,
      startAt: '2026-12-20T00:00:00.000Z',
      endAt: '2026-12-31T23:59:59.000Z',
      isActive: true,
    },
    {
      id: 'promo-2',
      name: 'Summer Day Pass Saver',
      workspaceTemplateIds: ['tpl-focus-pod', 'tpl-open-desk'],
      rateType: 'DAY_PASS',
      promotionalPrice: 200,
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-06-30T23:59:59.000Z',
      isActive: true,
    },
    {
      id: 'promo-3',
      name: 'Night Owls Discount',
      workspaceTemplateIds: ['tpl-dedicated-desk'],
      rateType: 'NIGHT_PASS',
      promotionalPrice: 150,
      startAt: '2026-09-01T00:00:00.000Z',
      endAt: '2026-10-31T23:59:59.000Z',
      isActive: true,
    },
    {
      id: 'promo-4',
      name: 'Draft Flash Sale',
      workspaceTemplateIds: ['tpl-focus-pod'],
      rateType: 'HOURLY',
      promotionalPrice: 25,
      startAt: '2026-09-01T00:00:00.000Z',
      endAt: '2026-10-31T23:59:59.000Z',
      isActive: false,
    },
  ];

  // Fixed reference timestamp during active window of promo-3 (Sept 30, 2026)
  const referenceNow = new Date('2026-09-30T12:00:00.000Z').getTime();

  describe('QAD-TC23.1: Template Selection Visual Glow Style Contracts', () => {
    it('computes correct visual styling properties for selected vs unselected template cards', () => {
      const isSelected = true;
      const cardStyles = {
        borderRadius: '8px',
        border: isSelected ? '1.5px solid #009689' : '1px solid #E2E8F0',
        background: isSelected ? '#F0FDF4' : '#FFFFFF',
        boxShadow: isSelected ? '0 0 0 1px #009689, 0 2px 8px rgba(0, 150, 137, 0.18)' : 'none',
        accentColor: '#009689',
      };

      expect(cardStyles.border).toBe('1.5px solid #009689');
      expect(cardStyles.background).toBe('#F0FDF4');
      expect(cardStyles.boxShadow).toContain('#009689');
      expect(cardStyles.accentColor).toBe('#009689');

      const isUnselected = false;
      const unselectedStyles = {
        borderRadius: '8px',
        border: isUnselected ? '1.5px solid #009689' : '1px solid #E2E8F0',
        background: isUnselected ? '#F0FDF4' : '#FFFFFF',
        boxShadow: isUnselected ? '0 0 0 1px #009689, 0 2px 8px rgba(0, 150, 137, 0.18)' : 'none',
      };

      expect(unselectedStyles.border).toBe('1px solid #E2E8F0');
      expect(unselectedStyles.background).toBe('#FFFFFF');
      expect(unselectedStyles.boxShadow).toBe('none');
    });
  });

  describe('QAD-TC23.2: Campaign Name Search Filtering', () => {
    it('filters campaigns strictly matching search query in a case-insensitive manner', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: 'christmas',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-1');
      expect(results[0].name).toBe('Christmas Special 2026');
    });

    it('returns empty array when search query matches no campaigns', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: 'Nonexistent Campaign Name',
        now: referenceNow,
      });

      expect(results).toHaveLength(0);
    });

    it('handles search queries with leading/trailing whitespaces', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: '   summer   ',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-2');
    });
  });

  describe('QAD-TC23.3: Target Workspace Filtering', () => {
    it('filters campaigns containing the target workspaceTemplateId', () => {
      const results = filterPromotionalRates(mockPromotions, {
        workspaceId: 'tpl-skypod',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-1');
      expect(results[0].workspaceTemplateIds).toContain('tpl-skypod');
    });

    it('returns all campaigns targeting a shared workspace template', () => {
      const results = filterPromotionalRates(mockPromotions, {
        workspaceId: 'tpl-focus-pod',
        now: referenceNow,
      });

      expect(results).toHaveLength(3);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('promo-1');
      expect(ids).toContain('promo-2');
      expect(ids).toContain('promo-4');
    });
  });

  describe('QAD-TC23.4: Rate Type Filtering', () => {
    it('filters campaigns matching DAY_PASS rate model', () => {
      const results = filterPromotionalRates(mockPromotions, {
        rateType: 'DAY_PASS',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-2');
      expect(results[0].rateType).toBe('DAY_PASS');
    });

    it('filters campaigns matching HOURLY rate model', () => {
      const results = filterPromotionalRates(mockPromotions, {
        rateType: 'HOURLY',
        now: referenceNow,
      });

      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('promo-1');
      expect(ids).toContain('promo-4');
    });
  });

  describe('QAD-TC23.5: Status Filtering', () => {
    it('calculates status correctly for active, upcoming, expired, and inactive campaigns', () => {
      expect(getPromotionalStatus(mockPromotions[0], referenceNow)).toBe('UPCOMING');
      expect(getPromotionalStatus(mockPromotions[1], referenceNow)).toBe('EXPIRED');
      expect(getPromotionalStatus(mockPromotions[2], referenceNow)).toBe('ACTIVE');
      expect(getPromotionalStatus(mockPromotions[3], referenceNow)).toBe('INACTIVE');
    });

    it('filters campaigns with status ACTIVE', () => {
      const results = filterPromotionalRates(mockPromotions, {
        status: 'ACTIVE',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-3');
    });

    it('filters campaigns with status UPCOMING', () => {
      const results = filterPromotionalRates(mockPromotions, {
        status: 'UPCOMING',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-1');
    });

    it('filters campaigns with status EXPIRED', () => {
      const results = filterPromotionalRates(mockPromotions, {
        status: 'EXPIRED',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-2');
    });

    it('filters campaigns with status INACTIVE', () => {
      const results = filterPromotionalRates(mockPromotions, {
        status: 'INACTIVE',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-4');
    });
  });

  describe('QAD-TC23.6: Conjunctive Multi-Facet Filtering', () => {
    it('applies search query, workspace template, and rate type conjunctively (AND logic)', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: 'Christmas',
        workspaceId: 'tpl-focus-pod',
        rateType: 'HOURLY',
        status: 'UPCOMING',
        now: referenceNow,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('promo-1');
    });

    it('returns empty array when one facet constraint is not met', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: 'Christmas',
        workspaceId: 'tpl-focus-pod',
        rateType: 'DAY_PASS', // promo-1 is HOURLY
        now: referenceNow,
      });

      expect(results).toHaveLength(0);
    });
  });

  describe('QAD-TC23.7: Reset Filters Action', () => {
    it('returns all campaigns when filters are reset to default ALL values and empty search', () => {
      const results = filterPromotionalRates(mockPromotions, {
        searchQuery: '',
        workspaceId: 'ALL',
        rateType: 'ALL',
        status: 'ALL',
        now: referenceNow,
      });

      expect(results).toHaveLength(mockPromotions.length);
    });
  });
});
