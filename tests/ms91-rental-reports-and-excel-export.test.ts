import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  ReportsService,
  calculateRentalAnalytics,
  buildAdminExcelWorkbook,
  buildRentalsSheet,
  buildRentalRows,
  sanitizeCsvField,
  RetentionPurgeMemoryRepository,
  createRetentionPurgeService,
  TransactionalEmailService,
  type ReportRentalRecord,
  type ReportsRepository,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
  COLORS,
} from '../packages/domain/src';

class MockReportsRepositoryWithRentals implements ReportsRepository {
  constructor(
    private reservations: ReportReservationRecord[] = [],
    private payments: ReportPaymentAttemptRecord[] = [],
    private rentals: ReportRentalRecord[] = []
  ) {}

  async listReportReservations(): Promise<ReportReservationRecord[]> {
    return this.reservations;
  }

  async listReportPaymentAttempts(): Promise<ReportPaymentAttemptRecord[]> {
    return this.payments;
  }

  async listReportRentals(): Promise<ReportRentalRecord[]> {
    return this.rentals;
  }
}

describe('Milestone 91: Additional Services Financial Analytics & Excel Export Integration (MS-91)', () => {
  const rootDir = path.resolve(__dirname, '..');

  const sampleRentals: ReportRentalRecord[] = [
    {
      rentalId: 'rent-01',
      rentalCode: 'RNT-20261029-001',
      bookingReference: 'DA-20261029-001',
      customerName: 'Alice Guo',
      customerEmail: 'alice@example.com',
      spotName: 'Desk 12',
      serviceName: '4K Ultra HD Monitor',
      serviceType: 'rental',
      billingMode: 'hourly',
      durationUnits: 4,
      rateApplied: 25,
      totalAmount: 100,
      extensionCount: 1,
      extensionAmount: 50,
      idVerified: true,
      idNotes: 'Government ID verified at front desk',
      status: 'active',
      rentedAt: '2026-10-29T10:00:00.000Z',
      dueAt: '2026-10-29T14:00:00.000Z',
      returnedAt: null,
      staffName: 'Staff Maria',
    },
    {
      rentalId: 'rent-02',
      rentalCode: 'RNT-20261029-002',
      bookingReference: 'DA-20261029-002',
      customerName: 'Bob Builder',
      customerEmail: 'bob@example.com',
      spotName: 'Desk 04',
      serviceName: 'Ergonomic Standing Desk Converter',
      serviceType: 'rental',
      billingMode: 'daily',
      durationUnits: 1,
      rateApplied: 200,
      totalAmount: 200,
      extensionCount: 0,
      extensionAmount: 0,
      idVerified: true,
      idNotes: 'Driver License verified',
      status: 'returned',
      rentedAt: '2026-10-25T08:00:00.000Z',
      dueAt: '2026-10-25T18:00:00.000Z',
      returnedAt: '2026-10-25T17:45:00.000Z',
      staffName: 'Staff Maria',
    },
    {
      rentalId: 'rent-03',
      rentalCode: 'RNT-20261029-003',
      bookingReference: 'DA-20261029-003',
      customerName: 'Charlie Brown',
      customerEmail: 'charlie@example.com',
      spotName: 'Pod 01',
      serviceName: 'Noise-Cancelling Headphones',
      serviceType: 'rental',
      billingMode: 'hourly',
      durationUnits: 2,
      rateApplied: 50,
      totalAmount: 100,
      extensionCount: 0,
      extensionAmount: 0,
      idVerified: true,
      idNotes: 'Passport verified',
      status: 'overdue',
      rentedAt: '2026-10-28T09:00:00.000Z',
      dueAt: '2026-10-28T11:00:00.000Z',
      returnedAt: null,
      staffName: 'Staff Juan',
    },
    {
      rentalId: 'rent-04',
      rentalCode: 'RNT-20261029-004',
      bookingReference: 'DA-20261029-004',
      customerName: 'David Lee',
      customerEmail: 'david@example.com',
      spotName: 'Desk 08',
      serviceName: '4K Ultra HD Monitor',
      serviceType: 'rental',
      billingMode: 'hourly',
      durationUnits: 2,
      rateApplied: 25,
      totalAmount: 50,
      extensionCount: 0,
      extensionAmount: 0,
      idVerified: false,
      idNotes: '',
      status: 'cancelled',
      rentedAt: '2026-10-27T10:00:00.000Z',
      dueAt: '2026-10-27T12:00:00.000Z',
      returnedAt: null,
      staffName: 'Staff Juan',
    },
  ];

  it('MS91-TC01: Rental Revenue Calculation Accuracy (aggregates base fee and extensions, excludes cancelled)', () => {
    // Single rental with 100 base + 50 extension
    const singleRental: ReportRentalRecord[] = [
      {
        rentalId: 'rent-tc01',
        rentalCode: 'RNT-TC01',
        bookingReference: 'DA-REF-TC01',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        spotName: 'Spot 01',
        serviceName: 'Test Item',
        serviceType: 'rental',
        billingMode: 'hourly',
        durationUnits: 2,
        rateApplied: 50,
        totalAmount: 100,
        extensionCount: 1,
        extensionAmount: 50,
        idVerified: true,
        idNotes: '',
        status: 'active',
        rentedAt: '2026-10-29T10:00:00Z',
        dueAt: '2026-10-29T12:00:00Z',
        returnedAt: null,
        staffName: 'Staff',
      },
    ];

    const analytics = calculateRentalAnalytics(singleRental);
    // Strict invariant: 100 PHP base + 50 PHP extension = 150 PHP total revenue
    expect(analytics.totalRentalRevenue).toBe(150);
    expect(analytics.totalRentalsCount).toBe(1);
    expect(analytics.activeRentalsCount).toBe(1);

    // Multi-item analytics: rent-01 (100+50=150) + rent-02 (200) + rent-03 (100) = 450; rent-04 is cancelled (excluded)
    const multiAnalytics = calculateRentalAnalytics(sampleRentals);
    expect(multiAnalytics.totalRentalRevenue).toBe(450);
    expect(multiAnalytics.totalRentalsCount).toBe(4);
    expect(multiAnalytics.activeRentalsCount).toBe(1);
    expect(multiAnalytics.returnedRentalsCount).toBe(1);
    expect(multiAnalytics.overdueRentalsCount).toBe(1);
    expect(multiAnalytics.topRentedItems.length).toBeGreaterThan(0);
  });

  it('MS91-TC02: Excel Worksheet Integration (generates "Additional Services & Rentals" sheet)', async () => {
    const fixedNow = new Date('2026-10-29T12:00:00.000Z');
    const repo = new MockReportsRepositoryWithRentals([], [], sampleRentals);
    const service = new ReportsService(repo, () => fixedNow);
    const snapshot = await service.getAdminReportsSnapshot('month');

    const buffer = await buildAdminExcelWorkbook({
      exportType: 'operations-summary',
      snapshot,
      reservations: [],
      payments: [],
      rentals: sampleRentals,
      now: fixedNow,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain('Executive Dashboard');
    expect(sheetNames).toContain('Additional Services & Rentals');
  });

  it('MS91-TC03: Excel Header Styling Parity (navy fill, white bold text, centered)', async () => {
    const workbook = new ExcelJS.Workbook();
    buildRentalsSheet(workbook, sampleRentals);

    const sheet = workbook.getWorksheet('Additional Services & Rentals')!;
    expect(sheet).toBeDefined();

    // Check Row 4 (Table Headers)
    const headerRow = sheet.getRow(4);
    expect(headerRow).toBeDefined();

    // Column A4: "Rental Code"
    const cellA4 = sheet.getCell('A4');
    expect(cellA4.value).toBe('Rental Code');
    expect(cellA4.fill).toBeDefined();
    expect((cellA4.fill as any).fgColor?.argb).toBe(COLORS.BRAND_DARK);
    expect(cellA4.font?.bold).toBe(true);
    expect(cellA4.font?.color?.argb).toBe(COLORS.WHITE);

    // Column J4: "Total Fee (PHP)"
    const cellJ4 = sheet.getCell('J4');
    expect(cellJ4.value).toBe('Total Fee (PHP)');
    expect((cellJ4.fill as any).fgColor?.argb).toBe(COLORS.BRAND_DARK);
    expect(cellJ4.font?.bold).toBe(true);
  });

  it('MS91-TC04: Excel Status Badge Styling (ACTIVE, RETURNED, and OVERDUE apply correct fills and fonts)', async () => {
    const workbook = new ExcelJS.Workbook();
    buildRentalsSheet(workbook, sampleRentals);

    const sheet = workbook.getWorksheet('Additional Services & Rentals')!;

    // Row 5 is rent-01: ACTIVE (Col 14: N5)
    const cellN5 = sheet.getCell('N5');
    expect(cellN5.value).toBe('ACTIVE');
    expect((cellN5.fill as any).fgColor?.argb).toBe(COLORS.SUCCESS_BG);
    expect(cellN5.font?.color?.argb).toBe(COLORS.SUCCESS_FG);
    expect(cellN5.font?.bold).toBe(true);

    // Row 6 is rent-02: RETURNED (Col 14: N6)
    const cellN6 = sheet.getCell('N6');
    expect(cellN6.value).toBe('RETURNED');
    expect((cellN6.fill as any).fgColor?.argb).toBe(COLORS.CANVAS);
    expect(cellN6.font?.color?.argb).toBe(COLORS.TEXT_SECONDARY);

    // Row 7 is rent-03: OVERDUE (Col 14: N7)
    const cellN7 = sheet.getCell('N7');
    expect(cellN7.value).toBe('OVERDUE');
    expect((cellN7.fill as any).fgColor?.argb).toBe(COLORS.DANGER_BG);
    expect(cellN7.font?.color?.argb).toBe(COLORS.DANGER_FG);
    expect(cellN7.font?.bold).toBe(true);
  });

  it('MS91-TC05: Excel Formula Total Row (uses formulas =SUM(...) and double bottom border)', async () => {
    const workbook = new ExcelJS.Workbook();
    buildRentalsSheet(workbook, sampleRentals);

    const sheet = workbook.getWorksheet('Additional Services & Rentals')!;
    // 4 header/title rows + 4 data rows = Row 9 is the totals row
    const totalRowNum = 5 + sampleRentals.length; // 9
    const totalRow = sheet.getRow(totalRowNum);

    // Col A: TOTAL / SUMMARY label
    const cellA = sheet.getCell(`A${totalRowNum}`);
    expect(cellA.value).toBe('TOTAL / SUMMARY');

    // Col B: Count formula =COUNTA(A5:A8)
    const cellB = sheet.getCell(`B${totalRowNum}`);
    expect((cellB.value as any)?.formula).toBe(`COUNTA(A5:A${4 + sampleRentals.length})`);

    // Col J: Sum formula =SUM(J5:J8)
    const cellJ = sheet.getCell(`J${totalRowNum}`);
    expect((cellJ.value as any)?.formula).toBe(`SUM(J5:J${4 + sampleRentals.length})`);

    // Verify double bottom underline border styling from styleTotalRowCell
    expect(cellJ.border?.bottom?.style).toBe('double');
    expect(cellA.border?.bottom?.style).toBe('double');
  });

  it('MS91-TC06: Executive Dashboard Rental KPI and Top Rented Equipment table', async () => {
    const fixedNow = new Date('2026-10-29T12:00:00.000Z');
    const repo = new MockReportsRepositoryWithRentals([], [], sampleRentals);
    const service = new ReportsService(repo, () => fixedNow);
    const snapshot = await service.getAdminReportsSnapshot('month');

    const buffer = await buildAdminExcelWorkbook({
      exportType: 'operations-summary',
      snapshot,
      reservations: [],
      payments: [],
      rentals: sampleRentals,
      now: fixedNow,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const dashboard = workbook.getWorksheet('Executive Dashboard')!;
    expect(dashboard).toBeDefined();

    // Scan dashboard sheet cells for Rental KPI scorecard copy
    let foundKpiTitle = false;
    let foundKpiSubtext = false;
    let foundTopRentalsSection = false;

    dashboard.eachRow((row) => {
      row.eachCell((cell) => {
        const strVal = typeof cell.value === 'object' && cell.value !== null && 'richText' in cell.value
          ? (cell.value as any).richText.map((t: any) => t.text).join('')
          : String(cell.value ?? '');

        if (strVal.includes('RENTAL & SERVICE REVENUE')) foundKpiTitle = true;
        if (strVal.includes('transactions') && strVal.includes('currently active')) foundKpiSubtext = true;
        if (strVal.includes('TOP RENTED EQUIPMENT')) foundTopRentalsSection = true;
      });
    });

    expect(foundKpiTitle).toBe(true);
    expect(foundKpiSubtext).toBe(true);
    expect(foundTopRentalsSection).toBe(true);
  });

  it('MS91-TC07: CSV Export RFC-4180 Compliance & Formula Injection Sanitization', () => {
    const maliciousRentals: ReportRentalRecord[] = [
      {
        rentalId: 'rent-injection',
        rentalCode: '=cmd|"/C calc"!A0',
        bookingReference: '+1234567890',
        customerName: '-Malicious User, Jr.',
        customerEmail: '@attacker@example.com',
        spotName: 'Desk "Special" 01',
        serviceName: '4K Monitor, with HDMI',
        serviceType: 'rental',
        billingMode: 'hourly',
        durationUnits: 2,
        rateApplied: 25,
        totalAmount: 50,
        extensionCount: 0,
        extensionAmount: 0,
        idVerified: true,
        idNotes: 'Safe',
        status: 'active',
        rentedAt: '2026-10-29T10:00:00Z',
        dueAt: '2026-10-29T12:00:00Z',
        returnedAt: null,
        staffName: 'Staff Maria',
      },
    ];

    // Verify sanitizeCsvField strips leading injection chars
    expect(sanitizeCsvField('=cmd|"/C calc"!A0')).toBe('cmd|"/C calc"!A0');
    expect(sanitizeCsvField('+1234567890')).toBe('1234567890');
    expect(sanitizeCsvField('-Malicious User, Jr.')).toBe('Malicious User, Jr.');
    expect(sanitizeCsvField('@attacker@example.com')).toBe('attacker@example.com');

    const rows = buildRentalRows(maliciousRentals);
    expect(rows.length).toBe(1);
    expect(rows[0]['Rental Code']).not.toMatch(/^[=+\-@]/);
    expect(rows[0]['Booking Ref']).not.toMatch(/^[=+\-@]/);
    expect(rows[0]['Customer Name']).not.toMatch(/^[=+\-@]/);
  });

  it('MS91-TC08: Timeframe Reactivity (filtering rentals across today vs month)', async () => {
    const fixedNow = new Date('2026-10-29T12:00:00.000Z');
    const repo = new MockReportsRepositoryWithRentals([], [], sampleRentals);
    const service = new ReportsService(repo, () => fixedNow);

    // Query for "today" (2026-10-29): only rent-01 occurred on 2026-10-29
    const todaySnapshot = await service.getAdminReportsSnapshot('today');
    expect(todaySnapshot.rentalAnalytics).toBeDefined();
    expect(todaySnapshot.rentalAnalytics?.totalRentalsCount).toBe(1);
    expect(todaySnapshot.rentalAnalytics?.totalRentalRevenue).toBe(150);

    // Query for "month" (October 2026): all October rentals included (rent-01, 02, 03, 04)
    const monthSnapshot = await service.getAdminReportsSnapshot('month');
    expect(monthSnapshot.rentalAnalytics).toBeDefined();
    expect(monthSnapshot.rentalAnalytics?.totalRentalsCount).toBe(4);
    expect(monthSnapshot.rentalAnalytics?.totalRentalRevenue).toBe(450);
  });

  it('MS91-TC09: Pre-Purge Backup Invariant (rentals in Excel attachment and raw JSON archive)', async () => {
    const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

    const repo = new RetentionPurgeMemoryRepository({
      reservations: [
        {
          id: 'res-purge-01',
          reference_code: 'DA-20260115-001',
          start_at: '2026-01-15T09:00:00Z',
          end_at: '2026-01-15T18:00:00Z',
          created_at: '2026-01-10T10:00:00Z',
          status: 'COMPLETED',
          customer_first_name: 'Historical',
          customer_last_name: 'Customer',
          customer_email: 'historical@example.com',
          total_amount: 500,
        },
      ],
      paymentAttempts: [
        {
          id: 'pay-purge-01',
          reservation_id: 'res-purge-01',
          amount: 500,
          status: 'APPROVED',
          created_at: '2026-01-10T10:00:00Z',
          processed_at: '2026-01-10T10:05:00Z',
        },
      ],
      bookingRentals: [
        {
          id: 'rental-purge-01',
          rental_code: 'RNT-20260115-001',
          reservation_id: 'res-purge-01',
          customer_name: 'Historical Customer',
          customer_email: 'historical@example.com',
          service_name: 'Dual Monitor Arm',
          service_type: 'rental',
          billing_mode: 'hourly',
          duration_units: 4,
          rate_applied: 50,
          total_amount: 200,
          status: 'returned',
          rented_at: '2026-01-15T10:00:00Z',
          due_at: '2026-01-15T14:00:00Z',
          returned_at: '2026-01-15T13:50:00Z',
        },
      ],
      rentalExtensions: [
        {
          id: 'ext-purge-01',
          rental_id: 'rental-purge-01',
          additional_amount: 50,
        },
      ],
      adminEmail: 'ops-admin@deskatlas.com',
    });

    let sentEmailPayload: any = null;
    const mockEmailService: Partial<TransactionalEmailService> = {
      sendQuarterlyRetentionBackupEmail: async (payload: any) => {
        sentEmailPayload = payload;
        return { success: true, id: 'msg-retention-backup-91' };
      },
    };

    const purgeService = createRetentionPurgeService(
      repo,
      mockEmailService as TransactionalEmailService,
      () => q1Cutoff
    );

    const result = await purgeService.executeQuarterlyPurge({
      targetDate: q1Cutoff,
    });

    expect(result.success).toBe(true);
    expect(sentEmailPayload).not.toBeNull();

    // 1. Verify Excel Attachment contains the Additional Services & Rentals worksheet
    const excelWorkbook = new ExcelJS.Workbook();
    await excelWorkbook.xlsx.load(sentEmailPayload.excelReportBuffer);
    const sheetNames = excelWorkbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain('Additional Services & Rentals');

    // 2. Verify JSON Backup Payload includes rental records and extensions
    const parsedJson = JSON.parse(sentEmailPayload.jsonBackupBuffer.toString('utf-8'));
    expect(parsedJson.bookingRentals).toBeDefined();
    expect(parsedJson.bookingRentals.length).toBe(1);
    expect(parsedJson.bookingRentals[0].rental_code).toBe('RNT-20260115-001');
    expect(parsedJson.rentalExtensions).toBeDefined();
    expect(parsedJson.rentalExtensions.length).toBe(1);
    expect(parsedJson.metadata.rentalCount).toBe(1);

    // 3. Verify Database Purge removed the rentals
    expect(repo.bookingRentals.length).toBe(0);
    expect(repo.rentalExtensions.length).toBe(0);
    expect(repo.reservations.length).toBe(0);
  });

  it('MS91-TC10: Zero Em-Dash Enforcement (BAN-PUNCT-01 across all reporting headers and copy)', () => {
    // 1. Inspect domain reports files
    const reportsFilePath = path.join(rootDir, 'packages/domain/src/services/reportsService.ts');
    const reportsContent = fs.readFileSync(reportsFilePath, 'utf-8');
    expect(reportsContent).not.toContain('\u2014');
    expect(reportsContent).not.toContain('\u2013');

    // 2. Inspect excelReportBuilder.ts
    const excelBuilderPath = path.join(rootDir, 'packages/domain/src/services/excelReportBuilder.ts');
    const excelContent = fs.readFileSync(excelBuilderPath, 'utf-8');
    expect(excelContent).not.toContain('\u2014');
    expect(excelContent).not.toContain('\u2013');

    // 3. Inspect UI components
    const reportsUiPath = path.join(
      rootDir,
      'apps/admin-portal/src/features/reports/components/Reports.tsx'
    );
    const reportsUiContent = fs.readFileSync(reportsUiPath, 'utf-8');
    expect(reportsUiContent).not.toContain('\u2014');
    expect(reportsUiContent).not.toContain('\u2013');

    const rentalCardPath = path.join(
      rootDir,
      'apps/admin-portal/src/features/reports/components/RentalMetricsCard.tsx'
    );
    const rentalCardContent = fs.readFileSync(rentalCardPath, 'utf-8');
    expect(rentalCardContent).not.toContain('\u2014');
    expect(rentalCardContent).not.toContain('\u2013');

    const topRentalsPath = path.join(
      rootDir,
      'apps/admin-portal/src/features/reports/components/TopRentalsTable.tsx'
    );
    const topRentalsContent = fs.readFileSync(topRentalsPath, 'utf-8');
    expect(topRentalsContent).not.toContain('\u2014');
    expect(topRentalsContent).not.toContain('\u2013');
  });
});

