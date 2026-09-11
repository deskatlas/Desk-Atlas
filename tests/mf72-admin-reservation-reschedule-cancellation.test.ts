import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  renderReservationCancelledEmail,
  renderReservationRescheduledEmail,
  AdminReservationDetail,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MF-72: Admin Reservation Reschedule and Cancellation Workflow', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-15T08:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();

    const floor = await workspaceRepo.createFloor({ name: 'Main Floor' });
    const template = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 5; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: template.id,
        instanceCode: `spot-${i}`,
        displayName: `Spot ${i}`,
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

  async function createConfirmedReservation(refCodeSuffix: string, spotIndexOrId: string | number = 1, startHour = 9, duration = 2) {
    const catalog = await workspaceRepo.listCatalog();
    let instance = typeof spotIndexOrId === 'number'
      ? catalog.instances[spotIndexOrId - 1]
      : catalog.instances.find((i) => i.id === spotIndexOrId || i.instanceCode === spotIndexOrId);

    if (!instance) {
      instance = catalog.instances[0];
    }

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startAt = zonedDateTimeToUtc('2026-09-15', `${String(startHour).padStart(2, '0')}:00`, 'Asia/Manila').toISOString();
    const endAt = zonedDateTimeToUtc('2026-09-15', `${String(startHour + duration).padStart(2, '0')}:00`, 'Asia/Manila').toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Jane',
        customerLastName: 'Doe',
        customerEmail: `jane.doe.${refCodeSuffix}@example.com`,
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

    // Submit payment proof
    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/test.png',
    });

    // Approve payment (allocates spot)
    await paymentReviewService.reviewPayment({
      paymentAttemptId: res.paymentSession!.paymentAttemptId,
      actor: { role: 'ADMIN', userId: 'admin-user-1' },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(res.id, res.referenceCode, 'https://deskatlas.test/access');

    return res;
  }

  describe('Reservation Cancellation Workflow', () => {
    it('cancels confirmed reservation, sets status CANCELLED, revokes QR, and records audit/timeline', async () => {
      const reservation = await createConfirmedReservation('cancel-1');
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Verify confirmed status and booking QR
      const initialDetail = await adminService.getReservationDetail(reservation.id);
      expect(initialDetail).not.toBeNull();
      expect(initialDetail!.reservationStatus).toBe('CONFIRMED');
      expect(initialDetail!.hasBookingQr).toBe(true);

      // Cancel reservation
      const cancelResult = await adminService.cancelReservation({
        reservationId: reservation.id,
        reason: 'Customer Request',
        notes: 'Customer requested cancellation due to personal emergency',
        actorUserId: 'admin-1',
        actorRole: 'ADMIN',
      });

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.reservation.reservationStatus).toBe('CANCELLED');
      expect(cancelResult.reservation.cancellationReason).toContain('Customer Request');
      expect(cancelResult.reservation.cancellationReason).toContain('personal emergency');
      expect(cancelResult.reservation.hasBookingQr).toBe(false);
      expect(cancelResult.reservation.qrRevokedAt).not.toBeNull();

      // Check timeline has cancellation entry
      const updatedDetail = await adminService.getReservationDetail(reservation.id);
      expect(updatedDetail!.timeline.some((t) => t.includes('Reservation cancelled') && t.includes('Customer Request'))).toBe(true);

      // Verify cancellation email was dispatched
      expect(sentEmails.length).toBeGreaterThan(0);
      const email = sentEmails.find((e) => e.body.subject.includes('Cancelled'));
      expect(email).toBeDefined();
      expect(email.body.to).toContain(`jane.doe.cancel-1@example.com`);
      expect(email.body.html).toContain('Customer Request');
    });

    it('releases the allocated spot immediately so another booking can use it', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const spot1 = catalog.instances[0];
      const res1 = await createConfirmedReservation('spot-release-1', spot1.id, 10, 2);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Before cancellation, checking availability for spot-1 at 10:00-12:00 returns unavailable
      const availBefore = await adminService.checkRescheduleAvailability({
        reservationId: 'other-res-id',
        startAt: zonedDateTimeToUtc('2026-09-15', '10:00', 'Asia/Manila').toISOString(),
        endAt: zonedDateTimeToUtc('2026-09-15', '12:00', 'Asia/Manila').toISOString(),
        workspaceInstanceId: spot1.id,
      });
      expect(availBefore.available).toBe(false);

      // Cancel res1
      await adminService.cancelReservation({
        reservationId: res1.id,
        reason: 'Payment Reversal',
        actorRole: 'ADMIN',
      });

      // After cancellation, spot-1 is free for that time window
      const availAfter = await adminService.checkRescheduleAvailability({
        reservationId: 'other-res-id',
        startAt: zonedDateTimeToUtc('2026-09-15', '10:00', 'Asia/Manila').toISOString(),
        endAt: zonedDateTimeToUtc('2026-09-15', '12:00', 'Asia/Manila').toISOString(),
        workspaceInstanceId: spot1.id,
      });
      expect(availAfter.available).toBe(true);
    });

    it('rejects cancellation when reservation ID or reason is missing', async () => {
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await expect(
        adminService.cancelReservation({
          reservationId: '',
          reason: 'Customer Request',
        })
      ).rejects.toThrow('Reservation ID is required.');

      await expect(
        adminService.cancelReservation({
          reservationId: 'valid-id',
          reason: '   ',
        })
      ).rejects.toThrow('Cancellation reason is required.');
    });
  });

  describe('Reservation Reschedule Workflow', () => {
    it('reschedules reservation, updates times, records timeline, and dispatches confirmation email', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const spot2 = catalog.instances[1];
      const reservation = await createConfirmedReservation('resched-1', spot2.id, 9, 2);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const newStart = zonedDateTimeToUtc('2026-09-16', '14:00', 'Asia/Manila').toISOString();
      const newEnd = zonedDateTimeToUtc('2026-09-16', '16:00', 'Asia/Manila').toISOString();

      const result = await adminService.rescheduleReservation({
        reservationId: reservation.id,
        startAt: newStart,
        endAt: newEnd,
        actorUserId: 'admin-1',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(result.reservation.candidates[0].startAt).toBe(newStart);
      expect(result.reservation.candidates[0].endAt).toBe(newEnd);
      expect(result.reservation.schedule).toContain('Sep 16');

      // Check timeline has reschedule entry
      const updatedDetail = await adminService.getReservationDetail(reservation.id);
      expect(updatedDetail!.timeline.some((t) => t.includes('Rescheduled by Admin'))).toBe(true);

      // Verify rescheduled confirmation email dispatched
      const email = sentEmails.find((e) => e.body.subject.includes('Rescheduled'));
      expect(email).toBeDefined();
      expect(email.body.to).toContain(`jane.doe.resched-1@example.com`);
      expect(email.body.html).toContain('Updated Schedule Details');
    });

    it('prevents double-booking when rescheduling into an already occupied slot', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const spot3 = catalog.instances[2];
      const spot4 = catalog.instances[3];

      // res1 is on spot-3 from 10:00 to 12:00
      const res1 = await createConfirmedReservation('res-conflict-1', spot3.id, 10, 2);
      // res2 is on spot-4 from 14:00 to 16:00
      const res2 = await createConfirmedReservation('res-conflict-2', spot4.id, 14, 2);

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Attempt to reschedule res2 to spot-3 at 11:00-13:00 (overlaps with res1 10:00-12:00)
      const avail = await adminService.checkRescheduleAvailability({
        reservationId: res2.id,
        startAt: zonedDateTimeToUtc('2026-09-15', '11:00', 'Asia/Manila').toISOString(),
        endAt: zonedDateTimeToUtc('2026-09-15', '13:00', 'Asia/Manila').toISOString(),
        workspaceInstanceId: spot3.id,
      });
      expect(avail.available).toBe(false);

      await expect(
        adminService.rescheduleReservation({
          reservationId: res2.id,
          startAt: zonedDateTimeToUtc('2026-09-15', '11:00', 'Asia/Manila').toISOString(),
          endAt: zonedDateTimeToUtc('2026-09-15', '13:00', 'Asia/Manila').toISOString(),
          workspaceInstanceId: spot3.id,
        })
      ).rejects.toThrow('already booked');
    });

    it('rejects rescheduling a cancelled or expired reservation', async () => {
      const reservation = await createConfirmedReservation('res-cancelled-test');
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await adminService.cancelReservation({
        reservationId: reservation.id,
        reason: 'Customer Request',
      });

      await expect(
        adminService.rescheduleReservation({
          reservationId: reservation.id,
          startAt: '2026-09-16T10:00:00.000Z',
          endAt: '2026-09-16T12:00:00.000Z',
        })
      ).rejects.toThrow('Cannot reschedule a cancelled reservation');
    });

    it('validates start and end time parameters', async () => {
      const reservation = await createConfirmedReservation('res-invalid-times');
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await expect(
        adminService.rescheduleReservation({
          reservationId: reservation.id,
          startAt: '2026-09-16T12:00:00.000Z',
          endAt: '2026-09-16T10:00:00.000Z', // end is before start
        })
      ).rejects.toThrow('End time must be strictly after start time.');
    });

    it('allows picking a different spot of the same template and updates candidate assignment', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const spot1 = catalog.instances[0]; // Dedicated Desk spot-1
      const spot2 = catalog.instances[1]; // Dedicated Desk spot-2

      // Create reservation on spot1
      const res = await createConfirmedReservation('res-diff-spot', spot1.id, 9, 2);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const newStart = zonedDateTimeToUtc('2026-09-16', '13:00', 'Asia/Manila').toISOString();
      const newEnd = zonedDateTimeToUtc('2026-09-16', '15:00', 'Asia/Manila').toISOString();

      // Reschedule to spot2 with a new time
      const result = await adminService.rescheduleReservation({
        reservationId: res.id,
        startAt: newStart,
        endAt: newEnd,
        workspaceInstanceId: spot2.id,
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(result.reservation.assignedCandidate?.workspaceInstanceId).toBe(spot2.id);
      expect(result.reservation.candidates[0].workspaceInstanceId).toBe(spot2.id);
      expect(result.reservation.candidates[0].startAt).toBe(newStart);
    });

    it('returns slot availability breakdown where booked times are marked isAvailable: false', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const spot3 = catalog.instances[2];

      // Booking exists on spot3 from 10:00 to 12:00
      await createConfirmedReservation('res-booked-slot', spot3.id, 10, 2);

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Check slot availability for spot3 on 2026-09-15 for 2-hour duration
      const avail = await adminService.checkRescheduleAvailability({
        reservationId: 'dummy-res-id',
        date: '2026-09-15',
        durationHours: 2,
        workspaceInstanceId: spot3.id,
      });

      expect(avail.slots).toBeDefined();
      expect(avail.slots!.length).toBeGreaterThan(0);

      // 10:00 slot (10:00 - 12:00) overlaps with the existing booking (10:00 - 12:00) -> isAvailable must be false
      const slot10 = avail.slots!.find((s) => s.startTime === '10:00');
      expect(slot10).toBeDefined();
      expect(slot10!.isAvailable).toBe(false);
      expect(slot10!.reason).toBe('Booked');

      // 09:00 slot (09:00 - 11:00) overlaps with 10:00 - 12:00 -> isAvailable must be false
      const slot09 = avail.slots!.find((s) => s.startTime === '09:00');
      expect(slot09).toBeDefined();
      expect(slot09!.isAvailable).toBe(false);

      // 14:00 slot (14:00 - 16:00) does not overlap -> isAvailable must be true
      const slot14 = avail.slots!.find((s) => s.startTime === '14:00');
      expect(slot14).toBeDefined();
      expect(slot14!.isAvailable).toBe(true);
    });

    it('rejects rescheduling to a past date or time', async () => {
      const reservation = await createConfirmedReservation('res-past-resched');
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // now is 8:00 AM Manila time on 2026-09-15. Attempting to reschedule to 2026-09-14 (yesterday)
      await expect(
        adminService.rescheduleReservation({
          reservationId: reservation.id,
          startAt: zonedDateTimeToUtc('2026-09-14', '10:00', 'Asia/Manila').toISOString(),
          endAt: zonedDateTimeToUtc('2026-09-14', '12:00', 'Asia/Manila').toISOString(),
        })
      ).rejects.toThrow('Cannot reschedule to a past date or time');

      // Attempting to reschedule to 2026-09-15 07:00 (earlier today)
      await expect(
        adminService.rescheduleReservation({
          reservationId: reservation.id,
          startAt: zonedDateTimeToUtc('2026-09-15', '07:00', 'Asia/Manila').toISOString(),
          endAt: zonedDateTimeToUtc('2026-09-15', '09:00', 'Asia/Manila').toISOString(),
        })
      ).rejects.toThrow('Cannot reschedule to a past date or time');
    });

    it('marks past hours as unavailable with reason Past on current day slot breakdown', async () => {
      // Set current time to 12:30 PM Manila time on 2026-09-15
      now = new Date('2026-09-15T12:30:00+08:00');
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const avail = await adminService.checkRescheduleAvailability({
        reservationId: 'dummy-res-id',
        date: '2026-09-15',
        durationHours: 2,
        workspaceInstanceId: 'spot-1',
      });

      expect(avail.slots).toBeDefined();

      // 08:00, 09:00, 10:00, 11:00, 12:00 are before 12:30 PM -> must be marked Past
      const slot08 = avail.slots!.find((s) => s.startTime === '08:00');
      expect(slot08?.isAvailable).toBe(false);
      expect(slot08?.reason).toBe('Past');

      const slot12 = avail.slots!.find((s) => s.startTime === '12:00');
      expect(slot12?.isAvailable).toBe(false);
      expect(slot12?.reason).toBe('Past');

      // 13:00 (1:00 PM) is after 12:30 PM -> should be available
      const slot13 = avail.slots!.find((s) => s.startTime === '13:00');
      expect(slot13?.isAvailable).toBe(true);
    });
  });

  describe('Transactional Email Templates', () => {
    it('renders cancellation email with reason, reference code, and tracking link', () => {
      const rendered = renderReservationCancelledEmail({
        to: 'customer@example.com',
        customerFirstName: 'Alice',
        customerLastName: 'Smith',
        referenceCode: 'DA-CAN-1234',
        cancellationReason: 'Facility Maintenance',
        cancellationNotes: 'Power maintenance on 2nd floor',
        schedule: 'Sep 15, 09:00 - 11:00',
        workspaceDisplayName: 'Desk D-01',
        trackingUrl: 'https://deskatlas.test/track?code=DA-CAN-1234',
      });

      expect(rendered.subject).toContain('DA-CAN-1234');
      expect(rendered.html).toContain('Alice Smith');
      expect(rendered.html).toContain('Facility Maintenance');
      expect(rendered.html).toContain('Power maintenance on 2nd floor');
      expect(rendered.html).toContain('Desk D-01');
      expect(rendered.html).toContain('https://deskatlas.test/track?code=DA-CAN-1234');
      expect(rendered.text).toContain('DA-CAN-1234');
    });

    it('renders rescheduled email with old and new schedule comparison', () => {
      const rendered = renderReservationRescheduledEmail({
        to: 'customer@example.com',
        customerFirstName: 'Bob',
        customerLastName: 'Jones',
        referenceCode: 'DA-RES-5678',
        oldSchedule: 'Sep 15, 09:00 - 11:00',
        newSchedule: 'Sep 16, 14:00 - 16:00',
        workspaceDisplayName: 'Desk D-02',
        floorName: 'Floor 1',
        bookingAccessUrl: 'https://deskatlas.test/booking/tok-123',
        trackingUrl: 'https://deskatlas.test/track?code=DA-RES-5678',
      });

      expect(rendered.subject).toContain('DA-RES-5678');
      expect(rendered.html).toContain('Bob Jones');
      expect(rendered.html).toContain('Sep 16, 14:00 - 16:00');
      expect(rendered.html).toContain('Sep 15, 09:00 - 11:00');
      expect(rendered.html).toContain('Desk D-02');
      expect(rendered.html).toContain('https://deskatlas.test/booking/tok-123');
      expect(rendered.text).toContain('DA-RES-5678');
    });
  });
});
