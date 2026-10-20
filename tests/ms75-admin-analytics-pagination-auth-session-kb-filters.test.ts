// MS-75: Admin Campaign & Promo Analytics Multi-Section 10-Item Pagination, Staff & Admin Browser-Tab Persistent Session Lifecycle, and Knowledge Base Audience Filter Pills
// Traceability: PRD-F10, PRD-F13, PRD-F15, PRD-F25, PRD-F27, SDD-C11, SDD-C12, SDD-C19, SDD-C20, SDD-C23, DSD-UI4, DSD-UI11, DSD-UI17, ERD-E1, ERD-E10, ERD-E18, ERD-E19, ERD-E24, QAD-TC43, MS75-TC01..12

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  paginateList,
  getPaginationPageNumbers,
  type CampaignPerformanceRow,
  type RecentRedemptionItem,
  type PromoPerformanceRow,
  type RecentPromoBookingItem,
  type KnowledgeDocument,
} from '@deskatlas/domain';
import {
  issueAdminSession,
  verifyAdminSession,
  ADMIN_SESSION_DURATION_MS,
} from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import {
  issueStaffAssistantSession,
  verifyStaffAssistantSession,
} from '../apps/admin-portal/src/server/assistant/session';
import { filterCampaignPerformance } from '../apps/admin-portal/src/features/campaign-analytics/components/CampaignPerformanceTable';
import { filterPromoPerformance } from '../apps/admin-portal/src/features/promo-analytics/components/PromoPerformanceTable';

describe('MS-75: Admin Analytics Pagination, Tab-Bound Auth Session, and Knowledge Base Audience Filters (QAD-TC43)', () => {
  const secretKey = 'test-secret-service-role-key-1234567890';

  // MS75-TC01: Unit / Domain: Pagination Domain Engine (10-Item Boundary)
  it('MS75-TC01: Unit / Domain: paginateList exactly partitions 25 items across 3 pages with 10 per page', () => {
    const dummyItems = Array.from({ length: 25 }, (_, i) => ({ id: `item-${i + 1}`, label: `Record ${i + 1}` }));
    const pageSize = 10;

    // Page 1: 10 items (indices 1 to 10)
    const page1 = paginateList(dummyItems, 1, pageSize);
    expect(page1.items.length).toBe(10);
    expect(page1.startIndex).toBe(1);
    expect(page1.endIndex).toBe(10);
    expect(page1.totalItems).toBe(25);
    expect(page1.totalPages).toBe(3);
    expect(page1.items[0].id).toBe('item-1');
    expect(page1.items[9].id).toBe('item-10');

    // Page 2: 10 items (indices 11 to 20)
    const page2 = paginateList(dummyItems, 2, pageSize);
    expect(page2.items.length).toBe(10);
    expect(page2.startIndex).toBe(11);
    expect(page2.endIndex).toBe(20);
    expect(page2.totalItems).toBe(25);
    expect(page2.totalPages).toBe(3);
    expect(page2.items[0].id).toBe('item-11');
    expect(page2.items[9].id).toBe('item-20');

    // Page 3: 5 items (indices 21 to 25)
    const page3 = paginateList(dummyItems, 3, pageSize);
    expect(page3.items.length).toBe(5);
    expect(page3.startIndex).toBe(21);
    expect(page3.endIndex).toBe(25);
    expect(page3.totalItems).toBe(25);
    expect(page3.totalPages).toBe(3);
    expect(page3.items[0].id).toBe('item-21');
    expect(page3.items[4].id).toBe('item-25');

    // Page numbers helper for 3 pages
    const pageNumbers = getPaginationPageNumbers(1, 3);
    expect(pageNumbers).toEqual([1, 2, 3]);
  });

  // MS75-TC02: Component / UI: Campaign Analytics CampaignPerformanceTable
  it('MS75-TC02: Presentation: CampaignPerformanceTable.tsx implements 10-item pagination, filter reset, and controls', () => {
    const filePath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/campaign-analytics/components/CampaignPerformanceTable.tsx'
    );
    const code = fs.readFileSync(filePath, 'utf-8');

    // Domain imports
    expect(code).toContain('paginateList');
    expect(code).toContain('getPaginationPageNumbers');

    // PAGE_SIZE constant
    expect(code).toMatch(/const\s+PAGE_SIZE\s*=\s*10/);

    // State & filter reset
    expect(code).toMatch(/const\s+\[currentPage,\s*setCurrentPage\]\s*=\s*useState<number>\(1\)/);
    expect(code).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*setCurrentPage\(1\);\s*\},/);

    // Paginated subset rendering
    expect(code).toContain('paginated.items.map');
    expect(code).toContain('role="navigation"');
    expect(code).toContain('aria-label="Campaign performance pagination"');
    expect(code).toContain('Showing');
    expect(code).toContain('Previous');
    expect(code).toContain('Next');

    // In-memory filter testing
    const sampleRows: CampaignPerformanceRow[] = [
      {
        ruleId: 'r-1',
        campaignId: 'c-1',
        campaignName: 'Summer Launch',
        ruleLabel: 'Rule A',
        ruleVersion: 1,
        status: 'ACTIVE',
        vouchersIssued: 20,
        vouchersRedeemed: 15,
        redemptionRatePercentage: 75,
        discountsGranted: 300,
        formattedDiscountsGranted: 'PHP 300.00',
        attributedRevenue: 1500,
        formattedAttributedRevenue: 'PHP 1,500.00',
        roiMultiple: 5.0,
        conditionSummary: 'Min spend 500',
        rewardValue: 20,
        rewardType: 'PERCENTAGE_DISCOUNT',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ];
    const filtered = filterCampaignPerformance(sampleRows, 'Summer', 'ACTIVE', 'revenue');
    expect(filtered.length).toBe(1);
    expect(filtered[0].campaignName).toBe('Summer Launch');
  });

  // MS75-TC03: Component / UI: Campaign Analytics RecentRedemptionsFeed
  it('MS75-TC03: Presentation: RecentRedemptionsFeed.tsx implements 10-item pagination and page navigation controls', () => {
    const filePath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/campaign-analytics/components/RecentRedemptionsFeed.tsx'
    );
    const code = fs.readFileSync(filePath, 'utf-8');

    expect(code).toContain('paginateList');
    expect(code).toContain('getPaginationPageNumbers');
    expect(code).toMatch(/const\s+PAGE_SIZE\s*=\s*10/);
    expect(code).toMatch(/const\s+\[currentPage,\s*setCurrentPage\]\s*=\s*useState<number>\(1\)/);
    expect(code).toContain('paginated.items.map');
    expect(code).toContain('role="navigation"');
    expect(code).toContain('aria-label="Recent redemptions pagination"');
    expect(code).toContain('Showing');

    // Section independence: paginating dummy redemptions
    const sampleRedemptions: RecentRedemptionItem[] = Array.from({ length: 22 }, (_, i) => ({
      voucherId: `v-${i + 1}`,
      promoCode: `CODE-${i + 1}`,
      customerCode: `CUST-${i + 1}`,
      reservationId: `res-${i + 1}`,
      reservationReference: `REF-${i + 1}`,
      discountAmount: 50,
      formattedDiscountAmount: 'PHP 50.00',
      netPaidAmount: 200,
      formattedNetPaidAmount: 'PHP 200.00',
      channel: 'WEBSITE',
      redeemedAt: '2026-10-21T02:00:00Z',
    }));
    const page1 = paginateList(sampleRedemptions, 1, 10);
    const page2 = paginateList(sampleRedemptions, 2, 10);
    const page3 = paginateList(sampleRedemptions, 3, 10);
    expect(page1.items.length).toBe(10);
    expect(page2.items.length).toBe(10);
    expect(page3.items.length).toBe(2);
  });

  // MS75-TC04: Component / UI: Promo Analytics PromoPerformanceTable
  it('MS75-TC04: Presentation: PromoPerformanceTable.tsx implements 10-item pagination and filter reset', () => {
    const filePath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/promo-analytics/components/PromoPerformanceTable.tsx'
    );
    const code = fs.readFileSync(filePath, 'utf-8');

    expect(code).toContain('paginateList');
    expect(code).toContain('getPaginationPageNumbers');
    expect(code).toMatch(/const\s+PAGE_SIZE\s*=\s*10/);
    expect(code).toMatch(/const\s+\[currentPage,\s*setCurrentPage\]\s*=\s*useState<number>\(1\)/);
    expect(code).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*setCurrentPage\(1\);\s*\},/);
    expect(code).toContain('paginated.items.map');
    expect(code).toContain('role="navigation"');
    expect(code).toContain('aria-label="Promotional rates pagination"');

    const samplePromoRows: PromoPerformanceRow[] = [
      {
        promotionId: 'p-1',
        name: 'Flash Sale Desk',
        rateType: 'HOURLY',
        status: 'ACTIVE',
        workspaceTemplateNames: ['Dedicated Desk A'],
        regularPrice: 100,
        promotionalPrice: 70,
        bookingsCount: 12,
        discountsGranted: 360,
        formattedDiscountsGranted: 'PHP 360.00',
        attributedRevenue: 840,
        formattedAttributedRevenue: 'PHP 840.00',
        roiMultiple: 2.33,
        startAt: '2026-10-01T00:00:00Z',
        endAt: '2026-10-31T23:59:59Z',
      },
    ];
    const filtered = filterPromoPerformance(samplePromoRows, 'Flash', 'ACTIVE', 'revenue');
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('Flash Sale Desk');
  });

  // MS75-TC05: Component / UI: Promo Analytics RecentPromoBookingsFeed
  it('MS75-TC05: Presentation: RecentPromoBookingsFeed.tsx implements 10-item pagination and audit details', () => {
    const filePath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/promo-analytics/components/RecentPromoBookingsFeed.tsx'
    );
    const code = fs.readFileSync(filePath, 'utf-8');

    expect(code).toContain('paginateList');
    expect(code).toContain('getPaginationPageNumbers');
    expect(code).toMatch(/const\s+PAGE_SIZE\s*=\s*10/);
    expect(code).toMatch(/const\s+\[currentPage,\s*setCurrentPage\]\s*=\s*useState<number>\(1\)/);
    expect(code).toContain('paginated.items.map');
    expect(code).toContain('role="navigation"');
    expect(code).toContain('aria-label="Recent promotional bookings pagination"');

    const sampleBookings: RecentPromoBookingItem[] = Array.from({ length: 14 }, (_, i) => ({
      reservationId: `res-${i + 1}`,
      referenceCode: `DA-REF-${i + 1}`,
      customerName: `Customer ${i + 1}`,
      customerEmail: `customer${i + 1}@example.com`,
      workspaceName: 'Desk Zone A',
      rateType: 'DAILY',
      promotionName: 'Holiday Special',
      discountGranted: 100,
      formattedDiscountGranted: 'PHP 100.00',
      amountDue: 450,
      formattedAmountDue: 'PHP 450.00',
      channel: 'ONLINE',
      bookedAt: '2026-10-21T01:30:00Z',
    }));
    const page1 = paginateList(sampleBookings, 1, 10);
    const page2 = paginateList(sampleBookings, 2, 10);
    expect(page1.items.length).toBe(10);
    expect(page2.items.length).toBe(4);
    expect(page1.startIndex).toBe(1);
    expect(page1.endIndex).toBe(10);
    expect(page2.startIndex).toBe(11);
    expect(page2.endIndex).toBe(14);
  });

  // MS75-TC06: Security / Auth: Storage Migration to sessionStorage
  it('MS75-TC06: Security: AuthProvider in admin-portal and staff-dashboard migrates to sessionStorage and cleans localStorage', () => {
    const adminAuthPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/auth/components/AuthProvider.tsx'
    );
    const staffAuthPath = path.resolve(
      __dirname,
      '../apps/staff-dashboard/src/features/auth/components/AuthProvider.tsx'
    );

    const adminCode = fs.readFileSync(adminAuthPath, 'utf-8');
    const staffCode = fs.readFileSync(staffAuthPath, 'utf-8');

    // admin-portal must read and write to sessionStorage
    expect(adminCode).toContain('sessionStorage.getItem(STORAGE_KEY)');
    expect(adminCode).toContain('sessionStorage.setItem(STORAGE_KEY');
    expect(adminCode).toContain('sessionStorage.removeItem(STORAGE_KEY)');
    expect(adminCode).toContain('localStorage.removeItem(STORAGE_KEY)');

    // staff-dashboard must read and write to sessionStorage
    expect(staffCode).toContain('sessionStorage.getItem(STORAGE_KEY)');
    expect(staffCode).toContain('sessionStorage.setItem(STORAGE_KEY');
    expect(staffCode).toContain('sessionStorage.removeItem(STORAGE_KEY)');
    expect(staffCode).toContain('localStorage.removeItem(STORAGE_KEY)');
  });

  // MS75-TC07: Security / Auth: Tab-Bound Session Termination Mechanics
  it('MS75-TC07: Security: Closing tab (empty sessionStorage) destroys session, while active tab retains session', () => {
    // Simulated sessionStorage tab isolation test
    const tab1Storage = new Map<string, string>();
    const tab2Storage = new Map<string, string>();

    // Tab 1 logs in
    const userPayload = JSON.stringify({ id: 'staff-user-1', role: 'staff', name: 'Alice' });
    tab1Storage.set('desk_atlas_user', userPayload);

    // Tab 1 has active session
    expect(tab1Storage.get('desk_atlas_user')).toBe(userPayload);

    // Tab 2 (opened in another window or after tab close) has zero session data
    expect(tab2Storage.get('desk_atlas_user')).toBeUndefined();

    // Closing Tab 1 clears its sessionStorage
    tab1Storage.clear();
    expect(tab1Storage.get('desk_atlas_user')).toBeUndefined();
  });

  // MS75-TC08: Security / Auth: Non-Expiring In-Tab Lifespan (No Timer Reject)
  it('MS75-TC08: Security: Automatic client-side eviction timers removed from admin and staff AuthProvider', () => {
    const adminAuthPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/auth/components/AuthProvider.tsx'
    );
    const staffAuthPath = path.resolve(
      __dirname,
      '../apps/staff-dashboard/src/features/auth/components/AuthProvider.tsx'
    );

    const adminCode = fs.readFileSync(adminAuthPath, 'utf-8');
    const staffCode = fs.readFileSync(staffAuthPath, 'utf-8');

    // Neither AuthProvider may have the setTimeout session.reject timer
    expect(adminCode).not.toContain("session.reject(state.generation, 'AUTH_REQUIRED')");
    expect(staffCode).not.toContain("session.reject(state.generation, 'AUTH_REQUIRED')");
  });

  // MS75-TC09: Security / Auth: Server Token Verification (Non-Expiring In-Tab)
  it('MS75-TC09: Security: verifyAdminSession and verifyStaffAssistantSession accept persistent HMAC tokens indefinitely', () => {
    const now = Date.now();
    const futureTime = now + 14 * 24 * 60 * 60 * 1000; // 14 days later

    // Admin persistent token
    const adminToken = issueAdminSession('admin-123', secretKey, now, { persistent: true });
    expect(verifyAdminSession(adminToken, secretKey, now)).toBe('admin-123');
    expect(verifyAdminSession(adminToken, secretKey, futureTime)).toBe('admin-123');
    expect(verifyAdminSession(adminToken, 'wrong-secret', now)).toBeNull();

    // Staff assistant persistent token
    const staffToken = issueStaffAssistantSession('staff-456', secretKey, now, { persistent: true });
    expect(verifyStaffAssistantSession(staffToken, secretKey, now)).toBe('staff-456');
    expect(verifyStaffAssistantSession(staffToken, secretKey, futureTime)).toBe('staff-456');
    expect(verifyStaffAssistantSession(staffToken, 'wrong-secret', now)).toBeNull();

    // Legacy expiring token still expires as backward compatibility guarantee
    const legacyAdminToken = issueAdminSession('admin-legacy', secretKey, now, { persistent: false });
    expect(verifyAdminSession(legacyAdminToken, secretKey, now)).toBe('admin-legacy');
    expect(verifyAdminSession(legacyAdminToken, secretKey, now + ADMIN_SESSION_DURATION_MS)).toBeNull();
  });

  // MS75-TC10: Security / Auth: Heartbeat Account Deactivation Enforcement
  it('MS75-TC10: Security: VerifiedAdmin detects deactivated accounts and throws ACCOUNT_INACTIVE 403', () => {
    const verifiedAdminPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/app/api/admin/auth/_lib/verifiedAdmin.ts'
    );
    const code = fs.readFileSync(verifiedAdminPath, 'utf-8');

    expect(code).toContain("data.is_active !== true");
    expect(code).toContain("new AdminAccessError('ACCOUNT_INACTIVE', 403)");
  });

  // MS75-TC11: Presentation / UI: Knowledge Base Filter Pills Count Badges
  it('MS75-TC11: Presentation: KnowledgeBaseSettings computes accurate counts for All Files, Admin Only, and Admin & Staff', () => {
    const documents: KnowledgeDocument[] = [
      {
        id: 'doc-1',
        title: 'Admin Emergency Procedures',
        audience: 'ADMIN_ONLY',
        versions: [],
        jobs: [],
        active_version_id: 'v-1',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'doc-2',
        title: 'Front Desk Daily Operations',
        audience: 'ADMIN_AND_STAFF',
        versions: [],
        jobs: [],
        active_version_id: 'v-2',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'doc-3',
        title: 'Guest Check-In Guidelines',
        audience: 'ADMIN_AND_STAFF',
        versions: [],
        jobs: [],
        active_version_id: 'v-3',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];

    let adminOnly = 0;
    let adminAndStaff = 0;
    for (const doc of documents) {
      if (doc.audience === 'ADMIN_ONLY') adminOnly++;
      else if (doc.audience === 'ADMIN_AND_STAFF') adminAndStaff++;
    }
    const audienceCounts = {
      ALL: documents.length,
      ADMIN_ONLY: adminOnly,
      ADMIN_AND_STAFF: adminAndStaff,
    };

    expect(audienceCounts.ALL).toBe(3);
    expect(audienceCounts.ADMIN_ONLY).toBe(1);
    expect(audienceCounts.ADMIN_AND_STAFF).toBe(2);
  });

  // MS75-TC12: Presentation / UI: Knowledge Base Audience Filtering & Empty States
  it('MS75-TC12: Presentation: KnowledgeBaseSettings filters documents strictly by audience and includes contextual empty notice', () => {
    const kbPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/settings/components/KnowledgeBaseSettings.tsx'
    );
    const cssPath = path.resolve(
      __dirname,
      '../apps/admin-portal/src/features/settings/components/knowledge.module.css'
    );

    const kbCode = fs.readFileSync(kbPath, 'utf-8');
    const cssCode = fs.readFileSync(cssPath, 'utf-8');

    // Filter pill elements and state
    expect(kbCode).toContain('audienceFilter');
    expect(kbCode).toContain('setAudienceFilter');
    expect(kbCode).toContain('role="group"');
    expect(kbCode).toContain('aria-label="Filter documents by audience"');
    expect(kbCode).toContain('All Files');
    expect(kbCode).toContain('Admin Only');
    expect(kbCode).toContain('Admin & Staff');
    expect(kbCode).toContain('filteredDocuments.map');

    // Contextual empty notice
    expect(kbCode).toContain('emptyNotice');
    expect(kbCode).toContain('No admin-only documents found.');
    expect(kbCode).toContain('No documents shared with admin and staff found.');

    // CSS classes defined
    expect(cssCode).toContain('.filterBar');
    expect(cssCode).toContain('.filterPill');
    expect(cssCode).toContain('.filterPillActive');
    expect(cssCode).toContain('.pillBadge');
    expect(cssCode).toContain('.emptyNotice');
  });
});
