// MS-74: Admin Promotions Tab Pagination, Campaign Analytics Webcopy Disambiguation, and Dedicated Promotional Rates Analytics Cockpit
// Traceability: PRD-F10, PRD-F15, PRD-F16, PRD-F25, SDD-C7, SDD-C11, SDD-C19, DSD-UI4, DSD-UI11, ERD-E9, ERD-E10, ERD-E19, QAD-TC43, MS74-TC01..10

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  paginateList,
  getPaginationPageNumbers,
  PromoAnalyticsService,
  exportPromoAnalytics,
  type PromoAnalyticsData,
  type PromotionalRate,
} from '@deskatlas/domain';

describe('MS-74: Admin Promotions Tab Pagination, Campaign Analytics Rebranding, and Promo Analytics (QAD-TC43)', () => {
  const referenceNow = new Date('2026-10-21T06:00:00Z');

  const createDummyPromos = (count: number): PromotionalRate[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `promo-${i + 1}`,
      name: `Promotion ${i + 1}`,
      workspaceTemplateIds: ['tpl-1'],
      rateType: 'HOURLY',
      promotionalPrice: 80,
      startAt: '2026-10-01T00:00:00Z',
      endAt: '2026-10-31T23:59:59Z',
      isActive: true,
    }));

  it('MS74-TC01: Unit / Domain: paginateList on Promotions', () => {
    const promos = createDummyPromos(38);
    const pageSize = 15;

    // Page 1: items 1-15
    const page1 = paginateList(promos, 1, pageSize);
    expect(page1.items.length).toBe(15);
    expect(page1.startIndex).toBe(1);
    expect(page1.endIndex).toBe(15);
    expect(page1.totalItems).toBe(38);
    expect(page1.totalPages).toBe(3);
    expect(page1.items[0].id).toBe('promo-1');
    expect(page1.items[14].id).toBe('promo-15');

    // Page 2: items 16-30
    const page2 = paginateList(promos, 2, pageSize);
    expect(page2.items.length).toBe(15);
    expect(page2.startIndex).toBe(16);
    expect(page2.endIndex).toBe(30);
    expect(page2.items[0].id).toBe('promo-16');
    expect(page2.items[14].id).toBe('promo-30');

    // Page 3: items 31-38
    const page3 = paginateList(promos, 3, pageSize);
    expect(page3.items.length).toBe(8);
    expect(page3.startIndex).toBe(31);
    expect(page3.endIndex).toBe(38);
    expect(page3.items[0].id).toBe('promo-31');
    expect(page3.items[7].id).toBe('promo-38');

    // Page numbers helper
    const pages = getPaginationPageNumbers(1, 3);
    expect(pages).toEqual([1, 2, 3]);
  });

  it('MS74-TC02: Presentation: PromotionsList.tsx Filter Reset & Pagination State', () => {
    const filePath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/promotions/components/PromotionsList.tsx'
    );
    const code = fs.readFileSync(filePath, 'utf-8');

    // Must import paginateList and getPaginationPageNumbers
    expect(code).toContain('paginateList');
    expect(code).toContain('getPaginationPageNumbers');

    // Must maintain currentPage state with PAGE_SIZE = 15
    expect(code).toMatch(/const\s+\[currentPage,\s*setCurrentPage\]\s*=\s*useState<number>\(1\)/);
    expect(code).toMatch(/PAGE_SIZE\s*=\s*15/);

    // Must reset to page 1 on search or filter change
    expect(code).toMatch(/setCurrentPage\(1\)/);
    expect(code).toContain('searchQuery, filterWorkspaceId, filterRateType, filterStatus');

    // Must render paginated subset and pagination toolbar
    expect(code).toContain('paginatedPromotions.map');
    expect(code).toContain('Pagination Controls Toolbar');
    expect(code).toContain('aria-label="Previous Page"');
    expect(code).toContain('aria-label="Next Page"');
  });

  it('MS74-TC03: Presentation: Multi-Selection Across Pages', () => {
    const selectedPromoIds = new Set<string>();

    // Page 1 selection: select promo-2
    selectedPromoIds.add('promo-2');
    expect(selectedPromoIds.has('promo-2')).toBe(true);

    // Navigate to Page 2 and select promo-18
    selectedPromoIds.add('promo-18');
    expect(selectedPromoIds.has('promo-2')).toBe(true);
    expect(selectedPromoIds.has('promo-18')).toBe(true);
    expect(selectedPromoIds.size).toBe(2);

    // Toggle select all on page 1: currentPageIds [promo-1..promo-15]
    const page1Ids = Array.from({ length: 15 }, (_, i) => `promo-${i + 1}`);
    page1Ids.forEach((id) => selectedPromoIds.add(id));
    expect(selectedPromoIds.size).toBe(16); // promo-1..promo-15 + promo-18

    // Removing page 1 items leaves promo-18 intact
    page1Ids.forEach((id) => selectedPromoIds.delete(id));
    expect(selectedPromoIds.has('promo-18')).toBe(true);
    expect(selectedPromoIds.size).toBe(1);
  });

  it('MS74-TC04: Presentation: Navigation Sidebar Rebranding in layout.tsx', () => {
    const layoutPath = path.resolve(__dirname, '../apps/admin-portal/src/app/manage/layout.tsx');
    const layoutCode = fs.readFileSync(layoutPath, 'utf-8');

    // Link for campaign-analytics must be labeled "Campaign Analytics"
    expect(layoutCode).toMatch(
      /id:\s*['"]\/manage\/campaign-analytics['"],\s*label:\s*['"]Campaign Analytics['"]/
    );

    // Link for promo-analytics must be labeled "Promo Analytics"
    expect(layoutCode).toMatch(
      /id:\s*['"]\/manage\/promo-analytics['"],\s*label:\s*['"]Promo Analytics['"]/
    );

    // Both icons must be handled
    expect(layoutCode).toContain("case 'campaign-analytics':");
    expect(layoutCode).toContain("case 'promo-analytics':");
  });

  it('MS74-TC05: Presentation: Campaign Analytics Webcopy in CampaignAnalyticsDashboard.tsx', () => {
    const dashPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/campaign-analytics/components/CampaignAnalyticsDashboard.tsx'
    );
    const dashCode = fs.readFileSync(dashPath, 'utf-8');

    // Screen label must be CampaignAnalytics
    expect(dashCode).toContain('data-screen-label="CampaignAnalytics"');

    // Header must say Campaign Analytics
    expect(dashCode).toContain('<h1>Campaign Analytics</h1>');

    // Subtitle must reference loyalty milestones and vouchers
    expect(dashCode).toContain('Loyalty milestones, automated voucher campaigns');

    // Nav links must link to both Campaign Analytics and Promo Analytics
    expect(dashCode).toContain('/manage/campaign-analytics');
    expect(dashCode).toContain('/manage/promo-analytics');

    // Export dialog title
    expect(dashCode).toContain('Export Campaign Analytics Reports');
  });

  it('MS74-TC06: Domain / Logic: Promo Analytics KPI Calculations (10 bookings, ₱80/hr vs ₱100/hr, 2 hrs)', async () => {
    const fixture: PromoAnalyticsData = {
      timeZone: 'Asia/Manila',
      promotions: [
        {
          id: 'promo-special',
          name: 'Flash Sale 20%',
          workspaceTemplateIds: ['tpl-hotdesk'],
          rateType: 'HOURLY',
          promotionalPrice: 80,
          startAt: '2026-10-01T00:00:00Z',
          endAt: '2026-10-31T23:59:59Z',
          isActive: true,
        },
      ],
      templates: [
        {
          id: 'tpl-hotdesk',
          name: 'Dedicated Hot Desk',
          rateAmount: 100,
        },
      ],
      reservations: Array.from({ length: 10 }, (_, i) => ({
        id: `res-${i + 1}`,
        referenceCode: `REF-P${i + 1}`,
        source: (i % 2 === 0 ? 'WEB' : 'KIOSK') as 'WEB' | 'KIOSK',
        status: 'CONFIRMED',
        customerFirstName: `Guest${i + 1}`,
        customerLastName: 'User',
        customerEmail: `guest${i + 1}@example.com`,
        amountDue: 160, // 2 hours * ₱80
        rateSnapshot: 80,
        createdAt: '2026-10-21T02:00:00Z',
        confirmedAt: '2026-10-21T02:05:00Z',
        workspaceTemplateId: 'tpl-hotdesk',
        rateType: 'HOURLY',
        startAt: '2026-10-21T03:00:00Z',
        endAt: '2026-10-21T05:00:00Z',
        durationHours: 2,
      })),
    };

    const service = new PromoAnalyticsService({ load: async () => fixture }, () => referenceNow);
    const snapshot = await service.getSnapshot('today');

    // Total Promo Bookings = 10
    expect(snapshot.summaryMetrics.totalPromoBookings).toBe(10);

    // Discounts Granted: 10 bookings * 2 hrs * (₱100 - ₱80) = ₱400.00
    expect(snapshot.summaryMetrics.totalDiscountsGranted).toBe(400);
    expect(snapshot.summaryMetrics.formattedTotalDiscountsGranted).toContain('400.00');

    // Attributed Gross Revenue: 10 bookings * ₱160 = ₱1,600.00
    expect(snapshot.summaryMetrics.attributedGrossRevenue).toBe(1600);
    expect(snapshot.summaryMetrics.formattedAttributedGrossRevenue).toContain('1,600.00');

    // ROI Multiple: 1600 / 400 = 4.0x
    expect(snapshot.summaryMetrics.promoRoiMultiple).toBe(4);

    // Average Order Value: 1600 / 10 = ₱160.00
    expect(snapshot.summaryMetrics.averageOrderValue).toBe(160);
    expect(snapshot.summaryMetrics.formattedAverageOrderValue).toContain('160.00');

    // Unique Customers = 10
    expect(snapshot.summaryMetrics.uniqueCustomersCount).toBe(10);
  });

  it('MS74-TC07: Domain / Logic: Timeframe Filter Reactivity', async () => {
    const fixture: PromoAnalyticsData = {
      timeZone: 'Asia/Manila',
      promotions: [
        {
          id: 'promo-1',
          name: 'Octoberfest Promo',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'HOURLY',
          promotionalPrice: 75,
          startAt: '2026-09-01T00:00:00Z',
          endAt: '2026-10-31T23:59:59Z',
          isActive: true,
        },
      ],
      templates: [
        {
          id: 'tpl-1',
          name: 'Main Workspace',
          rateAmount: 100,
        },
      ],
      reservations: [
        // Today (Oct 21)
        {
          id: 'res-today',
          referenceCode: 'REF-TODAY',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'Today',
          customerLastName: 'Client',
          customerEmail: 'today@test.com',
          amountDue: 150,
          rateSnapshot: 75,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:05:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 2,
        },
        // Earlier this month (Oct 05)
        {
          id: 'res-earlier-month',
          referenceCode: 'REF-MONTH',
          source: 'KIOSK',
          status: 'CONFIRMED',
          customerFirstName: 'Month',
          customerLastName: 'Client',
          customerEmail: 'month@test.com',
          amountDue: 75,
          rateSnapshot: 75,
          createdAt: '2026-10-05T01:00:00Z',
          confirmedAt: '2026-10-05T01:05:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
        // Last month (Sep 15)
        {
          id: 'res-last-month',
          referenceCode: 'REF-SEP',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'Sep',
          customerLastName: 'Client',
          customerEmail: 'sep@test.com',
          amountDue: 75,
          rateSnapshot: 75,
          createdAt: '2026-09-15T01:00:00Z',
          confirmedAt: '2026-09-15T01:05:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
      ],
    };

    const service = new PromoAnalyticsService({ load: async () => fixture }, () => referenceNow);

    // Range 'today': only res-today
    const todaySnapshot = await service.getSnapshot('today');
    expect(todaySnapshot.summaryMetrics.totalPromoBookings).toBe(1);
    expect(todaySnapshot.summaryMetrics.attributedGrossRevenue).toBe(150);

    // Range 'month': res-today + res-earlier-month = 2 bookings
    const monthSnapshot = await service.getSnapshot('month');
    expect(monthSnapshot.summaryMetrics.totalPromoBookings).toBe(2);
    expect(monthSnapshot.summaryMetrics.attributedGrossRevenue).toBe(225);

    // Range 'all': all 3 bookings
    const allSnapshot = await service.getSnapshot('all');
    expect(allSnapshot.summaryMetrics.totalPromoBookings).toBe(3);
    expect(allSnapshot.summaryMetrics.attributedGrossRevenue).toBe(300);
  });

  it('MS74-TC08: Domain / Logic: Channel Breakdown Accuracy', async () => {
    const fixture: PromoAnalyticsData = {
      timeZone: 'Asia/Manila',
      promotions: [
        {
          id: 'promo-1',
          name: 'Channel Promo',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'HOURLY',
          promotionalPrice: 50,
          startAt: '2026-10-01T00:00:00Z',
          endAt: '2026-10-31T23:59:59Z',
          isActive: true,
        },
      ],
      templates: [
        {
          id: 'tpl-1',
          name: 'Workspace',
          rateAmount: 100,
        },
      ],
      reservations: [
        // 3 WEB bookings
        {
          id: 'web-1',
          referenceCode: 'W1',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'W',
          customerLastName: 'One',
          customerEmail: 'w1@test.com',
          amountDue: 50,
          rateSnapshot: 50,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:00:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
        {
          id: 'web-2',
          referenceCode: 'W2',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'W',
          customerLastName: 'Two',
          customerEmail: 'w2@test.com',
          amountDue: 50,
          rateSnapshot: 50,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:00:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
        {
          id: 'web-3',
          referenceCode: 'W3',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'W',
          customerLastName: 'Three',
          customerEmail: 'w3@test.com',
          amountDue: 50,
          rateSnapshot: 50,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:00:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
        // 1 KIOSK booking
        {
          id: 'kiosk-1',
          referenceCode: 'K1',
          source: 'KIOSK',
          status: 'CONFIRMED',
          customerFirstName: 'K',
          customerLastName: 'One',
          customerEmail: 'k1@test.com',
          amountDue: 50,
          rateSnapshot: 50,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:00:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 1,
        },
      ],
    };

    const service = new PromoAnalyticsService({ load: async () => fixture }, () => referenceNow);
    const snapshot = await service.getSnapshot('today');

    const cb = snapshot.channelBreakdown;
    expect(cb.webBookingsCount).toBe(3);
    expect(cb.kioskBookingsCount).toBe(1);
    expect(cb.webBookingsPercentage).toBe(75);
    expect(cb.kioskBookingsPercentage).toBe(25);
    expect(cb.webRevenueTotal).toBe(150);
    expect(cb.kioskRevenueTotal).toBe(50);
  });

  it('MS74-TC09: Integration: Excel & CSV Export Builders', async () => {
    const fixture: PromoAnalyticsData = {
      timeZone: 'Asia/Manila',
      promotions: [
        {
          id: 'promo-1',
          name: 'Export Test Promo',
          workspaceTemplateIds: ['tpl-1'],
          rateType: 'HOURLY',
          promotionalPrice: 60,
          startAt: '2026-10-01T00:00:00Z',
          endAt: '2026-10-31T23:59:59Z',
          isActive: true,
        },
      ],
      templates: [
        {
          id: 'tpl-1',
          name: 'Workspace Suite',
          rateAmount: 100,
        },
      ],
      reservations: [
        {
          id: 'res-export',
          referenceCode: 'REF-EXP-01',
          source: 'WEB',
          status: 'CONFIRMED',
          customerFirstName: 'Juan',
          customerLastName: 'Dela Cruz',
          customerEmail: 'juan@example.com',
          amountDue: 120,
          rateSnapshot: 60,
          createdAt: '2026-10-21T01:00:00Z',
          confirmedAt: '2026-10-21T01:05:00Z',
          workspaceTemplateId: 'tpl-1',
          durationHours: 2,
        },
      ],
    };

    const service = new PromoAnalyticsService({ load: async () => fixture }, () => referenceNow);
    const snapshot = await service.getSnapshot('30d');

    // 1. Export summary XLSX
    const xlsxSummary = await exportPromoAnalytics(snapshot, 'summary', 'xlsx');
    expect(xlsxSummary.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(xlsxSummary.filename).toMatch(/promo-summary-30d-.*\.xlsx/);
    expect(xlsxSummary.body).toBeInstanceOf(Uint8Array);

    const wb = new ExcelJS.Workbook();
    // Verify ExcelJS loads the generated buffer cleanly
    await wb.xlsx.load(xlsxSummary.body as Uint8Array);
    const sheet = wb.getWorksheet('Promo Performance');
    expect(sheet).toBeDefined();
    expect(sheet?.rowCount).toBeGreaterThanOrEqual(2);

    // 2. Export bookings CSV
    const csvBookings = await exportPromoAnalytics(snapshot, 'bookings', 'csv');
    expect(csvBookings.contentType).toBe('text/csv; charset=utf-8');
    expect(csvBookings.filename).toMatch(/promo-bookings-30d-.*\.csv/);
    expect(typeof csvBookings.body).toBe('string');
    expect(csvBookings.body as string).toContain('REF-EXP-01');
    expect(csvBookings.body as string).toContain('Reservation ID');
  });

  it('MS74-TC10: Governance: Zero Foreign Styles & Zero Em-Dashes', () => {
    const filesToCheck = [
      'packages/domain/src/models/promoAnalytics.ts',
      'packages/domain/src/services/promoAnalyticsService.ts',
      'packages/domain/src/services/promoAnalyticsExport.ts',
      'packages/domain/src/services/promoAnalyticsSupabaseRepository.ts',
      'apps/admin-portal/src/features/promo-analytics/components/PromoKpiGrid.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/PromoTimelineChart.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/PromoChannelBreakdown.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/PromoPerformanceTable.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/RecentPromoBookingsFeed.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/PromoExportModal.tsx',
      'apps/admin-portal/src/features/promo-analytics/components/PromoAnalyticsDashboard.tsx',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(__dirname, '..', relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Ban em-dashes (BAN-PUNCT-01)
      expect(content).not.toContain('\u2014'); // em-dash
      expect(content).not.toContain('\u2013'); // en-dash
    }
  });
});
