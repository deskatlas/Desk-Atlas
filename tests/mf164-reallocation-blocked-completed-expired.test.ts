import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-164: Reallocation Blocked for Completed, Expired, or Terminal Reservations', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Current simulated time: 2026-09-18 08:00 AM Manila time
    now = new Date('2026-09-18T08:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: 'Ground Floor' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 4; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: deskTemplate.id,
        instanceCode: `desk-${i}`,
        displayName: `Desk ${i}`,
        operationalStatus: 'ACTIVE',
      });
    }

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url, body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(
    refCodeSuffix: string,
    spotCode = 'desk-1',
    startHour = 14,
    duration = 4,
    date = '2026-09-18'
  ) {
    const catalog = await workspaceRepo.listCatalog();
    const instance = catalog.instances.find(
      (i) => i.instanceCode === spotCode || i.id === spotCode
    ) || catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startAt = zonedDateTimeToUtc(
      date,
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      date,
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Alex',
        customerLastName: 'Rivera',
        customerEmail: `alex.${refCodeSuffix}@example.com`,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
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
      proofStoragePath: 'proofs/test.png',
    });

    await paymentReviewService.reviewPayment({
      paymentAttemptId: res.paymentSession!.paymentAttemptId,
      actor: { role: 'ADMIN', userId: 'admin-user-1' },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      'https://deskatlas.test/access'
    );

    return res;
  }

  describe('1. Relocation Rejection on Terminal Statuses', () => {
    it('rejects relocation of a COMPLETED reservation via AdminReservationService and StaffOperationsService', async () => {
      const res = await createConfirmedReservation('completed-reloc', 'desk-1', 10, 2);
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      // Mark reservation as COMPLETED
      await repo.markReservationCompleted(res.id, new Date('2026-09-18T12:00:00+08:00').toISOString());

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Customer Request',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(/relocation not allowed/i);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      await expect(
        staffService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Customer Request',
          actorRole: 'STAFF',
        })
      ).rejects.toThrow(/relocation not allowed/i);
    });

    it('rejects relocation of an EXPIRED reservation', async () => {
      const res = await createConfirmedReservation('expired-reloc', 'desk-1', 10, 2);
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      // Manually set status to EXPIRED in repo
      const rawRes = (repo as any).reservations.find((r: any) => r.id === res.id);
      rawRes.status = 'EXPIRED';

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Maintenance',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(/relocation not allowed/i);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      await expect(
        staffService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Maintenance',
          actorRole: 'STAFF',
        })
      ).rejects.toThrow(/relocation not allowed/i);
    });

    it('rejects relocation of a CANCELLED reservation', async () => {
      const res = await createConfirmedReservation('cancelled-reloc', 'desk-1', 14, 4);
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await adminService.cancelReservation({
        reservationId: res.id,
        reason: 'Customer Cancellation',
      });

      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Operational Move',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(/relocation not allowed/i);
    });
  });

  describe('2. Time-Elapsed / Stale-Status Dynamic Expiration Guard', () => {
    it('blocks relocation when reservation date was yesterday (e.g., booking Sept 19, reallocation Sept 20)', async () => {
      // Reservation booked for Sept 19 (10:00 - 14:00)
      const res = await createConfirmedReservation('yesterday-res', 'desk-1', 10, 4, '2026-09-19');
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      // Reallocation happens on Sept 20 (nowProvider is moved to Sept 20)
      now = new Date('2026-09-20T10:00:00+08:00');

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Moving spot',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow(/relocation not allowed/i);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      await expect(
        staffService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Moving spot',
          actorRole: 'STAFF',
        })
      ).rejects.toThrow(/relocation not allowed/i);
    });
  });

  describe('3. Listing Available Relocation Spots for Inactive Reservations', () => {
    it('returns empty list for COMPLETED reservation', async () => {
      const res = await createConfirmedReservation('avail-completed', 'desk-1', 10, 2);
      await repo.markReservationCompleted(res.id, new Date('2026-09-18T12:00:00+08:00').toISOString());

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const adminSpots = await adminService.listAvailableRelocationSpots(res.id);
      expect(adminSpots).toEqual([]);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const staffSpots = await staffService.listAvailableRelocationSpots(res.id);
      expect(staffSpots).toEqual([]);
    });

    it('returns empty list for EXPIRED or ended reservation', async () => {
      const res = await createConfirmedReservation('avail-expired', 'desk-1', 10, 2, '2026-09-17');
      // Current time is Sept 18 -> booking ended
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const adminSpots = await adminService.listAvailableRelocationSpots(res.id);
      expect(adminSpots).toEqual([]);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const staffSpots = await staffService.listAvailableRelocationSpots(res.id);
      expect(staffSpots).toEqual([]);
    });

    it('returns empty list for CANCELLED reservation', async () => {
      const res = await createConfirmedReservation('avail-cancelled', 'desk-1', 14, 4);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await adminService.cancelReservation({
        reservationId: res.id,
        reason: 'Customer cancelled',
      });

      const adminSpots = await adminService.listAvailableRelocationSpots(res.id);
      expect(adminSpots).toEqual([]);

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const staffSpots = await staffService.listAvailableRelocationSpots(res.id);
      expect(staffSpots).toEqual([]);
    });
  });

  describe('4. Regression: Active CONFIRMED and CHECKED_IN Reservations', () => {
    it('allows relocation of CONFIRMED reservation within valid booking window', async () => {
      const res = await createConfirmedReservation('active-confirmed', 'desk-1', 14, 4, '2026-09-18');
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Spot Maintenance',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(result.newSpotName).toBe('Desk 2');
    });

    it('allows relocation of CHECKED_IN reservation during active session', async () => {
      const res = await createConfirmedReservation('active-checkedin', 'desk-1', 14, 4, '2026-09-18');
      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.instanceCode === 'desk-3')!;

      // Fast forward time to 15:00 (during session) and check in
      now = new Date('2026-09-18T15:00:00+08:00');
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      await staffService.checkInReservation({
        reservationId: res.id,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      const result = await staffService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk3.id,
        reason: 'Power outage at desk 1',
        actorRole: 'STAFF',
        actorUserId: 'staff-1',
      });

      expect(result.success).toBe(true);
      expect(result.newSpotName).toBe('Desk 3');
    });

    it('does NOT create audit logs or dispatch emails for rejected relocation attempts', async () => {
      const res = await createConfirmedReservation('audit-guard-res', 'desk-1', 10, 2);
      await repo.markReservationCompleted(res.id, new Date('2026-09-18T12:00:00+08:00').toISOString());

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      sentEmails = [];
      const auditCountBefore = (repo as any).operationalAuditEvents?.length || 0;

      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Maintenance',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow();

      const auditCountAfter = (repo as any).operationalAuditEvents?.length || 0;
      expect(auditCountAfter).toBe(auditCountBefore);
      expect(sentEmails.length).toBe(0);
    });
  });

  describe('5. ReservationSupabaseRepository Relocation Terminal Guards', () => {
    it('rejects relocation in ReservationSupabaseRepository if reservation is in terminal status', async () => {
      const { ReservationSupabaseRepository } = await import('@deskatlas/domain');
      const supabaseRepo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      (supabaseRepo as any).request = async (endpoint: string) => {
        if (endpoint.includes('/reservations?select=*')) {
          return [{ id: 'res-completed-1', reference_code: 'DA-COMP-1', status: 'COMPLETED' }];
        }
        return [];
      };

      await expect(
        supabaseRepo.relocateReservation({
          reservationId: 'res-completed-1',
          targetWorkspaceInstanceId: 'inst-2',
          reason: 'Maintenance',
        })
      ).rejects.toThrow(/only confirmed or checked-in reservations can be relocated/i);
    });

    it('returns empty list in listAvailableRelocationSpots if reservation is COMPLETED or EXPIRED in Supabase', async () => {
      const { ReservationSupabaseRepository } = await import('@deskatlas/domain');
      const supabaseRepo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      (supabaseRepo as any).request = async (endpoint: string) => {
        if (endpoint.includes('/reservations?select=*')) {
          return [{ id: 'res-expired-1', reference_code: 'DA-EXP-1', status: 'EXPIRED' }];
        }
        return [];
      };

      const spots = await supabaseRepo.listAvailableRelocationSpots({
        reservationId: 'res-expired-1',
      });
      expect(spots).toEqual([]);
    });
  });
});

