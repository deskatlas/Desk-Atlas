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
  renderReservationRelocatedEmail,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-137: Reservation Relocation Transaction Confirmation Email', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-18T06:00:00.000Z'); // 2:00 PM Manila
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: '2nd Floor Coworking' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Hot Desk',
      capacity: 1,
      rateAmount: 180,
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

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url, body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(options: {
    refCodeSuffix: string;
    spotIndexOrId?: number | string;
    startHour?: number;
    duration?: number;
    checkIn?: boolean;
    customerEmail?: string;
  }) {
    const catalog = await workspaceRepo.listCatalog();
    const instance =
      typeof options.spotIndexOrId === 'number'
        ? catalog.instances[options.spotIndexOrId - 1]
        : catalog.instances.find((i) => i.id === options.spotIndexOrId) ||
          catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startHour = options.startHour ?? 14; // 2:00 PM Manila
    const duration = options.duration ?? 4;

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
        customerFirstName: 'Samantha',
        customerLastName: 'Cruz',
        customerEmail: options.customerEmail !== undefined ? options.customerEmail : `samantha.${options.refCodeSuffix}@example.com`,
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
      actor: {
        userId: 'admin-1',
        role: 'ADMIN',
      },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      'https://deskatlas.test/access'
    );

    if (options.checkIn) {
      now = new Date(startAt);
      const staffService = createStaffOperationsService(repo, nowProvider);
      await staffService.checkInReservation({
        reservationId: res.id,
        actor: {
          userId: 'staff-1',
          role: 'STAFF',
        },
      });
    }

    const confirmed = await repo.getAdminReservationDetail(res.id);
    return confirmed!;
  }

  describe('renderReservationRelocatedEmail', () => {
    it('renders a complete transaction email with transaction summary, 12-hr AM/PM schedule, new spot, old spot, and QR pass reuse reassurance', () => {
      const rendered = renderReservationRelocatedEmail({
        to: 'customer@example.com',
        customerFirstName: 'Samantha',
        customerLastName: 'Cruz',
        referenceCode: 'DA-RELOC-1370',
        oldWorkspaceDisplayName: 'Desk 01',
        newWorkspaceDisplayName: 'Desk 03',
        floorName: '2nd Floor Coworking',
        workspaceTemplateName: 'Dedicated Hot Desk',
        schedule: 'Sep 18, 2026, 14:00 - 18:00',
        duration: '4 hours',
        relocationReason: 'Spot Maintenance / Electrical Repairs',
        relocationNotes: 'Power outlet unit damaged at previous desk',
        bookingAccessUrl: 'https://deskatlas.test/booking/tok-reloc-1370',
        trackingUrl: 'https://deskatlas.test/track?code=DA-RELOC-1370',
      });

      // Subject
      expect(rendered.subject).toBe('Your DeskAtlas Reservation Spot Has Been Relocated [DA-RELOC-1370]');

      // HTML details
      expect(rendered.html).toContain('Samantha Cruz');
      expect(rendered.html).toContain('DA-RELOC-1370');
      expect(rendered.html).toContain('Desk 03');
      expect(rendered.html).toContain('Desk 01');
      expect(rendered.html).toContain('Dedicated Hot Desk');
      expect(rendered.html).toContain('2nd Floor Coworking');
      expect(rendered.html).toContain('2:00 PM - 6:00 PM');
      expect(rendered.html).toContain('4 hours');
      expect(rendered.html).toContain('Relocation Transaction Summary');
      expect(rendered.html).toContain('Spot Relocation');
      expect(rendered.html).toContain('Spot Maintenance / Electrical Repairs - Power outlet unit damaged at previous desk');
      expect(rendered.html).toContain('Digital Access QR Pass');
      expect(rendered.html).toContain('Your existing digital QR pass remains active and valid for your newly relocated spot.');
      expect(rendered.html).toContain('View Reservation & Digital Pass');
      expect(rendered.html).toContain('https://deskatlas.test/track?code=DA-RELOC-1370');

      // Plaintext fallback
      expect(rendered.text).toContain('DA-RELOC-1370');
      expect(rendered.text).toContain('Desk 03');
      expect(rendered.text).toContain('Desk 01');
      expect(rendered.text).toContain('Transaction: Spot Relocation');
      expect(rendered.text).toContain('Your existing digital QR pass remains active and valid');
      expect(rendered.text).toContain('https://deskatlas.test/track?code=DA-RELOC-1370');
    });

    it('falls back gracefully when customer name, floor, or notes are omitted', () => {
      const rendered = renderReservationRelocatedEmail({
        to: 'guest@example.com',
        referenceCode: 'DA-GUEST-1370',
        oldWorkspaceDisplayName: 'Desk 01',
        newWorkspaceDisplayName: 'Desk 02',
        schedule: 'Sep 18, 2026, 09:00 - 12:00',
        relocationReason: 'Facility Issue',
      });

      expect(rendered.html).toContain('Hello Customer,');
      expect(rendered.html).toContain('Desk 02');
      expect(rendered.html).toContain('Desk 01');
      expect(rendered.html).toContain('9:00 AM - 12:00 PM');
      expect(rendered.html).toContain('Facility Issue');
      expect(rendered.text).toContain('Hello Customer,');
    });
  });

  describe('AdminReservationService.relocateReservation Transaction Email Dispatch', () => {
    it('automatically dispatches transactional email when Admin relocates a confirmed reservation', async () => {
      const res = await createConfirmedReservation({
        refCodeSuffix: 'admin-reloc',
        spotIndexOrId: 1, // Desk 01
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 02')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Spot Inactive / Out of Order',
        notes: 'Air conditioner dripping directly above Desk 01',
        actorRole: 'ADMIN',
        actorUserId: 'admin-user-1',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(1);

      const sent = sentEmails[0].body;
      expect(sent.to).toContain(res.customerEmail);
      expect(sent.subject).toContain(res.referenceCode);
      expect(sent.html).toContain('Desk 02');
      expect(sent.html).toContain('Desk 01');
      expect(sent.html).toContain('Air conditioner dripping directly above Desk 01');
      expect(sent.html).toContain('Relocation Transaction Summary');
      expect(sent.html).toContain('Digital Access QR Pass');
    });

    it('dispatches transactional email when Super Admin relocates a reservation', async () => {
      const res = await createConfirmedReservation({
        refCodeSuffix: 'superadmin-reloc',
        spotIndexOrId: 1, // Desk 01
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.displayName === 'Desk 03')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk3.id,
        reason: 'Operational Adjustment',
        actorRole: 'SUPER_ADMIN',
        actorUserId: 'superadmin-1',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].body.html).toContain('Desk 03');
    });

    it('does not crash if reservation has no customer email', async () => {
      const res = await createConfirmedReservation({
        refCodeSuffix: 'no-email',
        spotIndexOrId: 1,
      });

      // Clear the customer email on the saved record
      const rawRes = (repo as any).reservations.find((r: any) => r.id === res.id);
      if (rawRes) rawRes.customerEmail = '';

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 02')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Maintenance',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(0);
    });

    it('does not fail relocation if email dispatch throws an error', async () => {
      const errorEmailService = new TransactionalEmailService({
        apiKey: 'test-key',
        fetcher: async () => {
          throw new Error('Resend network timeout error');
        },
      });

      const res = await createConfirmedReservation({
        refCodeSuffix: 'err-email',
        spotIndexOrId: 1,
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 02')!;

      const adminService = createAdminReservationService(repo, nowProvider, errorEmailService);
      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Maintenance',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(result.newWorkspaceDisplayName).toBe('Desk 02');
    });
  });

  describe('StaffOperationsService.relocateReservation Transaction Email Dispatch', () => {
    it('automatically dispatches transactional email when Staff relocates a checked-in customer', async () => {
      const res = await createConfirmedReservation({
        refCodeSuffix: 'staff-reloc',
        spotIndexOrId: 1, // Desk 01
        checkIn: true,
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.displayName === 'Desk 04')!;

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const result = await staffService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk4.id,
        reason: 'Sudden Spot Maintenance',
        notes: 'Customer chair wheel broken at Desk 01',
        actorRole: 'STAFF',
        actorUserId: 'staff-user-1',
      });

      expect(result.success).toBe(true);
      expect(sentEmails.length).toBe(1);

      const sent = sentEmails[0].body;
      expect(sent.to).toContain(res.customerEmail);
      expect(sent.subject).toContain(res.referenceCode);
      expect(sent.html).toContain('Desk 04');
      expect(sent.html).toContain('Desk 01');
      expect(sent.html).toContain('Customer chair wheel broken at Desk 01');
      expect(sent.html).toContain('Relocation Transaction Summary');
      expect(sent.html).toContain('Your existing digital QR pass remains active and valid for your newly relocated spot.');
    });
  });
});
