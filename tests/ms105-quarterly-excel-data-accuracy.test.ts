import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  RetentionPurgeMemoryRepository,
  RetentionPurgeSupabaseRepository,
  buildAdminExcelWorkbook,
  formatWorkspaceLabel,
  ReportsService,
  createRetentionPurgeService,
  TransactionalEmailService,
  type ReportReservationRecord,
  type ReportPaymentAttemptRecord,
} from '../packages/domain/src';

describe('MS-105: Automated Quarterly Retention and Operations Summary Excel Report Data Accuracy', () => {
  const rootDir = path.resolve(__dirname, '..');
  const q1Cutoff = new Date('2026-03-31T23:59:59.999Z');

  describe('Part 1: In-Memory Repository Relational Hydration & Cash Method Parity (MS105-TC01 - MS105-TC03, MS105-TC07)', () => {
    it('MS105-TC01 & TC02: Hydrates real workspace instances, templates, and floors without SPOT-01 fallback', async () => {
      const repo = new RetentionPurgeMemoryRepository({
        workspaceInstances: [
          { id: 'inst-fp02', display_name: 'Focus Pod 02', instance_code: 'FP-02', template_id: 'tmpl-fp', floor_id: 'flr-02' },
          { id: 'inst-dd04', display_name: 'Dedicated Desk 4', instance_code: 'DD-04', template_id: 'tmpl-dd', floor_id: 'flr-01' },
          { id: 'inst-hda1', display_name: 'Hot Desk A-01', instance_code: 'HD-A01', template_id: 'tmpl-hd', floor_id: 'flr-01' },
        ],
        workspaceTemplates: [
          { id: 'tmpl-fp', name: 'Focus Pod' },
          { id: 'tmpl-dd', name: 'Dedicated Desk' },
          { id: 'tmpl-hd', name: 'Hot Desk' },
        ],
        floors: [
          { id: 'flr-01', name: '1st Floor' },
          { id: 'flr-02', name: '2nd Floor' },
        ],
        reservations: [
          {
            id: 'res-01',
            reference_code: 'DA-20260115-001',
            start_at: '2026-01-15T09:00:00Z',
            end_at: '2026-01-15T18:00:00Z',
            created_at: '2026-01-10T10:00:00Z',
            status: 'COMPLETED',
            total_amount: 500,
            customer_first_name: 'Juan',
            customer_last_name: 'Dela Cruz',
          },
          {
            id: 'res-02',
            reference_code: 'DA-20260210-002',
            start_at: '2026-02-10T09:00:00Z',
            end_at: '2026-02-10T18:00:00Z',
            created_at: '2026-02-08T10:00:00Z',
            status: 'COMPLETED',
            total_amount: 350,
            customer_first_name: 'Maria',
            customer_last_name: 'Santos',
          },
          {
            id: 'res-03',
            reference_code: 'DA-20260305-003',
            start_at: '2026-03-05T09:00:00Z',
            end_at: '2026-03-05T18:00:00Z',
            created_at: '2026-03-01T10:00:00Z',
            status: 'COMPLETED',
            total_amount: 250,
            customer_first_name: 'Carlos',
            customer_last_name: 'Reyes',
          },
        ],
        candidates: [
          { reservation_id: 'res-01', workspace_instance_id: 'inst-fp02', is_assigned: true, rank: 0 },
          { reservation_id: 'res-02', workspace_instance_id: 'inst-dd04', is_assigned: true, rank: 0 },
          { reservation_id: 'res-03', workspace_instance_id: 'inst-hda1', is_assigned: true, rank: 0 },
        ],
      });

      const records = await repo.getPurgeEligibleRecords(q1Cutoff);
      expect(records.reportReservations).toHaveLength(3);

      const res1 = records.reportReservations.find((r) => r.reservationId === 'res-01');
      expect(res1?.workspaceDisplayName).toBe('Focus Pod 02');
      expect(res1?.workspaceInstanceCode).toBe('FP-02');
      expect(res1?.workspaceTemplateName).toBe('Focus Pod');
      expect(res1?.floorName).toBe('2nd Floor');

      const res2 = records.reportReservations.find((r) => r.reservationId === 'res-02');
      expect(res2?.workspaceDisplayName).toBe('Dedicated Desk 4');
      expect(res2?.workspaceInstanceCode).toBe('DD-04');
      expect(res2?.workspaceTemplateName).toBe('Dedicated Desk');
      expect(res2?.floorName).toBe('1st Floor');

      const res3 = records.reportReservations.find((r) => r.reservationId === 'res-03');
      expect(res3?.workspaceDisplayName).toBe('Hot Desk A-01');
      expect(res3?.workspaceInstanceCode).toBe('HD-A01');
      expect(res3?.workspaceTemplateName).toBe('Hot Desk');
      expect(res3?.floorName).toBe('1st Floor');

      // Assert zero fallback placeholders when candidate instance exists
      for (const r of records.reportReservations) {
        expect(r.workspaceDisplayName).not.toBe('Workspace Spot');
        expect(r.workspaceInstanceCode).not.toBe('SPOT-01');
      }
    });

    it('MS105-TC03: Correctly identifies Kiosk counter Cash payments as CASH rather than GCASH or BANK', async () => {
      const repo = new RetentionPurgeMemoryRepository({
        paymentMethods: [
          { id: 'meth-cash', method_type: 'CASH', display_name: 'Cash at Counter' },
          { id: 'meth-gcash', method_type: 'GCASH', display_name: 'GCash QR' },
          { id: 'meth-bdo', method_type: 'BANK', display_name: 'BDO Bank Transfer' },
        ],
        reservations: [
          {
            id: 'res-kiosk-cash',
            reference_code: 'DA-KIOSK-001',
            start_at: '2026-02-15T10:00:00Z',
            end_at: '2026-02-15T14:00:00Z',
            created_at: '2026-02-15T09:50:00Z',
            status: 'COMPLETED',
            source: 'KIOSK',
          },
          {
            id: 'res-web-gcash',
            reference_code: 'DA-WEB-002',
            start_at: '2026-02-16T10:00:00Z',
            end_at: '2026-02-16T14:00:00Z',
            created_at: '2026-02-15T10:00:00Z',
            status: 'COMPLETED',
            source: 'WEB',
          },
          {
            id: 'res-web-bank',
            reference_code: 'DA-WEB-003',
            start_at: '2026-02-17T10:00:00Z',
            end_at: '2026-02-17T14:00:00Z',
            created_at: '2026-02-15T11:00:00Z',
            status: 'COMPLETED',
            source: 'WEB',
          },
        ],
        paymentAttempts: [
          // Kiosk cash counter payment with method_id
          {
            id: 'pay-01',
            reservation_id: 'res-kiosk-cash',
            amount: 300,
            status: 'APPROVED',
            channel: 'KIOSK',
            payment_method_id: 'meth-cash',
            created_at: '2026-02-15T09:55:00Z',
          },
          // Kiosk cash payment without explicit payment_method_id (inferred from KIOSK channel)
          {
            id: 'pay-02',
            reservation_id: 'res-kiosk-cash',
            amount: 300,
            status: 'APPROVED',
            channel: 'KIOSK',
            payment_method: 'Cash Payment at Reception',
            created_at: '2026-02-15T09:56:00Z',
          },
          // GCash payment
          {
            id: 'pay-03',
            reservation_id: 'res-web-gcash',
            amount: 450,
            status: 'APPROVED',
            channel: 'WEB',
            payment_method_id: 'meth-gcash',
            created_at: '2026-02-15T10:05:00Z',
          },
          // Bank transfer payment
          {
            id: 'pay-04',
            reservation_id: 'res-web-bank',
            amount: 600,
            status: 'APPROVED',
            channel: 'WEB',
            payment_method_id: 'meth-bdo',
            created_at: '2026-02-15T11:05:00Z',
          },
        ],
      });

      const records = await repo.getPurgeEligibleRecords(q1Cutoff);
      expect(records.reportPayments).toHaveLength(4);

      const pay1 = records.reportPayments.find((p) => p.paymentAttemptId === 'pay-01');
      expect(pay1?.paymentMethodType).toBe('CASH');
      expect(pay1?.paymentMethodDisplayName).toBe('Cash at Counter');

      const pay2 = records.reportPayments.find((p) => p.paymentAttemptId === 'pay-02');
      expect(pay2?.paymentMethodType).toBe('CASH');
      expect(pay2?.paymentMethodDisplayName).toBe('Cash Payment at Reception');

      const pay3 = records.reportPayments.find((p) => p.paymentAttemptId === 'pay-03');
      expect(pay3?.paymentMethodType).toBe('GCASH');

      const pay4 = records.reportPayments.find((p) => p.paymentAttemptId === 'pay-04');
      expect(pay4?.paymentMethodType).toBe('BANK');
    });
  });

  describe('Part 2: Supabase Repository Relational Queries (MS105-TC01, MS105-TC03)', () => {
    it('queries workspace_instances, templates, floors, and payment_methods batch tables', async () => {
      // Mock Supabase client
      const mockClient = {
        from: (table: string) => {
          return {
            select: () => ({
              gt: async () => ({ data: [], error: null }),
              lte: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'res-sup-01',
                      reference_code: 'DA-SUP-001',
                      customer_first_name: 'Elena',
                      customer_last_name: 'Gilbert',
                      customer_email: 'elena@example.com',
                      status: 'COMPLETED',
                      amount_due: 400,
                      created_at: '2026-01-20T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
              in: async (col: string, vals: string[]) => {
                if (table === 'reservation_candidates') {
                  return {
                    data: [
                      {
                        reservation_id: 'res-sup-01',
                        workspace_instance_id: 'inst-sup-pod',
                        is_assigned: true,
                        rank: 0,
                        start_at: '2026-01-20T10:00:00Z',
                        end_at: '2026-01-20T18:00:00Z',
                      },
                    ],
                    error: null,
                  };
                }
                if (table === 'payment_attempts') {
                  return {
                    data: [
                      {
                        id: 'pay-sup-01',
                        reservation_id: 'res-sup-01',
                        amount: 400,
                        status: 'APPROVED',
                        channel: 'KIOSK',
                        payment_method_id: 'meth-sup-cash',
                        created_at: '2026-01-20T10:05:00Z',
                      },
                    ],
                    error: null,
                  };
                }
                if (table === 'paid_candidate_recovery') {
                  return { data: [], error: null };
                }
                if (table === 'workspace_instances') {
                  return {
                    data: [
                      {
                        id: 'inst-sup-pod',
                        display_name: 'Silent Booth 01',
                        instance_code: 'SB-01',
                        template_id: 'tmpl-booth',
                        floor_id: 'flr-ground',
                      },
                    ],
                    error: null,
                  };
                }
                return { data: [], error: null };
              },
              then: (resolve: (val: unknown) => void) => {
                if (table === 'workspace_templates') {
                  resolve({ data: [{ id: 'tmpl-booth', name: 'Silent Booth' }], error: null });
                } else if (table === 'floors') {
                  resolve({ data: [{ id: 'flr-ground', name: 'Ground Floor' }], error: null });
                } else if (table === 'payment_methods') {
                  resolve({
                    data: [{ id: 'meth-sup-cash', method_type: 'CASH', display_name: 'Cash Register' }],
                    error: null,
                  });
                } else {
                  resolve({ data: [], error: null });
                }
              },
            }),
          };
        },
      };

      const repo = new RetentionPurgeSupabaseRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
        supabaseClient: mockClient as any,
      });

      const records = await repo.getPurgeEligibleRecords(q1Cutoff);
      expect(records.reportReservations).toHaveLength(1);
      const res = records.reportReservations[0];
      expect(res.workspaceDisplayName).toBe('Silent Booth 01');
      expect(res.workspaceInstanceCode).toBe('SB-01');
      expect(res.workspaceTemplateName).toBe('Silent Booth');
      expect(res.floorName).toBe('Ground Floor');

      expect(records.reportPayments).toHaveLength(1);
      const pay = records.reportPayments[0];
      expect(pay.paymentMethodType).toBe('CASH');
      expect(pay.paymentMethodDisplayName).toBe('Cash Register');
    });
  });

  describe('Part 3: Excel Report Builder Worksheet Data Formatting (MS105-TC04 - MS105-TC06)', () => {
    it('MS105-TC04: Excel Payment Records sheet renders CASH method type accurately', async () => {
      const mockReservations: ReportReservationRecord[] = [
        {
          reservationId: 'res-kiosk-01',
          referenceCode: 'DA-20260201-001',
          source: 'KIOSK',
          customerFirstName: 'Pedro',
          customerLastName: 'Penduko',
          customerEmail: 'pedro@example.com',
          reservationStatus: 'COMPLETED',
          amountDue: 500,
          currency: 'PHP',
          createdAt: '2026-02-01T08:00:00Z',
          confirmedAt: '2026-02-01T08:05:00Z',
          checkedInAt: '2026-02-01T08:10:00Z',
          checkedOutAt: '2026-02-01T17:00:00Z',
          bookingStartAt: '2026-02-01T08:00:00Z',
          bookingEndAt: '2026-02-01T17:00:00Z',
          assignedCandidateRank: 0,
          workspaceDisplayName: 'Focus Pod 02',
          workspaceInstanceCode: 'FP-02',
          workspaceTemplateName: 'Focus Pod',
          floorName: '2nd Floor',
        },
      ];

      const mockPayments: ReportPaymentAttemptRecord[] = [
        {
          paymentAttemptId: 'pay-c1',
          reservationId: 'res-kiosk-01',
          reservationReferenceCode: 'DA-20260201-001',
          channel: 'KIOSK',
          paymentStatus: 'APPROVED',
          refundStatus: 'NONE',
          amount: 500,
          currency: 'PHP',
          paymentMethodId: 'meth-c1',
          paymentMethodType: 'CASH',
          paymentMethodDisplayName: 'Cash at Counter',
          createdAt: '2026-02-01T08:05:00Z',
          proofSubmittedAt: null,
          processedAt: '2026-02-01T08:05:00Z',
        },
        {
          paymentAttemptId: 'pay-g1',
          reservationId: 'res-kiosk-01',
          reservationReferenceCode: 'DA-20260201-001',
          channel: 'WEB',
          paymentStatus: 'APPROVED',
          refundStatus: 'NONE',
          amount: 500,
          currency: 'PHP',
          paymentMethodId: 'meth-g1',
          paymentMethodType: 'GCASH',
          paymentMethodDisplayName: 'GCash Online',
          createdAt: '2026-02-01T08:05:00Z',
          proofSubmittedAt: '2026-02-01T08:06:00Z',
          processedAt: '2026-02-01T08:07:00Z',
        },
      ];

      const reportsService = new ReportsService({
        listReportReservations: async () => mockReservations,
        listReportPaymentAttempts: async () => mockPayments,
      }, () => q1Cutoff);
      const snapshot = await reportsService.getAdminReportsSnapshot('month');

      const excelBuffer = await buildAdminExcelWorkbook({
        exportType: 'operations-summary',
        range: 'month',
        snapshot,
        reservations: mockReservations,
        payments: mockPayments,
        now: q1Cutoff,
      });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(excelBuffer);

      const paySheet = wb.getWorksheet('Payment Records');
      expect(paySheet).toBeDefined();

      // Row 2 is first payment (Cash), Col 6 is "Method Type"
      const cashRow = paySheet!.getRow(2);
      expect(cashRow.getCell(6).value).toBe('CASH');
      expect(cashRow.getCell(5).value).toBe('Cash at Counter');

      // Row 3 is second payment (GCash)
      const gcashRow = paySheet!.getRow(3);
      expect(gcashRow.getCell(6).value).toBe('GCASH');
    });

    it('MS105-TC05 & TC06: Executive Dashboard, Workspace Utilization, Check-in, and History sheets reflect name and code', async () => {
      const mockReservations: ReportReservationRecord[] = [
        {
          reservationId: 'res-fp-01',
          referenceCode: 'DA-20260201-001',
          source: 'WEB',
          customerFirstName: 'Pedro',
          customerLastName: 'Penduko',
          customerEmail: 'pedro@example.com',
          reservationStatus: 'COMPLETED',
          amountDue: 500,
          currency: 'PHP',
          createdAt: '2026-02-01T08:00:00Z',
          confirmedAt: '2026-02-01T08:05:00Z',
          checkedInAt: '2026-02-01T08:10:00Z',
          checkedOutAt: '2026-02-01T17:00:00Z',
          bookingStartAt: '2026-02-01T08:00:00Z',
          bookingEndAt: '2026-02-01T17:00:00Z',
          assignedCandidateRank: 0,
          workspaceDisplayName: 'Focus Pod 02',
          workspaceInstanceCode: 'FP-02',
          workspaceTemplateName: 'Focus Pod',
          floorName: '2nd Floor',
        },
        {
          reservationId: 'res-dd-02',
          referenceCode: 'DA-20260202-002',
          source: 'KIOSK',
          customerFirstName: 'Ana',
          customerLastName: 'Rizal',
          customerEmail: 'ana@example.com',
          reservationStatus: 'CHECKED_IN',
          amountDue: 350,
          currency: 'PHP',
          createdAt: '2026-02-02T09:00:00Z',
          confirmedAt: '2026-02-02T09:05:00Z',
          checkedInAt: '2026-02-02T09:10:00Z',
          checkedOutAt: null,
          bookingStartAt: '2026-02-02T09:00:00Z',
          bookingEndAt: '2026-02-02T18:00:00Z',
          assignedCandidateRank: 0,
          workspaceDisplayName: 'Dedicated Desk 4',
          workspaceInstanceCode: 'DD-04',
          workspaceTemplateName: 'Dedicated Desk',
          floorName: '1st Floor',
        },
      ];

      const reportsService = new ReportsService({
        listReportReservations: async () => mockReservations,
        listReportPaymentAttempts: async () => [],
      }, () => q1Cutoff);
      const snapshot = await reportsService.getAdminReportsSnapshot('month');

      const excelBuffer = await buildAdminExcelWorkbook({
        exportType: 'operations-summary',
        range: 'month',
        snapshot,
        reservations: mockReservations,
        payments: [],
        now: q1Cutoff,
      });

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(excelBuffer);

      // 1. Executive Dashboard: Top Workspaces Table (Col B starting around row 24)
      const execSheet = wb.getWorksheet('Executive Dashboard');
      expect(execSheet).toBeDefined();

      const execWs1Name = execSheet!.getCell('B24').value;
      const execWs2Name = execSheet!.getCell('B25').value;
      expect(execWs1Name).toBe('Focus Pod 02 (FP-02)');
      expect(execWs2Name).toBe('Dedicated Desk 4 (DD-04)');

      // 2. Reservations History Sheet
      const resSheet = wb.getWorksheet('Reservations History');
      expect(resSheet).toBeDefined();
      const resRow2 = resSheet!.getRow(2);
      expect(resRow2.getCell(6).value).toBe('Focus Pod 02 (FP-02)'); // Workspace Name column
      expect(resRow2.getCell(7).value).toBe('FP-02'); // Workspace Code column
      const resRow3 = resSheet!.getRow(3);
      expect(resRow3.getCell(6).value).toBe('Dedicated Desk 4 (DD-04)');
      expect(resRow3.getCell(7).value).toBe('DD-04');

      // 3. Workspace Utilization Sheet
      const wsSheet = wb.getWorksheet('Workspace Utilization');
      expect(wsSheet).toBeDefined();
      const wsRow2 = wsSheet!.getRow(2);
      expect(wsRow2.getCell(2).value).toBe('Focus Pod 02 (FP-02)');
      expect(wsRow2.getCell(3).value).toBe('FP-02');
      const wsRow3 = wsSheet!.getRow(3);
      expect(wsRow3.getCell(2).value).toBe('Dedicated Desk 4 (DD-04)');
      expect(wsRow3.getCell(3).value).toBe('DD-04');

      // 4. Check-in Records Sheet
      const checkinSheet = wb.getWorksheet('Check-in Records');
      expect(checkinSheet).toBeDefined();
      const checkinRow2 = checkinSheet!.getRow(2);
      // Both checked in, so both rows exist
      expect(checkinRow2.getCell(3).value).toMatch(/Focus Pod 02 \(FP-02\)|Dedicated Desk 4 \(DD-04\)/);
      expect(checkinRow2.getCell(4).value).toMatch(/FP-02|DD-04/);
    });

    it('formatWorkspaceLabel helper properly composes labels', () => {
      expect(formatWorkspaceLabel('Focus Pod 02', 'FP-02')).toBe('Focus Pod 02 (FP-02)');
      expect(formatWorkspaceLabel('Focus Pod 02 (FP-02)', 'FP-02')).toBe('Focus Pod 02 (FP-02)');
      expect(formatWorkspaceLabel('SPOT-01', 'SPOT-01')).toBe('SPOT-01');
      expect(formatWorkspaceLabel(null, 'DD-05')).toBe('DD-05');
      expect(formatWorkspaceLabel('Desk Only', null)).toBe('Desk Only');
      expect(formatWorkspaceLabel(null, null)).toBe('Workspace Spot');
    });
  });

  describe('Part 4: Architectural Quality Constraints (MS105-TC08)', () => {
    it('MS105-TC08: Zero em-dashes in modified source and test files (BAN-PUNCT-01)', () => {
      const filesToCheck = [
        path.join(rootDir, 'packages/domain/src/services/excelReportBuilder.ts'),
        path.join(rootDir, 'packages/domain/src/services/reportsService.ts'),
        path.join(rootDir, 'packages/domain/src/services/retentionPurgeSupabaseRepository.ts'),
        path.join(rootDir, 'packages/domain/src/services/retentionPurgeMemoryRepository.ts'),
        path.join(rootDir, 'tests/ms105-quarterly-excel-data-accuracy.test.ts'),
      ];

      for (const file of filesToCheck) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toContain('\u2014');
      }
    });
  });
});

