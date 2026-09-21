import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ReservationMemoryRepository,
  ReservationSupabaseRepository,
  InMemoryWorkspaceRepository,
  InMemorySettingsRepository,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
} from '@deskatlas/domain';

describe('MF-176: Missing reschedule_count Column Causes Rescheduling Failure', () => {
  describe('Migration and Schema Verification', () => {
    it('should define reschedule_count column in the migration file', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/010_add_reschedule_count_to_reservations.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');
      expect(content).toContain('ALTER TABLE');
      expect(content).toContain('reservations');
      expect(content).toContain('reschedule_count');
      expect(content).toContain('INTEGER');
      expect(content).toContain('DEFAULT 0');
    });

    it('should include reschedule_count in 001_schema.sql definition', () => {
      const schemaPath = path.resolve(process.cwd(), 'supabase/001_schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf8');
      expect(content).toMatch(/reschedule_count\s+integer\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    });
  });

  describe('Reservation Model and Default Count', () => {
    let repo: ReservationMemoryRepository;
    let workspaceRepo: InMemoryWorkspaceRepository;
    let settingsRepo: InMemorySettingsRepository;
    let now: Date;

    const nowProvider = () => now;

    beforeEach(async () => {
      now = new Date(Date.now() + 1000);
      repo = new ReservationMemoryRepository(nowProvider);
      workspaceRepo = new InMemoryWorkspaceRepository();
      settingsRepo = new InMemorySettingsRepository();

      const floor = await workspaceRepo.createFloor({ name: 'Main Floor' });
      const template = await workspaceRepo.createTemplate({
        name: 'Dedicated Desk',
        capacity: 1,
        rateAmount: 150,
        pricingUnit: 'HOURLY',
      });

      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: template.id,
        instanceCode: 'desk-01',
        displayName: 'Desk 1',
      });
    });

    it('new reservations start with rescheduleCount = 0', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const desk = catalog.instances[0];

      const paymentSessionService = createPaymentSessionService(repo, nowProvider);
      const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);

      const futureDate = new Date(Date.now() + 86400000);
      const startAt = new Date(futureDate.getTime() + 3600000).toISOString();
      const endAt = new Date(futureDate.getTime() + 7200000).toISOString();

      const res = await reservationService.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Jane',
          customerLastName: 'Doe',
          customerEmail: 'jane@example.com',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: desk.id,
              startAt,
              endAt,
            },
          ],
        },
        { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
      );

      const detail = await repo.getAdminReservationDetail(res.id);
      expect(detail?.rescheduleCount).toBe(0);
    });

    it('rescheduling increments rescheduleCount by 1', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const desk = catalog.instances[0];

      const paymentSessionService = createPaymentSessionService(repo, nowProvider);
      const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
      const paymentReviewService = createPaymentReviewService(repo, nowProvider);

      const futureDate = new Date(Date.now() + 86400000);
      const startAt = new Date(futureDate.getTime() + 3600000).toISOString();
      const endAt = new Date(futureDate.getTime() + 7200000).toISOString();

      const res = await reservationService.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Jane',
          customerLastName: 'Doe',
          customerEmail: 'jane@example.com',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: desk.id,
              startAt,
              endAt,
            },
          ],
        },
        { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
      );

      await paymentSessionService.submitPaymentProof({
        token: res.paymentSession!.token,
        paymentMethodId: 'pm-gcash',
        proofStoragePath: `proofs/${res.id}.jpg`,
      });

      await paymentReviewService.reviewPayment({
        paymentAttemptId: res.paymentSession!.paymentAttemptId,
        actor: { userId: 'admin-1', role: 'ADMIN' },
        decision: 'APPROVE',
      });

      const newStartAt = new Date(futureDate.getTime() + 86400000).toISOString();
      const newEndAt = new Date(futureDate.getTime() + 86400000 + 3600000).toISOString();

      const rescheduleResult = await repo.rescheduleReservation({
        reservationId: res.id,
        startAt: newStartAt,
        endAt: newEndAt,
        actorRole: 'ADMIN',
        actorUserId: 'admin-001',
      });

      expect(rescheduleResult.success).toBe(true);
      expect(rescheduleResult.reservation.rescheduleCount).toBe(1);

      const detail = await repo.getAdminReservationDetail(res.id);
      expect(detail?.rescheduleCount).toBe(1);
    });
  });

  describe('ReservationSupabaseRepository resilience', () => {
    it('gracefully handles schema without reschedule_count or missing column without failing', async () => {
      let patchCount = 0;
      let lastPatchBody: any = null;

      const futureStart = new Date(Date.now() + 86400000).toISOString();
      const futureEnd = new Date(Date.now() + 86400000 + 7200000).toISOString();
      const newStart = new Date(Date.now() + 172800000).toISOString();
      const newEnd = new Date(Date.now() + 172800000 + 7200000).toISOString();

      const mockFetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();

        if (urlStr.includes('/operating_hours?')) {
          return new Response(
            JSON.stringify([
              {
                id: 'oh-001',
                day_of_week: 0,
                opens_at: '00:00:00',
                closes_at: '24:00:00',
                is_active: true,
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/schedule_blocks?')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (urlStr.includes('/reservations?select=')) {
          return new Response(
            JSON.stringify([
              {
                id: '550e8400-e29b-41d4-a716-446655440000',
                reference_code: 'DA-20260915-ABCD',
                status: 'CONFIRMED',
                customer_first_name: 'John',
                customer_last_name: 'Smith',
                customer_email: 'john@example.com',
                reschedule_count: 0,
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/reservation_candidates?reservation_id=')) {
          return new Response(
            JSON.stringify([
              {
                id: 'cand-001',
                reservation_id: '550e8400-e29b-41d4-a716-446655440000',
                rank: 0,
                workspace_instance_id: 'inst-001',
                start_at: futureStart,
                end_at: futureEnd,
                is_assigned: true,
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/reservation_candidates?workspace_instance_id=')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (init?.method === 'PATCH' && urlStr.includes('/reservations?id=eq.')) {
          patchCount++;
          lastPatchBody = JSON.parse(init.body as string);
          if (lastPatchBody.reschedule_count !== undefined && patchCount === 1) {
            // Simulate PostgREST PGRST204 error
            return new Response(
              JSON.stringify({
                code: 'PGRST204',
                message: "Could not find the 'reschedule_count' column of 'reservations' in the schema cache",
              }),
              { status: 400 }
            );
          }
          return new Response(JSON.stringify([{ id: '550e8400-e29b-41d4-a716-446655440000' }]), { status: 200 });
        }

        if (init?.method === 'PATCH' && urlStr.includes('/reservation_candidates?id=eq.')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        if (init?.method === 'POST' && urlStr.includes('/audit_logs')) {
          return new Response(JSON.stringify({ id: 'audit-001' }), { status: 201 });
        }

        if (urlStr.includes('/reservations?id=eq.')) {
          return new Response(
            JSON.stringify([
              {
                id: '550e8400-e29b-41d4-a716-446655440000',
                reference_code: 'DA-20260915-ABCD',
                customer_first_name: 'John',
                customer_last_name: 'Smith',
                customer_email: 'john@example.com',
                customer_contact_number: null,
                status: 'CONFIRMED',
                payment_status: 'CONFIRMED',
                notes: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                cancellation_reason: null,
                cancelled_at: null,
                reschedule_count: 0,
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/workspace_instances?id=in.')) {
          return new Response(
            JSON.stringify([
              {
                id: 'inst-001',
                floor_id: 'floor-001',
                template_id: 'tpl-001',
                instance_code: 'desk-01',
                display_name: 'Desk 1',
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/workspace_templates?id=in.')) {
          return new Response(
            JSON.stringify([
              {
                id: 'tpl-001',
                name: 'Dedicated Desk',
                capacity: 1,
                rate_amount: 150,
                pricing_unit: 'HOURLY',
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/floors?id=in.')) {
          return new Response(
            JSON.stringify([
              {
                id: 'floor-001',
                name: 'Main Floor',
              },
            ]),
            { status: 200 }
          );
        }

        if (urlStr.includes('/payment_attempts?reservation_id=')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }

        return new Response(JSON.stringify([]), { status: 200 });
      };

      const supabaseRepo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
        fetcher: mockFetcher as any,
      });

      const result = await supabaseRepo.rescheduleReservation({
        reservationId: '550e8400-e29b-41d4-a716-446655440000',
        startAt: newStart,
        endAt: newEnd,
        actorRole: 'ADMIN',
        actorUserId: 'admin-001',
      });

      expect(result.success).toBe(true);
      expect(patchCount).toBe(2); // First failed with PGRST204, second succeeded with updated_at only
    });
  });
});
