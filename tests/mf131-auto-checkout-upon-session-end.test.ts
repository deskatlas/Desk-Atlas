import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  matchesStaffReservationFilter,
  filterStaffReservationsByStatus,
  createStaffOperationsService,
  createStaffDashboardService,
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createReservationService,
  createCounterPaymentService,
  createPaymentSessionService,
  type StaffOperationalReservation,
} from '@deskatlas/domain';

describe('MF-131: Auto-Checkout Upon Session End Time', () => {
  async function setupTestFixture() {
    let currentTime = new Date('2026-09-18T09:00:00.000Z');
    const nowProvider = () => currentTime;
    const reservationRepo = new ReservationMemoryRepository(nowProvider);
    const workspaceRepo = new InMemoryWorkspaceRepository();

    const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const counterPaymentService = createCounterPaymentService(reservationRepo);
    const staffOpsService = createStaffOperationsService(reservationRepo, nowProvider);
    const staffDashboardService = createStaffDashboardService(
      reservationRepo,
      reservationRepo,
      workspaceRepo,
      nowProvider,
      'Asia/Manila'
    );

    const floor = await workspaceRepo.createFloor({ name: 'Ground Floor' });
    const template = await workspaceRepo.createTemplate({
      name: 'Hot Desk',
      capacity: 1,
      rateAmount: 120,
      pricingUnit: 'HOURLY',
      defaultShape: 'rectangle',
      defaultColor: '#0ea5e9',
      isActive: true,
    });
    const instanceA = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'HD-01',
      displayName: 'Hot Desk 01',
    });
    const instanceB = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'HD-02',
      displayName: 'Hot Desk 02',
    });

    return {
      currentTime,
      getTime: () => currentTime,
      setTime: (d: Date) => {
        currentTime = d;
      },
      reservationRepo,
      workspaceRepo,
      reservationService,
      counterPaymentService,
      staffOpsService,
      staffDashboardService,
      instanceA,
      instanceB,
    };
  }

  describe('1. Repository & Operational Reservation Derivation', () => {
    it('automatically transitions checked-in reservation to COMPLETED & CHECKED_OUT once end time passes', async () => {
      const ctx = await setupTestFixture();

      // Create a reservation for 09:00 - 11:00
      const created = await ctx.reservationService.createReservation({
        source: 'KIOSK',
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        customerEmail: 'juan@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T11:00:00.000Z',
          },
        ],
      });

      // Confirm payment at counter (auto-checks in or marks confirmed)
      await ctx.counterPaymentService.confirmPayment({
        code: created.referenceCode,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      // Check in the guest at 09:05
      ctx.setTime(new Date('2026-09-18T09:05:00.000Z'));
      await ctx.staffOpsService.checkInReservation({
        reservationId: created.id,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      // While in session (10:00 AM)
      ctx.setTime(new Date('2026-09-18T10:00:00.000Z'));
      const activeSummary = await ctx.staffOpsService.getOperationalReservation(created.id);
      assert.ok(activeSummary);
      assert.equal(activeSummary.reservationStatus, 'CHECKED_IN');
      assert.equal(activeSummary.checkInState, 'CHECKED_IN');
      assert.equal(activeSummary.checkedOutAt, null);

      // Advance time past end time (11:01 AM) without manual staff checkout
      ctx.setTime(new Date('2026-09-18T11:01:00.000Z'));

      const endedSummary = await ctx.staffOpsService.getOperationalReservation(created.id);
      assert.ok(endedSummary);
      assert.equal(endedSummary.reservationStatus, 'COMPLETED');
      assert.equal(endedSummary.checkInState, 'CHECKED_OUT');
      assert.equal(endedSummary.checkedOutAt, '2026-09-18T11:00:00.000Z');
    });

    it('retains future checked-in reservations as active before their end time', async () => {
      const ctx = await setupTestFixture();

      const created = await ctx.reservationService.createReservation({
        source: 'KIOSK',
        customerFirstName: 'Maria',
        customerLastName: 'Clara',
        customerEmail: 'maria@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T13:00:00.000Z',
          },
        ],
      });

      await ctx.counterPaymentService.confirmPayment({
        code: created.referenceCode,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      ctx.setTime(new Date('2026-09-18T09:05:00.000Z'));
      await ctx.staffOpsService.checkInReservation({
        reservationId: created.id,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      // At 11:30 AM (before 13:00 end time)
      ctx.setTime(new Date('2026-09-18T11:30:00.000Z'));
      const activeSummary = await ctx.staffOpsService.getOperationalReservation(created.id);
      assert.ok(activeSummary);
      assert.equal(activeSummary.reservationStatus, 'CHECKED_IN');
      assert.equal(activeSummary.checkInState, 'CHECKED_IN');
      assert.equal(activeSummary.checkedOutAt, null);
    });
  });

  describe('2. Staff Reservations Filter Integration', () => {
    const mockList: StaffOperationalReservation[] = [
      {
        reservationId: 'res-ongoing',
        referenceCode: 'REF-ONGOING',
        source: 'WEB',
        customerFirstName: 'Ongoing',
        customerLastName: 'Guest',
        customerEmail: 'ongoing@example.com',
        reservationStatus: 'CHECKED_IN',
        checkInState: 'CHECKED_IN',
        workspaceInstanceId: 'ws-1',
        workspaceDisplayName: 'Hot Desk 1',
        workspaceInstanceCode: 'HD-01',
        workspaceTemplateName: 'Hot Desk',
        floorName: 'Floor 1',
        bookingStartAt: '2026-09-18T09:00:00.000Z',
        bookingEndAt: '2026-09-18T12:00:00.000Z',
        confirmedAt: '2026-09-18T08:30:00.000Z',
        checkedInAt: '2026-09-18T09:00:00.000Z',
        checkedOutAt: null,
        qrIssuedAt: '2026-09-18T08:30:00.000Z',
      },
      {
        reservationId: 'res-ended',
        referenceCode: 'REF-ENDED',
        source: 'WEB',
        customerFirstName: 'Ended',
        customerLastName: 'Guest',
        customerEmail: 'ended@example.com',
        reservationStatus: 'CHECKED_IN',
        checkInState: 'CHECKED_IN',
        workspaceInstanceId: 'ws-2',
        workspaceDisplayName: 'Hot Desk 2',
        workspaceInstanceCode: 'HD-02',
        workspaceTemplateName: 'Hot Desk',
        floorName: 'Floor 1',
        bookingStartAt: '2026-09-18T08:00:00.000Z',
        bookingEndAt: '2026-09-18T10:00:00.000Z',
        confirmedAt: '2026-09-18T07:30:00.000Z',
        checkedInAt: '2026-09-18T08:00:00.000Z',
        checkedOutAt: null,
        qrIssuedAt: '2026-09-18T07:30:00.000Z',
      },
    ];

    it('filters out ended bookings from Active and Checked In tabs at 10:30 AM', () => {
      const currentNow = new Date('2026-09-18T10:30:00.000Z');

      const activeFiltered = filterStaffReservationsByStatus(mockList, 'active', currentNow);
      assert.equal(activeFiltered.length, 1);
      assert.equal(activeFiltered[0].referenceCode, 'REF-ONGOING');

      const checkedInFiltered = filterStaffReservationsByStatus(mockList, 'checked_in', currentNow);
      assert.equal(checkedInFiltered.length, 1);
      assert.equal(checkedInFiltered[0].referenceCode, 'REF-ONGOING');

      const allFiltered = filterStaffReservationsByStatus(mockList, 'all', currentNow);
      assert.equal(allFiltered.length, 2);
    });

    it('correctly matches individual reservation filter rules for auto-checkout', () => {
      const currentNow = new Date('2026-09-18T10:30:00.000Z');

      // res-ongoing: bookingEndAt is 12:00 > 10:30 -> Active & Checked In = true
      assert.equal(matchesStaffReservationFilter(mockList[0], 'active', currentNow), true);
      assert.equal(matchesStaffReservationFilter(mockList[0], 'checked_in', currentNow), true);

      // res-ended: bookingEndAt is 10:00 < 10:30 -> Active & Checked In = false (auto checked out)
      assert.equal(matchesStaffReservationFilter(mockList[1], 'active', currentNow), false);
      assert.equal(matchesStaffReservationFilter(mockList[1], 'checked_in', currentNow), false);
      assert.equal(matchesStaffReservationFilter(mockList[1], 'all', currentNow), true);
    });
  });

  describe('3. Staff Dashboard Metrics & Workspace Overview', () => {
    it('automatically excludes ended checked-in reservations from Currently Checked In count', async () => {
      const ctx = await setupTestFixture();

      // Booking 1: 09:00 - 10:00 (ends at 10:00)
      const res1 = await ctx.reservationService.createReservation({
        source: 'KIOSK',
        customerFirstName: 'Guest',
        customerLastName: 'One',
        customerEmail: 'one@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceA.id,
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T10:00:00.000Z',
          },
        ],
      });
      await ctx.counterPaymentService.confirmPayment({
        code: res1.referenceCode,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });
      await ctx.staffOpsService.checkInReservation({
        reservationId: res1.id,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      // Booking 2: 09:00 - 12:00 (ends at 12:00)
      const res2 = await ctx.reservationService.createReservation({
        source: 'KIOSK',
        customerFirstName: 'Guest',
        customerLastName: 'Two',
        customerEmail: 'two@example.com',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: ctx.instanceB.id,
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T12:00:00.000Z',
          },
        ],
      });
      await ctx.counterPaymentService.confirmPayment({
        code: res2.referenceCode,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });
      await ctx.staffOpsService.checkInReservation({
        reservationId: res2.id,
        actor: { userId: 'staff-1', role: 'STAFF' },
      });

      // At 09:30 AM: Both are checked in
      ctx.setTime(new Date('2026-09-18T09:30:00.000Z'));
      const snap1 = await ctx.staffDashboardService.getDashboardSnapshot('today');
      assert.equal(snap1.metrics.checkedIn.value, 2);

      // At 10:15 AM: res1 ended, res2 is still active
      ctx.setTime(new Date('2026-09-18T10:15:00.000Z'));
      const snap2 = await ctx.staffDashboardService.getDashboardSnapshot('today');
      assert.equal(snap2.metrics.checkedIn.value, 1);

      // Workspace overview breakdown In Use count should also be 1
      const inUse = snap2.workspaceOverview.breakdown.find((b) => b.label === 'In Use');
      assert.ok(inUse);
      assert.equal(inUse.rawValue, 1);
    });
  });
});
