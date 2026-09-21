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

describe('MF-159: SuperAdmin and Admin Time Extension Availability and Execution', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-21T08:00:00+08:00');
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
    // Monday = day 1
    repo.seedOperatingHours(1, [{ opensAt: '06:00', closesAt: '22:00', isActive: true }]);

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
      '2026-09-21',
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      '2026-09-21',
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Alex',
        customerLastName: 'Morgan',
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

  describe('Extension Availability for SuperAdmin and Admin', () => {
    it('allows SuperAdmin to check extension availability', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('superadmin-avail-1', 'desk-1', 14, 2); // 2pm - 4pm

      const avail = await adminService.checkExtendAvailability({
        reservationId: res.id,
        extensionMinutes: 60,
      });

      expect(avail.canExtend).toBe(true);
      expect(avail.maxExtensionMinutes).toBeGreaterThanOrEqual(60);
      expect(avail.hourlyRate).toBe(150);
      expect(avail.additionalFee).toBe(150);
    });

    it('allows Admin to check extension availability', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('admin-avail-1', 'desk-2', 14, 2); // 2pm - 4pm

      const avail = await adminService.checkExtendAvailability({
        reservationId: res.id,
        extensionMinutes: 120,
      });

      expect(avail.canExtend).toBe(true);
      expect(avail.maxExtensionMinutes).toBeGreaterThanOrEqual(120);
      expect(avail.hourlyRate).toBe(150);
      expect(avail.additionalFee).toBe(300);
    });
  });

  describe('Time Extension Execution by SuperAdmin, Admin, and Staff', () => {
    it('allows SuperAdmin actor to extend a CONFIRMED reservation', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('superadmin-ext-1', 'desk-1', 14, 2); // 2pm - 4pm

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
      expect(extResult.reservation.reservationStatus).toBe('CONFIRMED');

      // Check confirmation email
      expect(sentEmails.some((e) => e.body.subject.includes('Extended'))).toBe(true);

      // Check audit events
      const audit = (repo as any).operationalAuditEvents;
      const lastAudit = audit[audit.length - 1];
      expect(lastAudit.actorRole).toBe('SUPERADMIN');
      expect(lastAudit.actorUserId).toBe('superadmin-user-1');
    });

    it('allows Admin actor to extend a CHECKED_IN reservation', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('admin-ext-1', 'desk-2', 14, 2); // 2pm - 4pm

      // Advance time to 2:05 PM and check in
      now = new Date('2026-09-21T14:05:00+08:00');
      await staffService.checkInReservation({
        reservationId: res.id,
        actor: {
          role: 'STAFF',
          userId: 'staff-user-1',
        },
      });

      // Admin extends time by 120 mins
      const extResult = await adminService.extendReservation({
        reservationId: res.id,
        extensionMinutes: 120,
        additionalFee: 300,
        paymentMethod: 'COUNTER_QR',
        actorUserId: 'admin-user-2',
        actorRole: 'ADMIN',
      });

      expect(extResult.success).toBe(true);
      expect(extResult.addedDurationMinutes).toBe(120);

      // Check audit
      const audit = (repo as any).operationalAuditEvents;
      const lastAudit = audit[audit.length - 1];
      expect(lastAudit.actorRole).toBe('ADMIN');
      expect(lastAudit.actorUserId).toBe('admin-user-2');
    });

    it('blocks extension for cancelled or expired reservations', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('cancel-ext-1', 'desk-3', 14, 2);

      // Admin cancels reservation
      await adminService.cancelReservation({
        reservationId: res.id,
        reason: 'Customer Request',
      });

      const avail = await adminService.checkExtendAvailability({
        reservationId: res.id,
        extensionMinutes: 60,
      });
      expect(avail.canExtend).toBe(false);
      expect(avail.reason?.toLowerCase()).toContain('cancelled');

      await expect(
        adminService.extendReservation({
          reservationId: res.id,
          extensionMinutes: 60,
          actorRole: 'SUPERADMIN',
        })
      ).rejects.toThrow();
    });

    it('rejects invalid or unauthorized actor roles', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('unauth-ext-1', 'desk-4', 14, 2);

      await expect(
        adminService.extendReservation({
          reservationId: res.id,
          extensionMinutes: 60,
          actorRole: 'UNAUTHORIZED_ROLE' as any,
        })
      ).rejects.toThrow(/not authorized/i);
    });

    it('regression: Staff actor extension still succeeds seamlessly (MF-127 / MF-136)', async () => {
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const res = await createConfirmedReservation('staff-regress-1', 'desk-1', 14, 2);

      const extResult = await staffService.extendReservation({
        reservationId: res.id,
        extensionMinutes: 60,
        additionalFee: 150,
        paymentMethod: 'CASH',
        actorUserId: 'staff-user-99',
        actorRole: 'STAFF',
      });

      expect(extResult.success).toBe(true);
      expect(extResult.addedDurationMinutes).toBe(60);
    });
  });
});
