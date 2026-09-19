import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  InMemorySettingsRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createGuestReservationTrackingService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
} from '@deskatlas/domain';

describe('MF-140: In-Session Active Reservation Reallocation for Remaining Time', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let settingsRepo: InMemorySettingsRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    // Current time: 2026-09-15 02:00 PM Manila time
    now = new Date('2026-09-15T14:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    settingsRepo = new InMemorySettingsRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: 'Floor 1' });
    const template = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 100,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 5; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: template.id,
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

  async function createConfirmedReservation(params: {
    referenceCodeSuffix: string;
    deskNumber: number;
    startIso: string;
    endIso: string;
    customerEmail?: string;
  }) {
    const catalog = await workspaceRepo.listCatalog();
    const instance = catalog.instances[params.deskNumber - 1];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Jordan',
        customerLastName: 'Rivera',
        customerEmail: params.customerEmail || `jordan.${params.referenceCodeSuffix}@example.com`,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: params.startIso,
            endAt: params.endIso,
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

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(res.id, res.referenceCode, 'https://deskatlas.test/access');

    const detail = await repo.getAdminReservationDetail(res.id);
    return { res: detail!, instance };
  }

  describe('1. In-Session Detection & Guest Reservation Tracking', () => {
    it('detects active in-session booking and exposes canRelocate with remainingMinutes', async () => {
      // Booking from 1:00 PM to 4:00 PM (starts at 13:00, ends at 16:00). Current time is 14:00 (2:00 PM).
      const { res } = await createConfirmedReservation({
        referenceCodeSuffix: 'in-sess-01',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({
        referenceCode: res.referenceCode,
      });

      expect(tracking.isInSession).toBe(true);
      expect(tracking.canRelocate).toBe(true);
      // 2 hours remaining = 120 minutes
      expect(tracking.remainingMinutes).toBe(120);
    });

    it('returns isInSession false and canRelocate false for future upcoming booking', async () => {
      // Booking from 3:00 PM to 6:00 PM. Current time is 2:00 PM.
      const { res } = await createConfirmedReservation({
        referenceCodeSuffix: 'upcoming-01',
        deskNumber: 1,
        startIso: '2026-09-15T15:00:00+08:00',
        endIso: '2026-09-15T18:00:00+08:00',
      });

      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({
        referenceCode: res.referenceCode,
      });

      expect(tracking.isInSession).toBe(false);
      expect(tracking.canRelocate).toBe(false);
      expect(tracking.remainingMinutes).toBe(0);
    });

    it('returns isInSession false and canRelocate false for already elapsed booking', async () => {
      // Booking from 10:00 AM to 1:00 PM. Current time is 2:00 PM.
      const { res } = await createConfirmedReservation({
        referenceCodeSuffix: 'past-01',
        deskNumber: 1,
        startIso: '2026-09-15T10:00:00+08:00',
        endIso: '2026-09-15T13:00:00+08:00',
      });

      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({
        referenceCode: res.referenceCode,
      });

      expect(tracking.isInSession).toBe(false);
      expect(tracking.canRelocate).toBe(false);
      expect(tracking.remainingMinutes).toBe(0);
    });
  });

  describe('2. Dynamic Remaining Window Evaluation for Spot Availability', () => {
    it('recognizes candidate spot as available if its earlier booking has already ended before current time', async () => {
      // Booking A (Customer needing move): 1:00 PM to 4:00 PM on Desk 1.
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'move-req-1',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      // Desk 2 had an earlier booking from 12:00 PM to 1:30 PM (ended before now: 2:00 PM).
      await createConfirmedReservation({
        referenceCodeSuffix: 'earlier-desk2',
        deskNumber: 2,
        startIso: '2026-09-15T12:00:00+08:00',
        endIso: '2026-09-15T13:30:00+08:00',
      });

      // Desk 3 has a conflicting future booking from 3:00 PM to 5:00 PM (overlaps with 2:00 PM - 4:00 PM).
      await createConfirmedReservation({
        referenceCodeSuffix: 'future-desk3',
        deskNumber: 3,
        startIso: '2026-09-15T15:00:00+08:00',
        endIso: '2026-09-15T17:00:00+08:00',
      });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const spots = await adminService.listAvailableRelocationSpots(resA.id);

      // Desk 2 MUST be available because its booking ended at 1:30 PM and customer's remaining window is 2:00 PM - 4:00 PM
      const desk2Spot = spots.find((s) => s.displayName === 'Desk 2');
      expect(desk2Spot).toBeDefined();
      expect(desk2Spot?.isAvailable).toBe(true);

      // Desk 3 MUST NOT be available because it is booked from 3:00 PM onwards
      const desk3Spot = spots.find((s) => s.displayName === 'Desk 3');
      expect(desk3Spot).toBeUndefined();

      // Desk 4 and Desk 5 are completely free
      expect(spots.some((s) => s.displayName === 'Desk 4')).toBe(true);
      expect(spots.some((s) => s.displayName === 'Desk 5')).toBe(true);
    });

    it('blocks spots that have active bookings during the in-session remaining window', async () => {
      // Booking A: 1:00 PM to 4:00 PM on Desk 1.
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'move-req-2',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      // Desk 2 is booked from 1:30 PM to 2:30 PM (overlaps current time 2:00 PM).
      await createConfirmedReservation({
        referenceCodeSuffix: 'overlap-desk2',
        deskNumber: 2,
        startIso: '2026-09-15T13:30:00+08:00',
        endIso: '2026-09-15T14:30:00+08:00',
      });

      const spots = await repo.listAvailableRelocationSpots({ reservationId: resA.id });
      const desk2Spot = spots.find((s) => s.displayName === 'Desk 2');
      expect(desk2Spot).toBeUndefined();
    });
  });

  describe('3. In-Session Relocation Execution & Role Parity', () => {
    it('successfully relocates customer in-session to Desk 2 (which had an ended earlier booking)', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'exec-reloc-1',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      // Desk 2 had an earlier booking from 12:00 PM to 1:30 PM
      await createConfirmedReservation({
        referenceCodeSuffix: 'past-desk2',
        deskNumber: 2,
        startIso: '2026-09-15T12:00:00+08:00',
        endIso: '2026-09-15T13:30:00+08:00',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 2')!;

      // Customer self-service execution
      const result = await repo.relocateReservation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Power outlet issue',
        notes: 'Socket spark, unable to charge laptop',
        actorRole: 'CUSTOMER',
      });

      expect(result.success).toBe(true);
      expect(result.newWorkspaceDisplayName).toBe('Desk 2');
      expect(result.previousSpotName).toBe('Desk 1');

      // Timeline entry verification
      const detail = await repo.getAdminReservationDetail(resA.id);
      expect(detail).not.toBeNull();
      expect(
        detail!.timeline.some(
          (t) =>
            t.includes('In-session spot relocated from Desk 1 to Desk 2 by Customer for remaining time (2h remaining)') &&
            t.includes('Power outlet issue')
        )
      ).toBe(true);
    });

    it('rejects in-session relocation if target spot has an overlapping booking during remaining time', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'exec-reloc-conflict',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      // Desk 2 has a booking from 3:00 PM to 5:00 PM
      await createConfirmedReservation({
        referenceCodeSuffix: 'conf-desk2',
        deskNumber: 2,
        startIso: '2026-09-15T15:00:00+08:00',
        endIso: '2026-09-15T17:00:00+08:00',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 2')!;

      await expect(
        repo.relocateReservation({
          reservationId: resA.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Desk/Chair defect',
          actorRole: 'STAFF',
        })
      ).rejects.toThrow('Target workspace spot is already booked for this time window');
    });

    it('supports StaffOperationsService with actorRole STAFF and sends relocation email', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'staff-reloc',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
        customerEmail: 'alex.staff-op@example.com',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.displayName === 'Desk 4')!;

      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const result = await staffService.relocateReservation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk4.id,
        reason: 'Noise / Disturbance',
        notes: 'Near AC blower vibration',
        actorRole: 'STAFF',
        actorUserId: 'staff-user-42',
      });

      expect(result.success).toBe(true);
      expect(result.newSpotName).toBe('Desk 4');

      // Check email dispatch
      expect(sentEmails.length).toBe(1);
      const email = sentEmails[0];
      expect(email.body.to).toContain('alex.staff-op@example.com');
      expect(email.body.subject).toContain(`Relocated [${resA.referenceCode}]`);
      expect(email.body.html).toContain('Desk 4');
      expect(email.body.html).toContain('Noise / Disturbance');
      expect(email.body.html).toContain('Your existing digital QR pass remains active and valid for your newly relocated spot.');

      // Check timeline
      const detail = await repo.getAdminReservationDetail(resA.id);
      expect(
        detail!.timeline.some(
          (t) =>
            t.includes(`In-session spot relocated from Desk 1 to Desk 4 by Staff for remaining time (2h remaining)`) &&
            t.includes('Noise / Disturbance')
        )
      ).toBe(true);
    });

    it('supports AdminReservationService with actorRole SUPERADMIN', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'superadmin-reloc',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
        customerEmail: 'super.user@example.com',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk5 = catalog.instances.find((i) => i.displayName === 'Desk 5')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.relocateReservation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk5.id,
        reason: 'Spot Maintenance / Repairs',
        actorRole: 'SUPERADMIN',
        actorUserId: 'super-admin-01',
      });

      expect(result.success).toBe(true);
      expect(result.newSpotName).toBe('Desk 5');

      const detail = await adminService.getReservationDetail(resA.id);
      expect(
        detail!.timeline.some(
          (t) =>
            t.includes(`In-session spot relocated from Desk 1 to Desk 5 by Super Admin for remaining time (2h remaining)`)
        )
      ).toBe(true);
    });
  });

  describe('4. Digital Pass QR Continuity & Instant Re-verification', () => {
    it('preserves existing digital access QR pass and seamlessly reflects new spot on scan', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'qr-continuity',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
      });

      const accessService = createBookingAccessService(repo, nowProvider);

      // Scan pass before relocation -> Desk 1
      const initialScan = await accessService.getBookingAccess(resA.referenceCode);
      expect(initialScan.accessState).toBe('ACTIVE');
      expect(initialScan.workspaceInstanceId).toBe(resA.assignedCandidate?.workspaceInstanceId);

      // In-session move to Desk 4
      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.displayName === 'Desk 4')!;
      await repo.relocateReservation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk4.id,
        reason: 'Wi-Fi / Connectivity issue',
        actorRole: 'CUSTOMER',
      });

      // Scan pass with same original reference code -> immediately reflects Desk 4, still ACTIVE
      const reScan = await accessService.getBookingAccess(resA.referenceCode);
      expect(reScan.accessState).toBe('ACTIVE');
      expect(reScan.workspaceDisplayName).toBe('Desk 4');
      expect(reScan.workspaceInstanceId).toBe(desk4.id);
    });
  });

  describe('5. Customer Relocation Request & Operator Approval / Decline Workflow', () => {
    it('customer requests relocation, spot remains unchanged while pending, and tracking reflects pending request', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'req-pending',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
        customerEmail: 'alex.request@example.com',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.displayName === 'Desk 3')!;

      // Customer requests relocation to Desk 3
      const pendingReq = await repo.requestCustomerRelocation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk3.id,
        reason: 'Noise / Disturbance',
        notes: 'Loud conversation nearby',
      });

      expect(pendingReq.status).toBe('PENDING');
      expect(pendingReq.targetWorkspaceDisplayName).toBe('Desk 3');
      expect(pendingReq.reason).toBe('Noise / Disturbance');

      // Invariant: Customer assignment is NOT changed yet (No-Hold Rule)
      const trackingService = createGuestReservationTrackingService(repo, settingsRepo, nowProvider);
      const tracking = await trackingService.getReservationTracking({
        referenceCode: resA.referenceCode,
      });
      expect(tracking.finalAssignment?.workspaceInstanceId).toBe(resA.assignedCandidate?.workspaceInstanceId);
      expect(tracking.pendingRelocationRequest).not.toBeNull();
      expect(tracking.pendingRelocationRequest?.status).toBe('PENDING');
      expect(tracking.pendingRelocationRequest?.targetWorkspaceDisplayName).toBe('Desk 3');

      // Operator reservation detail also sees pending request and timeline
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const adminDetail = await adminService.getReservationDetail(resA.id);
      expect(adminDetail?.pendingRelocationRequest?.status).toBe('PENDING');
      expect(
        adminDetail?.timeline.some((t) =>
          t.includes('Customer requested spot relocation to Desk 3') && t.includes('Noise / Disturbance')
        )
      ).toBe(true);
    });

    it('operator approves customer relocation request, moves spot, sends email, and updates timeline', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'req-approve',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
        customerEmail: 'clara.approved@example.com',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 2')!;

      // Customer requests relocation
      await repo.requestCustomerRelocation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Power outlet issue',
      });

      // Staff decides: APPROVE
      const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
      const result = await staffService.decideCustomerRelocation({
        reservationId: resA.id,
        decision: 'APPROVE',
        actorRole: 'STAFF',
        actorUserId: 'staff-on-duty',
        notes: 'Relocation verified and approved',
      });

      expect(result.success).toBe(true);
      expect(result.decision).toBe('APPROVE');
      expect(result.reservation.assignedCandidate?.workspaceDisplayName).toBe('Desk 2');

      // Relocation email dispatched
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].body.subject).toContain('Your DeskAtlas Reservation Spot Has Been Relocated');
      expect(sentEmails[0].body.to).toContain('clara.approved@example.com');

      // Pending request is cleared
      const updatedDetail = await staffService.getOperationalReservation(resA.id);
      expect(updatedDetail?.pendingRelocationRequest).toBeNull();
      expect(updatedDetail?.workspaceDisplayName).toBe('Desk 2');
    });

    it('operator declines customer relocation request with reason, spot remains at original desk', async () => {
      const { res: resA } = await createConfirmedReservation({
        referenceCodeSuffix: 'req-decline',
        deskNumber: 1,
        startIso: '2026-09-15T13:00:00+08:00',
        endIso: '2026-09-15T16:00:00+08:00',
        customerEmail: 'dave.declined@example.com',
      });

      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.displayName === 'Desk 4')!;

      // Customer requests relocation
      await repo.requestCustomerRelocation({
        reservationId: resA.id,
        targetWorkspaceInstanceId: desk4.id,
        reason: 'Desk / Chair defect',
      });

      // Admin decides: DECLINE
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const result = await adminService.decideCustomerRelocation({
        reservationId: resA.id,
        decision: 'DECLINE',
        actorRole: 'ADMIN',
        actorUserId: 'admin-01',
        notes: 'Target desk is reserved for an incoming group booking',
      });

      expect(result.success).toBe(true);
      expect(result.decision).toBe('DECLINE');

      // Original spot remains unchanged
      expect(result.reservation.assignedCandidate?.workspaceInstanceId).toBe(resA.assignedCandidate?.workspaceInstanceId);

      // No relocation email dispatched
      expect(sentEmails.length).toBe(0);

      // Pending request is cleared
      expect(result.reservation.pendingRelocationRequest).toBeNull();

      // Timeline contains decline reason
      expect(
        result.reservation.timeline.some((t) =>
          t.includes('Customer spot relocation request declined by Admin') &&
          t.includes('Target desk is reserved for an incoming group booking')
        )
      ).toBe(true);
    });
  });
});
