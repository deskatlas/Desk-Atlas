import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatEmailBookingDate,
  formatEmailBookingTimeRange,
  renderManualResolutionEmail,
  renderClosureManualResolutionEmail,
  TransactionalEmailService,
  PromotionalService,
  PromotionalMemoryRepository,
  filterPromotionalRates,
  type CreatePromotionalRateInput,
  type PromotionalRate,
} from '@deskatlas/domain';

describe('MS-32: Transactional Manual Resolution Email Schedule Precision and Promotions Bulk Deletion', () => {
  describe('Email Schedule Formatting & Precision (QAD-TC32-01, QAD-TC32-02)', () => {
    it('QAD-TC32-01: formatEmailBookingDate formats ISO timestamps into long human-readable date', () => {
      // Monday in UTC / PHT
      const iso = '2026-10-05T09:00:00.000Z';
      const formatted = formatEmailBookingDate(iso, 'UTC');
      expect(formatted).toBe('Monday, October 5, 2026');
    });

    it('QAD-TC32-01: formatEmailBookingTimeRange formats ISO start and end timestamps into 12-hour AM/PM range', () => {
      const startAt = '2026-10-05T09:00:00.000Z';
      const endAt = '2026-10-05T17:00:00.000Z';
      const timeRange = formatEmailBookingTimeRange(startAt, endAt, 'UTC');
      expect(timeRange).toBe('9:00 AM to 5:00 PM');
    });

    it('QAD-TC32-01: renderManualResolutionEmail populates concrete Date and Time instead of placeholders when startAt and endAt are provided', () => {
      const rendered = renderManualResolutionEmail({
        to: 'customer@example.com',
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        referenceCode: 'DA-2026-TEST01',
        startAt: '2026-10-05T01:00:00.000Z', // 09:00 AM Asia/Manila (UTC+8)
        endAt: '2026-10-05T09:00:00.000Z',   // 05:00 PM Asia/Manila (UTC+8)
        workspaceName: 'Desk 101',
        businessSettings: {
          timezone: 'Asia/Manila',
        },
      });

      expect(rendered.html).toContain('Monday, October 5, 2026');
      expect(rendered.html).toContain('9:00 AM to 5:00 PM');
      expect(rendered.html).not.toContain('Upcoming Scheduled Date');
      expect(rendered.html).not.toContain('Booked Time Slot');

      expect(rendered.text).toContain('Date(s): Monday, October 5, 2026');
      expect(rendered.text).toContain('Scheduled Time: 9:00 AM to 5:00 PM');
      expect(rendered.text).not.toContain('Upcoming Scheduled Date');
      expect(rendered.text).not.toContain('Booked Time Slot');
    });

    it('QAD-TC32-02: renderManualResolutionEmail renders newly selected schedule when scheduledDate and scheduledTime are explicitly passed after reschedule', () => {
      const rendered = renderManualResolutionEmail({
        to: 'customer@example.com',
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        referenceCode: 'DA-2026-RESCHED',
        scheduledDate: 'Friday, October 9, 2026',
        scheduledTime: '10:00 AM to 02:00 PM',
        workspaceName: 'Quiet Desk 4',
      });

      expect(rendered.html).toContain('Friday, October 9, 2026');
      expect(rendered.html).toContain('10:00 AM to 02:00 PM');
      expect(rendered.text).toContain('Friday, October 9, 2026');
      expect(rendered.text).toContain('10:00 AM to 02:00 PM');
      expect(rendered.html).not.toContain('Upcoming Scheduled Date');
      expect(rendered.html).not.toContain('Booked Time Slot');
    });

    it('renderClosureManualResolutionEmail formats date and time range from startAt and endAt timestamps', () => {
      const rendered = renderClosureManualResolutionEmail({
        to: 'customer@example.com',
        customerFirstName: 'Carlos',
        customerLastName: 'Reyes',
        referenceCode: 'DA-2026-CLOSURE',
        startAt: '2026-10-12T01:00:00.000Z',
        endAt: '2026-10-12T05:00:00.000Z',
        closureReason: 'Emergency HVAC Maintenance',
        workspaceDisplayName: 'Focus Pod 1',
        businessSettings: {
          timezone: 'Asia/Manila',
        },
      });

      expect(rendered.html).toContain('Monday, October 12, 2026');
      expect(rendered.html).toContain('9:00 AM to 1:00 PM');
      expect(rendered.text).toContain('Monday, October 12, 2026');
      expect(rendered.text).toContain('9:00 AM to 1:00 PM');
      expect(rendered.html).not.toContain('Upcoming Scheduled Date');
      expect(rendered.html).not.toContain('Booked Time Slot');
    });
  });

  describe('Promotional Campaign Bulk Selection & Batch Deletion (QAD-TC32-03, QAD-TC32-04, QAD-TC32-05)', () => {
    let repo: PromotionalMemoryRepository;
    let service: PromotionalService;
    let seededPromos: PromotionalRate[];

    beforeEach(async () => {
      repo = new PromotionalMemoryRepository();
      service = new PromotionalService(repo);

      const items: CreatePromotionalRateInput[] = [
        {
          name: 'Flash Sale Alpha',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'HOURLY',
          promotionalPrice: 35,
          startAt: '2026-10-01T00:00:00.000Z',
          endAt: '2026-10-10T00:00:00.000Z',
          isActive: true,
        },
        {
          name: 'Flash Sale Beta',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'HOURLY',
          promotionalPrice: 40,
          startAt: '2026-10-01T00:00:00.000Z',
          endAt: '2026-10-10T00:00:00.000Z',
          isActive: true,
        },
        {
          name: 'Flash Sale Gamma',
          workspaceTemplateIds: ['tpl-2'],
          rateType: 'DAY_PASS',
          promotionalPrice: 250,
          startAt: '2026-10-01T00:00:00.000Z',
          endAt: '2026-10-10T00:00:00.000Z',
          isActive: true,
        },
        {
          name: 'Halloween Special 1',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'NIGHT_PASS',
          promotionalPrice: 200,
          startAt: '2026-10-25T00:00:00.000Z',
          endAt: '2026-10-31T00:00:00.000Z',
          isActive: true,
        },
        {
          name: 'Halloween Special 2',
          workspaceTemplateIds: ['tpl-2'],
          rateType: 'HOURLY',
          promotionalPrice: 30,
          startAt: '2026-10-25T00:00:00.000Z',
          endAt: '2026-10-31T00:00:00.000Z',
          isActive: true,
        },
      ];

      seededPromos = [];
      for (const item of items) {
        seededPromos.push(await service.createPromotion(item));
      }
    });

    it('QAD-TC32-03: Select all promotions selects all active campaign IDs', async () => {
      const allPromos = await service.listPromotions();
      expect(allPromos.length).toBe(5);

      const allIds = allPromos.map((p) => p.id);
      const selectedSet = new Set(allIds);

      expect(selectedSet.size).toBe(5);
      expect(allIds.every((id) => selectedSet.has(id))).toBe(true);
    });

    it('QAD-TC32-04: Trigger bulk delete with 5 promotion IDs deletes all 5 atomically', async () => {
      const allPromos = await service.listPromotions();
      expect(allPromos.length).toBe(5);

      const idsToDelete = allPromos.map((p) => p.id);
      const success = await service.deletePromotions(idsToDelete);
      expect(success).toBe(true);

      const remaining = await service.listPromotions();
      expect(remaining.length).toBe(0);
    });

    it('QAD-TC32-04: Bulk delete subsets of promotions', async () => {
      const idsToDelete = [seededPromos[0].id, seededPromos[1].id];
      const success = await service.deletePromotions(idsToDelete);
      expect(success).toBe(true);

      const remaining = await service.listPromotions();
      expect(remaining.length).toBe(3);
      expect(remaining.map((p) => p.id)).toEqual([
        seededPromos[2].id,
        seededPromos[3].id,
        seededPromos[4].id,
      ]);
    });

    it('QAD-TC32-05: Filter promotions by search query and verify select-all only selects filtered subset', async () => {
      const allPromos = await service.listPromotions();

      // Filter by 'Halloween'
      const halloweenFiltered = filterPromotionalRates(allPromos, {
        searchQuery: 'Halloween',
      });

      expect(halloweenFiltered.length).toBe(2);
      expect(halloweenFiltered.map((p) => p.name)).toEqual([
        'Halloween Special 1',
        'Halloween Special 2',
      ]);

      // Select All on filtered list
      const selectedFilteredIds = new Set(halloweenFiltered.map((p) => p.id));
      expect(selectedFilteredIds.size).toBe(2);

      // Verify that none of the Flash Sale items are in the selected set
      const flashSaleIds = allPromos
        .filter((p) => p.name.includes('Flash Sale'))
        .map((p) => p.id);
      for (const fId of flashSaleIds) {
        expect(selectedFilteredIds.has(fId)).toBe(false);
      }
    });
  });
});
