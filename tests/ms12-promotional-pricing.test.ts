import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveEffectivePrice,
  validatePromotionalRateInput,
  PromotionalValidationError,
  InMemoryPromotionalRepository,
  createPromotionalService,
  type PromotionalRate,
  type CreatePromotionalRateInput,
  type UpdatePromotionalRateInput,
  type RateTargetType,
} from '@deskatlas/domain';

import {
  GET as adminGetPromotions,
  POST as adminPostPromotion,
  PUT as adminPutPromotion,
  DELETE as adminDeletePromotion,
} from '../apps/admin-portal/src/app/api/admin/promotions/route';
import { setAdminPromotionalService } from '../apps/admin-portal/src/app/api/admin/promotions/_lib/promotionalService';

describe('MS-12: Promotional and Holiday Pricing Engine with Multi-Rate Type Discounts', () => {
  let promoRepo: InMemoryPromotionalRepository;
  let promoService: ReturnType<typeof createPromotionalService>;
  const templateId1 = 'tpl-flowrow-123';
  const templateId2 = 'tpl-focuspod-456';
  const regularHourlyRate = 50;

  beforeEach(() => {
    promoRepo = new InMemoryPromotionalRepository();
    promoService = createPromotionalService(promoRepo);
    setAdminPromotionalService(promoService);
  });

  describe('QAD-TC12.1: Promotion CRUD and validation', () => {
    it('persists a valid promotional campaign', async () => {
      const input: CreatePromotionalRateInput = {
        name: 'Christmas Promo 2026',
        workspaceTemplateIds: [templateId1, templateId2],
        rateType: 'HOURLY',
        promotionalPrice: 40,
        startAt: '2026-12-20T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: true,
      };

      const created = await promoService.createPromotion(input);
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Christmas Promo 2026');
      expect(created.promotionalPrice).toBe(40);
      expect(created.workspaceTemplateIds).toContain(templateId1);
      expect(created.workspaceTemplateIds).toContain(templateId2);
      expect(created.isActive).toBe(true);

      const retrieved = await promoService.getPromotionById(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Christmas Promo 2026');
    });

    it('updates an existing promotional campaign', async () => {
      const created = await promoService.createPromotion({
        name: 'Summer Flash Sale',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 35,
        startAt: '2026-06-01T00:00:00Z',
        endAt: '2026-06-15T23:59:59Z',
        isActive: true,
      });

      const updateInput: UpdatePromotionalRateInput = {
        name: 'Summer Extended Flash Sale',
        promotionalPrice: 30,
        isActive: false,
      };

      const updated = await promoService.updatePromotion(created.id, updateInput);
      expect(updated.name).toBe('Summer Extended Flash Sale');
      expect(updated.promotionalPrice).toBe(30);
      expect(updated.isActive).toBe(false);
    });

    it('deletes a promotion record cleanly', async () => {
      const created = await promoService.createPromotion({
        name: 'Weekend Special',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 45,
        startAt: '2026-10-03T00:00:00Z',
        endAt: '2026-10-04T23:59:59Z',
        isActive: true,
      });

      const deleted = await promoService.deletePromotion(created.id);
      expect(deleted).toBe(true);

      const check = await promoService.getPromotionById(created.id);
      expect(check).toBeNull();
    });

    it('rejects promotion creation when end date is before or equal to start date', () => {
      expect(() => {
        validatePromotionalRateInput({
          name: 'Invalid Window Promo',
          workspaceTemplateIds: [templateId1],
          rateType: 'HOURLY',
          promotionalPrice: 40,
          startAt: '2026-12-31T00:00:00Z',
          endAt: '2026-12-20T00:00:00Z',
          isActive: true,
        });
      }).toThrow(PromotionalValidationError);

      expect(() => {
        validatePromotionalRateInput({
          name: 'Zero Length Promo',
          workspaceTemplateIds: [templateId1],
          rateType: 'HOURLY',
          promotionalPrice: 40,
          startAt: '2026-12-20T00:00:00Z',
          endAt: '2026-12-20T00:00:00Z',
          isActive: true,
        });
      }).toThrow(PromotionalValidationError);
    });

    it('rejects blank campaign name and negative promotional price', () => {
      expect(() => {
        validatePromotionalRateInput({
          name: '   ',
          workspaceTemplateIds: [templateId1],
          rateType: 'HOURLY',
          promotionalPrice: 40,
          startAt: '2026-12-20T00:00:00Z',
          endAt: '2026-12-31T00:00:00Z',
        });
      }).toThrow(PromotionalValidationError);

      expect(() => {
        validatePromotionalRateInput({
          name: 'Negative Promo',
          workspaceTemplateIds: [templateId1],
          rateType: 'HOURLY',
          promotionalPrice: -10,
          startAt: '2026-12-20T00:00:00Z',
          endAt: '2026-12-31T00:00:00Z',
        });
      }).toThrow(PromotionalValidationError);
    });

    it('rejects empty workspace template list', () => {
      expect(() => {
        validatePromotionalRateInput({
          name: 'No Template Promo',
          workspaceTemplateIds: [],
          rateType: 'HOURLY',
          promotionalPrice: 40,
          startAt: '2026-12-20T00:00:00Z',
          endAt: '2026-12-31T00:00:00Z',
        });
      }).toThrow(PromotionalValidationError);
    });
  });

  describe('QAD-TC12.2: Active date evaluation', () => {
    const promoList: PromotionalRate[] = [
      {
        id: 'promo-1',
        name: 'Christmas Promo 2026',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 40,
        startAt: '2026-12-20T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: true,
      },
    ];

    it('applies promotional price when target date is strictly inside the promo window', () => {
      const targetDate = '2026-12-25T14:00:00Z';
      const resolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        regularHourlyRate,
        targetDate,
        promoList,
        2
      );

      expect(resolved.isPromotional).toBe(true);
      expect(resolved.effectivePrice).toBe(40);
      expect(resolved.regularPrice).toBe(50);
      expect(resolved.promotionalRateId).toBe('promo-1');
      expect(resolved.promoName).toBe('Christmas Promo 2026');
      expect(resolved.estimatedTotal).toBe(80);
    });

    it('applies promotional rate at exact start boundary', () => {
      const boundaryDate = '2026-12-20T00:00:00Z';
      const resolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        regularHourlyRate,
        boundaryDate,
        promoList,
        1
      );

      expect(resolved.isPromotional).toBe(true);
      expect(resolved.effectivePrice).toBe(40);
      expect(resolved.estimatedTotal).toBe(40);
    });
  });

  describe('QAD-TC12.3: Expired promo fallback', () => {
    const promoList: PromotionalRate[] = [
      {
        id: 'promo-1',
        name: 'Christmas Promo 2026',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 40,
        startAt: '2026-12-20T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: true,
      },
      {
        id: 'promo-inactive',
        name: 'Deactivated Promo',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 20,
        startAt: '2026-01-01T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: false,
      },
    ];

    it('falls back to regular price when booking date is before promo start', () => {
      const beforeDate = '2026-12-19T23:59:59Z';
      const resolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        regularHourlyRate,
        beforeDate,
        promoList,
        2
      );

      expect(resolved.isPromotional).toBe(false);
      expect(resolved.effectivePrice).toBe(50);
      expect(resolved.regularPrice).toBe(50);
      expect(resolved.estimatedTotal).toBe(100);
      expect(resolved.promoName).toBeUndefined();
    });

    it('falls back to regular price when booking date is at or after promo end', () => {
      const afterDate = '2027-01-01T00:00:00Z';
      const resolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        regularHourlyRate,
        afterDate,
        promoList,
        3
      );

      expect(resolved.isPromotional).toBe(false);
      expect(resolved.effectivePrice).toBe(50);
      expect(resolved.regularPrice).toBe(50);
      expect(resolved.estimatedTotal).toBe(150);
    });

    it('ignores deactivated promotions even if target date is within range', () => {
      const targetDate = '2026-06-15T10:00:00Z';
      const resolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        regularHourlyRate,
        targetDate,
        [promoList[1]],
        1
      );

      expect(resolved.isPromotional).toBe(false);
      expect(resolved.effectivePrice).toBe(50);
      expect(resolved.estimatedTotal).toBe(50);
    });

    it('falls back to regular price when workspace template is not in targeted template IDs', () => {
      const targetDate = '2026-12-25T14:00:00Z';
      const unTargetedTemplateId = 'tpl-other-999';
      const resolved = resolveEffectivePrice(
        unTargetedTemplateId,
        'HOURLY',
        100,
        targetDate,
        promoList,
        1
      );

      expect(resolved.isPromotional).toBe(false);
      expect(resolved.effectivePrice).toBe(100);
      expect(resolved.estimatedTotal).toBe(100);
    });
  });

  describe('QAD-TC12.4: Multi-tier rate support', () => {
    const multiTierPromos: PromotionalRate[] = [
      {
        id: 'promo-hourly',
        name: 'Hourly Discount',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 38,
        startAt: '2026-09-01T00:00:00Z',
        endAt: '2026-09-30T23:59:59Z',
        isActive: true,
      },
      {
        id: 'promo-daypass',
        name: 'Day Pass Special',
        workspaceTemplateIds: [templateId1],
        rateType: 'DAY_PASS',
        promotionalPrice: 280,
        startAt: '2026-09-01T00:00:00Z',
        endAt: '2026-09-30T23:59:59Z',
        isActive: true,
      },
      {
        id: 'promo-nightpass',
        name: 'Night Owl Promo',
        workspaceTemplateIds: [templateId1],
        rateType: 'NIGHT_PASS',
        promotionalPrice: 200,
        startAt: '2026-09-01T00:00:00Z',
        endAt: '2026-09-30T23:59:59Z',
        isActive: true,
      },
    ];

    it('correctly targets HOURLY rate without leaking into pass tiers', () => {
      const targetDate = '2026-09-15T12:00:00Z';
      const hourlyResolved = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        50,
        targetDate,
        multiTierPromos,
        4
      );

      expect(hourlyResolved.isPromotional).toBe(true);
      expect(hourlyResolved.rateType).toBe('HOURLY');
      expect(hourlyResolved.effectivePrice).toBe(38);
      expect(hourlyResolved.promoName).toBe('Hourly Discount');
      expect(hourlyResolved.estimatedTotal).toBe(152); // 38 * 4
    });

    it('correctly targets DAY_PASS fixed price without multiplying duration', () => {
      const targetDate = '2026-09-15T12:00:00Z';
      const dayPassResolved = resolveEffectivePrice(
        templateId1,
        'DAY_PASS',
        350,
        targetDate,
        multiTierPromos,
        1
      );

      expect(dayPassResolved.isPromotional).toBe(true);
      expect(dayPassResolved.rateType).toBe('DAY_PASS');
      expect(dayPassResolved.effectivePrice).toBe(280);
      expect(dayPassResolved.promoName).toBe('Day Pass Special');
      expect(dayPassResolved.estimatedTotal).toBe(280);
    });

    it('correctly targets NIGHT_PASS tier specifically', () => {
      const targetDate = '2026-09-15T22:00:00Z';
      const nightPassResolved = resolveEffectivePrice(
        templateId1,
        'NIGHT_PASS',
        250,
        targetDate,
        multiTierPromos,
        1
      );

      expect(nightPassResolved.isPromotional).toBe(true);
      expect(nightPassResolved.rateType).toBe('NIGHT_PASS');
      expect(nightPassResolved.effectivePrice).toBe(200);
      expect(nightPassResolved.promoName).toBe('Night Owl Promo');
      expect(nightPassResolved.estimatedTotal).toBe(200);
    });
  });

  describe('QAD-TC12.5: Kiosk & Web summary payload', () => {
    it('returns complete payload structure for UI presentation', () => {
      const promo: PromotionalRate = {
        id: 'holiday-promo',
        name: 'Holiday Promo',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 40,
        startAt: '2026-12-01T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: true,
      };

      const result = resolveEffectivePrice(
        templateId1,
        'HOURLY',
        50,
        '2026-12-10T10:00:00Z',
        [promo],
        3
      );

      expect(result).toEqual({
        regularPrice: 50,
        effectivePrice: 40,
        isPromotional: true,
        promotionalRateId: 'holiday-promo',
        promoName: 'Holiday Promo',
        rateType: 'HOURLY',
        estimatedTotal: 120,
      });
    });

    it('computes correct totals for multiple duration hours', () => {
      const promo: PromotionalRate = {
        id: 'flash-promo',
        name: 'Flash Promo',
        workspaceTemplateIds: [templateId1],
        rateType: 'HOURLY',
        promotionalPrice: 45.5,
        startAt: '2026-12-01T00:00:00Z',
        endAt: '2026-12-31T23:59:59Z',
        isActive: true,
      };

      const dur1 = resolveEffectivePrice(templateId1, 'HOURLY', 50, '2026-12-05T10:00:00Z', [promo], 1);
      const dur4 = resolveEffectivePrice(templateId1, 'HOURLY', 50, '2026-12-05T10:00:00Z', [promo], 4);
      const dur8 = resolveEffectivePrice(templateId1, 'HOURLY', 50, '2026-12-05T10:00:00Z', [promo], 8);

      expect(dur1.estimatedTotal).toBe(45.5);
      expect(dur4.estimatedTotal).toBe(182);
      expect(dur8.estimatedTotal).toBe(364);
    });
  });

  describe('Admin Promotions API Routes Verification', () => {
    it('creates and lists promotions via API handlers', async () => {
      const postReq = new Request('http://localhost:3000/api/admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Year Discount',
          workspaceTemplateIds: [templateId1],
          rateType: 'HOURLY',
          promotionalPrice: 35,
          startAt: '2027-01-01T00:00:00Z',
          endAt: '2027-01-07T23:59:59Z',
          isActive: true,
        }),
      });

      const postRes = await adminPostPromotion(postReq);
      expect(postRes.status).toBe(201);
      const postBody = await postRes.json();
      expect(postBody.data.name).toBe('New Year Discount');
      const createdId = postBody.data.id;

      // GET list
      const getReq = new Request('http://localhost:3000/api/admin/promotions');
      const getRes = await adminGetPromotions(getReq);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.data.length).toBeGreaterThanOrEqual(1);

      // GET by id
      const getSingleReq = new Request(`http://localhost:3000/api/admin/promotions?id=${createdId}`);
      const getSingleRes = await adminGetPromotions(getSingleReq);
      expect(getSingleRes.status).toBe(200);
      const singleBody = await getSingleRes.json();
      expect(singleBody.data.id).toBe(createdId);

      // PUT update
      const putReq = new Request(`http://localhost:3000/api/admin/promotions?id=${createdId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'New Year Extended Discount',
          promotionalPrice: 30,
        }),
      });
      const putRes = await adminPutPromotion(putReq);
      expect(putRes.status).toBe(200);
      const putBody = await putRes.json();
      expect(putBody.data.name).toBe('New Year Extended Discount');
      expect(putBody.data.promotionalPrice).toBe(30);

      // DELETE
      const deleteReq = new Request(`http://localhost:3000/api/admin/promotions?id=${createdId}`, {
        method: 'DELETE',
      });
      const deleteRes = await adminDeletePromotion(deleteReq);
      expect(deleteRes.status).toBe(200);
      const deleteBody = await deleteRes.json();
      expect(deleteBody.success).toBe(true);
    });

    it('returns 400 validation error on invalid input in API', async () => {
      const postReq = new Request('http://localhost:3000/api/admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          name: '',
          workspaceTemplateIds: [],
          rateType: 'HOURLY',
          promotionalPrice: -5,
          startAt: '2027-01-10T00:00:00Z',
          endAt: '2027-01-01T00:00:00Z',
        }),
      });

      const postRes = await adminPostPromotion(postReq);
      expect(postRes.status).toBe(400);
      const body = await postRes.json();
      expect(body.error).toBeDefined();
    });
  });
});
