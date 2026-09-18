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

describe('MF-136: Multi-Role Reallocation and Time Extension for Superadmin, Admin, and Staff', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-18T08:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: 'Ground Floor' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Hot Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });

    // Create 4 Dedicated Desk instances
    for (let i = 1; i <= 4; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: deskTemplate.id,
        instanceCode: `desk-${i}`,
        displayName: `Desk 0${i}`,
        operationalStatus: 'ACTIVE',
      });
    }

    // Default operating hours: 06:00 to 22:00 (10:00 PM) Manila time
    // Friday = day 5
    repo.seedOperatingHours(5, [{ opensAt: '06:00', closesAt: '22:00', isActive: true }]);

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
    duration = 4
  ) {
    const catalog = await workspaceRepo.listCatalog();
    const instance = catalog.instances.find(
      (i) => i.instanceCode === spotCode || i.id === spotCode
    ) || catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startAt = zonedDateTimeToUtc(
      '2026-09-18',
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      '2026-09-18',
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Jordan',
        customerLastName: 'Lee',
        customerEmail: `jordan.${refCodeSuffix}@example.com`,
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
      actor: { role: 'ADMIN', userId: 'admin-1' },
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

  describe('Reallocation (Relocation) by Staff, Admin, and Superadmin', () => {
    it('allows Staff to list available relocation spots and reallocate a reservation', async () => {
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const catalog = await workspaceRepo.listCatalog();
      const desk1 = catalog.instances.find((i) => i.instanceCode === 'desk-1')!;
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;
      const desk3 = catalog.instances.find((i) => i.instanceCode === 'desk-3')!;

      // Res 1 on Desk 1 (2pm - 6pm)
      const res1 = await createConfirmedReservation('staff-reloc-1', 'desk-1', 14, 4);

      // Sibling spots should be available
      const spots = await staffService.listAvailableRelocationSpots(res1.id);
      expect(spots.length).toBeGreaterThan(0);
      expect(spots.some((s) => s.id === desk1.id)).toBe(false); // Excludes current spot
      expect(spots.some((s) => s.id === desk2.id)).toBe(true);
      expect(spots.some((s) => s.id === desk3.id)).toBe(true);

      // Staff reallocates to Desk 2
      const relocResult = await staffService.relocateReservation({
        reservationId: res1.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Spot Maintenance / Repairs',
        notes: 'Socket spark issue at Desk 01',
        actorUserId: 'staff-user-42',
        actorRole: 'STAFF',
      });

      expect(relocResult.success).toBe(true);
      expect(relocResult.reservation.assignedCandidate?.workspaceInstanceId).toBe(desk2.id);

      // Verify email was sent to customer
      expect(sentEmails.length).toBe(1);
      expect(Array.isArray(sentEmails[0].body.to) ? sentEmails[0].body.to : [sentEmails[0].body.to]).toContain('jordan.staff-reloc-1@example.com');
      expect(sentEmails[0].body.subject).toContain('Relocated');

      // Verify timeline reflects staff action
      const timeline = relocResult.reservation.timeline;
      expect(timeline.some((t: string) => t.includes('Relocated by Staff') || t.includes('Relocated'))).toBe(true);
    });

    it('allows Admin to reallocate with actorRole = ADMIN', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.instanceCode === 'desk-3')!;

      const res = await createConfirmedReservation('admin-reloc-1', 'desk-1', 14, 4);

      const relocResult = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk3.id,
        reason: 'Spot Inactive / Out of Order',
        notes: 'AC leaking overhead',
        actorUserId: 'admin-user-7',
        actorRole: 'ADMIN',
      });

      expect(relocResult.success).toBe(true);
      expect(relocResult.reservation.assignedCandidate?.workspaceInstanceId).toBe(desk3.id);
    });

    it('allows Superadmin to reallocate with actorRole = SUPERADMIN', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.instanceCode === 'desk-4')!;

      const res = await createConfirmedReservation('superadmin-reloc-1', 'desk-1', 14, 4);

      const relocResult = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk4.id,
        reason: 'Customer Request / Operational Adjustment',
        notes: 'VIP customer requested window seat',
        actorUserId: 'superadmin-user-1',
        actorRole: 'SUPERADMIN',
      });

      expect(relocResult.success).toBe(true);
      expect(relocResult.reservation.assignedCandidate?.workspaceInstanceId).toBe(desk4.id);
    });
  });

  describe('Time Extension (Add Time) by Staff, Admin, and Superadmin', () => {
    it('allows Staff to check availability and extend reservation time', async () => {
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('staff-ext-1', 'desk-1', 14, 2); // 2:00 PM - 4:00 PM

      // Check availability for 60 min extension
      const avail = await staffService.checkExtendAvailability({
        reservationId: res.id,
        extensionMinutes: 60,
      });
      expect(avail.canExtend).toBe(true);
      expect(avail.maxExtensionMinutes).toBeGreaterThanOrEqual(60);

      // Extend by 60 mins
      const extResult = await staffService.extendReservation({
        reservationId: res.id,
        extensionMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'CASH',
        actorUserId: 'staff-user-1',
        actorRole: 'STAFF',
      });

      expect(extResult.success).toBe(true);
      expect(extResult.addedDurationMinutes).toBe(60);
      expect(sentEmails.some((e) => e.body.subject.includes('Extended'))).toBe(true);
    });

    it('allows Admin to extend reservation time', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('admin-ext-1', 'desk-2', 14, 2);

      const extResult = await adminService.extendReservation({
        reservationId: res.id,
        extensionMinutes: 120,
        additionalFee: 300,
        paymentMethod: 'COUNTER_QR',
        actorUserId: 'admin-user-1',
        actorRole: 'ADMIN',
      });

      expect(extResult.success).toBe(true);
      expect(extResult.addedDurationMinutes).toBe(120);
    });

    it('allows Superadmin to extend reservation time with actorRole = SUPERADMIN', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('superadmin-ext-1', 'desk-3', 14, 2);

      const extResult = await adminService.extendReservation({
        reservationId: res.id,
        extensionMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'CASH',
        actorUserId: 'superadmin-user-1',
        actorRole: 'SUPERADMIN',
      });

      expect(extResult.success).toBe(true);
      expect(extResult.addedDurationMinutes).toBe(60);
    });

    it('strictly prevents extension when future overlapping reservation exists on the same spot', async () => {
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);

      // Booking 1 on Desk 1: 2:00 PM - 4:00 PM
      const res1 = await createConfirmedReservation('overlap-res-1', 'desk-1', 14, 2);
      // Booking 2 on Desk 1: 4:30 PM - 6:30 PM (starts at 16:30)
      const res2 = await createConfirmedReservation('overlap-res-2', 'desk-1', 16, 2);

      // Attempt to extend Booking 1 by 60 mins (would end at 5:00 PM / 17:00 -> collides with Booking 2)
      const avail = await staffService.checkExtendAvailability({
        reservationId: res1.id,
        extensionMinutes: 60,
      });
      expect(avail.canExtend).toBe(false);
      expect(avail.reason).toContain('reserved');

      // Attempting to execute extension should throw error
      await expect(
        staffService.extendReservation({
          reservationId: res1.id,
          extensionMinutes: 60,
          actorRole: 'STAFF',
        })
      ).rejects.toThrow();
    });
  });
});
