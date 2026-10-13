import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import React from '../apps/admin-portal/node_modules/react';
import { renderToStaticMarkup } from '../apps/admin-portal/node_modules/react-dom/server';
import {
  CampaignAnalyticsService, CampaignAnalyticsSupabaseRepository, exportCampaignAnalytics,
  createReportsService, ReservationMemoryRepository,
  type AnalyticsVoucher, type CampaignAnalyticsData,
} from '@deskatlas/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET as snapshotGET } from '../apps/admin-portal/src/app/api/admin/campaigns/analytics/route';
import { POST as loginPOST } from '../apps/admin-portal/src/app/api/admin/auth/login/route';
import { ADMIN_SESSION_DURATION_MS, issueAdminSession, verifyAdminSession } from '../apps/admin-portal/src/app/api/admin/auth/_lib/adminSession';
import { buildAdminExcelWorkbook } from '../packages/domain/src/services/excelReportBuilder';
import { GET as exportGET } from '../apps/admin-portal/src/app/api/admin/campaigns/analytics/export/route';
import { filterCampaignPerformance, CampaignPerformanceTable } from '../apps/admin-portal/src/features/campaign-analytics/components/CampaignPerformanceTable';

// MS-43: PRD-F25, SDD-C14/C19, ERD-E10/E16-E18, QAD-TC43.1 through QAD-TC43.10.
const auth = vi.hoisted(() => ({ role: 'ADMIN', active: true, valid: true, getUser: vi.fn(), profile: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: auth.getUser },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: auth.profile }) }) }),
}) }));
const now = new Date('2026-10-13T04:00:00Z');
const time = '2026-10-13T01:00:00Z';
function voucher(id: string, overrides: Partial<AnalyticsVoucher> = {}): AnalyticsVoucher {
  return { id, campaign_id: 'campaign', campaign_rule_id: 'rule', customer_id: 'customer-private-123456', promo_code: `PROMO${id}`, status: 'AVAILABLE', issued_at: time, expires_at: '2026-11-01T00:00:00Z', redeemed_at: null, redeemed_reservation_id: null, redeemed_discount_amount: null, reward_snapshot: { rewardType: 'PERCENTAGE_DISCOUNT', rewardValue: 15 }, ...overrides };
}
function fixture(): CampaignAnalyticsData {
  return {
    timeZone: 'Asia/Manila',
    campaigns: [{ id: 'campaign', name: 'Loyalty', status: 'ACTIVE', starts_at: null, ends_at: null, created_at: '2026-09-01T00:00:00Z' }],
    rules: [{ id: 'rule', campaign_id: 'campaign', label: 'Five bookings', version: 2, reward_type: 'PERCENTAGE_DISCOUNT', reward_value: 15, rule_definition: { schema_version: 1, combine: 'ALL', conditions: [{ metric: 'BOOKING_COUNT', threshold: 5 }], recurring: true, qualification_start_at: '2026-09-01T00:00:00Z', earning_channels: ['WEB', 'KIOSK'], earning_workspace_type_ids: [], redemption_channels: ['WEB', 'KIOSK'], redemption_workspace_type_ids: [], minimum_booking_amount: 0 } }],
    vouchers: [voucher('1', { status: 'USED', redeemed_at: time, redeemed_reservation_id: 'r1', redeemed_discount_amount: 14850 }), voucher('2', { status: 'EXPIRED', expires_at: time }), voucher('3', { status: 'PENDING_REDEMPTION' })],
    reservations: [{ id: 'r1', reference_code: 'RES-1', source: 'WEB', status: 'CONFIRMED', requested_voucher_id: '1', confirmed_at: time, gross_amount_due: 82400, amount_due: 67550 }],
  };
}
const serviceFor = (data: CampaignAnalyticsData) => new CampaignAnalyticsService({ load: async () => data }, () => now);
function request(url: string, headers?: HeadersInit): Parameters<typeof snapshotGET>[0] {
  return Object.assign(new Request(`http://localhost${url}`, { headers }), { nextUrl: new URL(`http://localhost${url}`) }) as Parameters<typeof snapshotGET>[0];
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-placeholder');
  auth.role = 'ADMIN'; auth.active = true; auth.valid = true;
  auth.getUser.mockImplementation(async () => ({ data: { user: auth.valid ? { id: 'admin-user' } : null }, error: null }));
  auth.profile.mockImplementation(async () => ({ data: { role: auth.role, is_active: auth.active }, error: null }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('MS-43 campaign analytics', () => {
  it('accepts a fresh successful RPC administrator login in analytics and exports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, user: { id: 'admin-user', role: 'admin', email: 'admin@example.test' } })));
    auth.valid = false; // RPC application sessions are not Supabase Auth JWTs.
    const snapshot = await serviceFor(fixture()).getSnapshot();
    vi.spyOn(CampaignAnalyticsService.prototype, 'getSnapshot').mockResolvedValue(snapshot);
    const loginRequest = new Request('http://localhost/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'test-only-password' }) });
    const loginResponse = await loginPOST(loginRequest as Parameters<typeof loginPOST>[0]);
    expect(loginResponse.status).toBe(200);
    const session = await loginResponse.json();
    for (const handler of [snapshotGET, exportGET]) {
      const response = await handler(request('/api?format=csv', { Authorization: `Bearer ${session.token}` }));
      expect(response.status, 'A freshly authenticated admin must not be shown the expired-session error').toBe(200);
    }
  });

  it('rejects expired, tampered and unsigned RPC sessions and rechecks current admin privileges', async () => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const issuedAt = Date.now();
    const token = issueAdminSession('admin-user', secret, issuedAt);
    expect(verifyAdminSession(token, secret, issuedAt)).toBe('admin-user');
    expect(verifyAdminSession(token, secret, issuedAt + ADMIN_SESSION_DURATION_MS)).toBeNull();
    expect(verifyAdminSession(token, 'different-server-key', issuedAt)).toBeNull();
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'other-user', iat: issuedAt, exp: issuedAt + ADMIN_SESSION_DURATION_MS })).toString('base64url');
    const tampered = parts.join('.');
    expect(verifyAdminSession(tampered, secret, issuedAt)).toBeNull();
    auth.valid = false;
    const load = vi.spyOn(CampaignAnalyticsService.prototype, 'getSnapshot');
    for (const invalid of [tampered, issueAdminSession('admin-user', secret, issuedAt - ADMIN_SESSION_DURATION_MS), `da_session_${issuedAt}_admin-user`]) {
      for (const handler of [snapshotGET, exportGET]) {
        expect((await handler(request('/api', { Authorization: `Bearer ${invalid}` }))).status).toBe(403);
      }
    }
    auth.role = 'STAFF';
    expect((await snapshotGET(request('/api', { Authorization: `Bearer ${token}` }))).status).toBe(403);
    auth.role = 'ADMIN'; auth.active = false;
    expect((await exportGET(request('/api', { Authorization: `Bearer ${token}` }))).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
  it('QAD-TC43.1 places Promo Analytics immediately after Dashboard', () => {
    const layout = readFileSync('apps/admin-portal/src/app/manage/layout.tsx', 'utf8');
    expect(layout).toMatch(/label: 'Dashboard'[^\n]+\n\s*\{ id: '\/manage\/campaign-analytics', label: 'Promo Analytics'/);
    expect(layout).toContain("case 'promo-analytics'");
  });

  it('QAD-TC43.2 authenticates both endpoints and rejects spoofed, invalid, staff and inactive identities', async () => {
    const snapshot = await serviceFor(fixture()).getSnapshot();
    const load = vi.spyOn(CampaignAnalyticsService.prototype, 'getSnapshot').mockResolvedValue(snapshot);
    for (const handler of [snapshotGET, exportGET]) {
      auth.getUser.mockClear();
      expect((await handler(request('/api?range=30d', { 'x-user-role': 'ADMIN', 'x-user-id': 'admin-user' }))).status).toBe(403);
      expect(auth.getUser).not.toHaveBeenCalled();
      auth.role = 'STAFF';
      expect((await handler(request('/api', { Authorization: 'Bearer valid-token' }))).status).toBe(403);
      auth.role = 'ADMIN'; auth.active = false;
      expect((await handler(request('/api', { Authorization: 'Bearer valid-token' }))).status).toBe(403);
      auth.active = true; auth.valid = false;
      expect((await handler(request('/api', { Authorization: 'Bearer invalid-token' }))).status).toBe(403);
      auth.valid = true;
      expect(load).not.toHaveBeenCalled();
    }
    const response = await snapshotGET(request('/api', { Authorization: 'Bearer valid-token' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(auth.getUser).toHaveBeenCalledWith('valid-token');
    expect((await response.json()).summaryMetrics.vouchersRedeemed).toBe(1);
  });

  it('QAD-TC43.3 counts issuance, redemption and expiry by their own event dates and deduplicates participants', async () => {
    const data = fixture();
    data.vouchers.push(voucher('old', { issued_at: '2026-09-01T00:00:00Z', expires_at: time }));
    const snapshot = await serviceFor(data).getSnapshot('today');
    expect(snapshot.summaryMetrics).toMatchObject({ vouchersIssued: 3, vouchersRedeemed: 1, vouchersExpired: 2, uniqueParticipantsCount: 1 });
    expect(snapshot.campaignPerformance[0]).toMatchObject({ vouchersIssued: 3, vouchersRedeemed: 1, ruleVersion: 2 });
    expect(snapshot.recentRedemptions[0].customerId).toBe('***123456');
    expect(JSON.stringify(snapshot)).not.toContain('customer-private');
  });

  it('QAD-TC43.4 calculates money, ROI and gross AOV with safe zero denominators', async () => {
    const snapshot = await serviceFor(fixture()).getSnapshot();
    expect(snapshot.summaryMetrics).toMatchObject({ totalDiscountsGranted: 14850, attributedGrossRevenue: 82400, marketingRoiMultiple: 5.55, averageOrderValue: 82400 });
    expect(snapshot.recentRedemptions[0].netPaidAmount).toBe(67550);
    expect(snapshot.summaryMetrics.formattedTotalDiscountsGranted).toBe('₱ 14,850.00');
    const empty = fixture(); empty.vouchers = []; empty.reservations = [];
    const zero = await serviceFor(empty).getSnapshot('all');
    expect(zero.summaryMetrics.marketingRoiMultiple).toBe(0);
    expect(zero.summaryMetrics.redemptionRatePercentage).toBe(0);
    expect(zero.previousSummaryMetrics).toBeNull();
    expect(zero.timelineBars).toHaveLength(1);
  });

  it('QAD-TC43.5 excludes pending and unconfirmed redemptions from every financial surface', async () => {
    const data = fixture();
    data.vouchers[0].status = 'PENDING_REDEMPTION';
    let snapshot = await serviceFor(data).getSnapshot();
    expect(snapshot.summaryMetrics.vouchersRedeemed).toBe(0);
    expect(snapshot.summaryMetrics.totalDiscountsGranted).toBe(0);
    expect(snapshot.summaryMetrics.attributedGrossRevenue).toBe(0);
    expect(snapshot.recentRedemptions).toEqual([]);
    expect(snapshot.campaignPerformance[0].attributedRevenue).toBe(0);
    expect(snapshot.timelineBars.every(b => b.redeemedCount === 0)).toBe(true);
    data.vouchers[0].status = 'USED'; data.reservations[0].status = 'AWAITING_PAYMENT';
    snapshot = await serviceFor(data).getSnapshot();
    expect(snapshot.summaryMetrics.vouchersRedeemed).toBe(0);
  });

  it('QAD-TC43.6 handles local midnight, all six ranges, future exclusions and preceding periods', async () => {
    const data = fixture();
    data.vouchers = [
      voucher('boundary', { issued_at: '2026-10-12T16:00:00Z' }),
      voucher('previous', { issued_at: '2026-10-12T15:59:59Z' }),
      voucher('week', { issued_at: '2026-10-06T16:00:00Z' }),
      voucher('month', { issued_at: '2026-09-30T16:00:00Z' }),
      voucher('year', { issued_at: '2026-01-01T00:00:00Z' }),
      voucher('old', { issued_at: '2025-01-01T00:00:00Z' }),
      voucher('future', { issued_at: '2026-10-14T00:00:00Z' }),
    ];
    const service = serviceFor(data);
    expect((await service.getSnapshot('today')).summaryMetrics.vouchersIssued).toBe(1);
    expect((await service.getSnapshot('today')).previousSummaryMetrics?.vouchersIssued).toBe(1);
    expect((await service.getSnapshot('7d')).summaryMetrics.vouchersIssued).toBe(3);
    expect((await service.getSnapshot('30d')).summaryMetrics.vouchersIssued).toBe(4);
    expect((await service.getSnapshot('month')).summaryMetrics.vouchersIssued).toBe(4);
    expect((await service.getSnapshot('year')).summaryMetrics.vouchersIssued).toBe(5);
    expect((await service.getSnapshot('all')).summaryMetrics.vouchersIssued).toBe(6);
    expect((await service.getSnapshot('7d')).rangeLabel).toBe('Last 7 Days');
  });

  it('QAD-TC43.7 reconciles channels, reward types and discounts', async () => {
    const data = fixture();
    data.vouchers.push(voucher('kiosk', { status: 'USED', redeemed_at: time, redeemed_reservation_id: 'r2', redeemed_discount_amount: 100, reward_snapshot: { reward_type: 'FIXED_AMOUNT_DISCOUNT', reward_value: 100 } }));
    data.reservations.push({ ...data.reservations[0], id: 'r2', source: 'KIOSK', requested_voucher_id: 'kiosk', gross_amount_due: 1000, amount_due: 900 });
    const snapshot = await serviceFor(data).getSnapshot();
    expect(snapshot.channelBreakdown).toMatchObject({ webRedemptionsCount: 1, kioskRedemptionsCount: 1, webRedemptionsPercentage: 50, kioskRedemptionsPercentage: 50, webDiscountTotal: 14850, kioskDiscountTotal: 100 });
    expect(snapshot.rewardDistribution).toEqual({ percentageCount: 1, fixedCount: 1, averagePercentage: 15 });
  });

  it('QAD-TC43.8 normalizes charts, preserves totals and caps bucket counts at 14', async () => {
    const data = fixture();
    data.vouchers.push(voucher('history', { issued_at: '2025-01-01T00:00:00Z' }));
    for (const range of ['today', '7d', '30d', 'month', 'year', 'all'] as const) {
      const snapshot = await serviceFor(data).getSnapshot(range);
      expect(snapshot.timelineBars.length).toBeLessThanOrEqual(14);
      expect(snapshot.timelineBars.reduce((sum, b) => sum + b.issuedCount, 0)).toBe(snapshot.summaryMetrics.vouchersIssued);
      expect(snapshot.timelineBars.reduce((sum, b) => sum + b.redeemedCount, 0)).toBe(snapshot.summaryMetrics.vouchersRedeemed);
      expect(snapshot.timelineBars.reduce((sum, b) => sum + b.discountAmount, 0)).toBe(snapshot.summaryMetrics.totalDiscountsGranted);
      for (const bar of snapshot.timelineBars) {
        expect(bar.issuedHeightPercentage).toBeGreaterThanOrEqual(0);
        expect(bar.issuedHeightPercentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it('QAD-TC43.9 searches campaigns/rules, filters statuses and renders versioned performance rows', async () => {
    const snapshot = await serviceFor(fixture()).getSnapshot();
    const rows = snapshot.campaignPerformance;
    expect(filterCampaignPerformance(rows, ' LOYALTY ')).toHaveLength(1);
    expect(filterCampaignPerformance(rows, 'five BOOKINGS')).toHaveLength(1);
    expect(filterCampaignPerformance(rows, '', 'PAUSED')).toHaveLength(0);
    expect(filterCampaignPerformance(rows, 'missing')).toHaveLength(0);
    const higher = { ...rows[0], ruleId: 'second', attributedRevenue: 100000 };
    expect(filterCampaignPerformance([...rows, higher], '')[0].ruleId).toBe('second');
    const html = renderToStaticMarkup(React.createElement(CampaignPerformanceTable, { rows }));
    expect(html).toContain('Five bookings'); expect(html).toContain('v2'); expect(html).toContain('tab=campaigns');
  });

  it('QAD-TC43.10 returns downloadable XLSX/CSV with complete, safe report contents', async () => {
    const snapshot = await serviceFor(fixture()).getSnapshot();
    vi.spyOn(CampaignAnalyticsService.prototype, 'getSnapshot').mockResolvedValue(snapshot);
    const response = await exportGET(request('/api?type=summary', { Authorization: 'Bearer valid-token' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="campaign-summary-30d-');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.worksheets[0].getCell('A2').value).toBe('Loyalty');
    expect(workbook.worksheets[0].getCell('L2').value).toBe(82400);
    snapshot.campaignPerformance[0].campaignName = '=HYPERLINK("unsafe")';
    const csv = await exportCampaignAnalytics(snapshot, 'summary', 'csv');
    expect(csv.body).toContain("'=HYPERLINK");
    const audit = await exportGET(request('/api?type=redemptions&format=csv', { Authorization: 'Bearer valid-token' }));
    expect(audit.headers.get('content-type')).toContain('text/csv');
    expect(await audit.text()).toContain('***123456');
    expect((await exportGET(request('/api?format=pdf', { Authorization: 'Bearer valid-token' }))).status).toBe(400);
    expect((await snapshotGET(request('/api?range=invalid', { Authorization: 'Bearer valid-token' }))).status).toBe(400);
  });

  it('matches Reports workbook styling and preserves typed monetary values, rates, dates and totals', async () => {
    const referenceSnapshot = await createReportsService(new ReservationMemoryRepository(), () => now).getAdminReportsSnapshot('30days');
    const reservation = {
      reservationId: 'reference', referenceCode: 'RES-1', source: 'WEB' as const,
      customerFirstName: 'Sample', customerLastName: 'Guest', customerEmail: 'guest@example.test',
      reservationStatus: 'CONFIRMED' as const, amountDue: 67550, currency: 'PHP', createdAt: time,
      confirmedAt: time, checkedInAt: null, checkedOutAt: null, bookingStartAt: time, bookingEndAt: null,
      assignedCandidateRank: 0 as const, workspaceDisplayName: 'Desk', workspaceInstanceCode: 'D01', workspaceTemplateName: 'Desk', floorName: 'Floor 1',
    };
    const reference = new ExcelJS.Workbook();
    await reference.xlsx.load(await buildAdminExcelWorkbook({ exportType: 'reservations', snapshot: referenceSnapshot, reservations: [reservation, { ...reservation, reservationId: 'second' }], payments: [], now }));
    const baseline = reference.worksheets[0];
    const snapshot = await serviceFor(fixture()).getSnapshot();
    snapshot.campaignPerformance.push({ ...snapshot.campaignPerformance[0], ruleId: 'second', status: 'PAUSED', rewardType: 'FIXED_AMOUNT_DISCOUNT', rewardValue: 100, vouchersIssued: 5, vouchersRedeemed: 3, redemptionRatePercentage: 60, discountsGranted: 200, attributedRevenue: 800 });
    snapshot.recentRedemptions.push({ ...snapshot.recentRedemptions[0], voucherId: 'second', channel: 'KIOSK', discountAmount: 200, netPaidAmount: 600 });
    for (const type of ['summary', 'redemptions'] as const) {
      const report = await exportCampaignAnalytics(snapshot, type, 'xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(report.body));
      const sheet = workbook.worksheets[0];
      expect(workbook.creator).toBe(reference.creator);
      expect(sheet.getCell('A1').font).toEqual(baseline.getCell('A1').font);
      expect(sheet.getCell('A1').fill).toEqual(baseline.getCell('A1').fill);
      expect(sheet.getCell('A1').border).toEqual(baseline.getCell('A1').border);
      expect(sheet.getCell('A2').font).toEqual(baseline.getCell('A2').font);
      expect(sheet.getCell('A2').fill).toEqual(baseline.getCell('A2').fill);
      expect(sheet.getCell('A3').fill).toEqual(baseline.getCell('A3').fill);
      expect(sheet.getCell('A4').font).toEqual(baseline.getCell('A4').font);
      expect(sheet.getCell('A4').border).toEqual(baseline.getCell('A4').border);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBe(type === 'summary' ? 'A1:M3' : 'A1:I3');
      if (type === 'summary') {
        expect(sheet.getCell('K2').value).toBe(14850);
        expect(sheet.getCell('K2').numFmt).toBe(baseline.getCell('K2').numFmt);
        expect(sheet.getCell('G2').value).toBe(0.15);
        expect(sheet.getCell('G2').numFmt).toBe('0.0%');
        expect(sheet.getCell('G3').value).toBe(100);
        expect(sheet.getCell('G3').numFmt).toBe('₱#,##0.00');
        expect(sheet.getCell('J2').value).toBe(0.3333);
        expect(sheet.getCell('K4').value).toEqual({ formula: 'SUM(K2:K3)', result: 15050 });
        expect(sheet.getCell('J4').result).toBe(0.5);
        expect(sheet.getCell('M4').result).toBeCloseTo(83200 / 15050);
        expect(sheet.getCell('B2').fill).toEqual(baseline.getCell('E2').fill);
        expect(sheet.getCell('B3').fill).not.toEqual(sheet.getCell('B2').fill);
      } else {
        expect(sheet.getCell('F1').value).toContain('Asia/Manila');
        expect(sheet.getCell('F2').value).toEqual(new Date('2026-10-13T09:00:00Z'));
        expect(sheet.getCell('G4').value).toEqual({ formula: 'SUM(G2:G3)', result: 15050 });
        expect(sheet.getCell('H4').result).toBe(68150);
        expect(sheet.getCell('B2').value).toBe('***123456');
      }
    }
  });

  it('exports branded empty workbooks without invalid totals or formula ranges', async () => {
    const data = fixture(); data.rules = []; data.vouchers = []; data.reservations = [];
    const snapshot = await serviceFor(data).getSnapshot();
    for (const type of ['summary', 'redemptions'] as const) {
      const report = await exportCampaignAnalytics(snapshot, type, 'xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(report.body));
      const sheet = workbook.worksheets[0];
      expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FF0C3B27' } });
      expect(sheet.getCell('A2').value).toBe('No records for this period.');
      expect(sheet.getCell('K3').formula).toBeUndefined();
    }
  });

  it('paginates beyond the Supabase row cap without selecting contact data or writing records', async () => {
    const sizes: number[] = [];
    const select = vi.fn((columns: string) => ({ order: () => ({ range: async (start: number) => {
      sizes.push(start);
      return { data: columns.includes('timezone') ? [] : Array.from({ length: start === 0 ? 1000 : 1 }, (_, index) => ({ id: String(start + index) })), error: null };
    } }), limit: () => ({ maybeSingle: async () => ({ data: { timezone: 'Asia/Manila' }, error: null }) }) }));
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;
    const data = await new CampaignAnalyticsSupabaseRepository(client).load();
    expect(data.vouchers).toHaveLength(1001);
    expect(sizes.filter(size => size === 1000)).toHaveLength(4);
    expect(select.mock.calls.flat().join(' ')).not.toMatch(/email|first_name|last_name|contact/);
  });
});
