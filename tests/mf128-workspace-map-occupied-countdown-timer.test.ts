import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  formatRemainingDuration,
  useLiveCountdownClock,
  WorkspaceCountdownBadge,
} from '@deskatlas/ui';
import {
  InMemoryAvailabilityRepository,
  createAvailabilityService,
  createStaffOperationsService,
  ReservationMemoryRepository,
  type OccupancyRecord,
} from '@deskatlas/domain';

describe('MF-128: Occupied Workspace Live Countdown Timer on Floor Maps (Admin, Staff, Kiosk)', () => {
  describe('1. Countdown Duration Formatter & Urgency Transitions', () => {
    it('formats durations greater than 15 minutes as normal urgency', () => {
      const baseNow = new Date('2026-09-18T10:00:00.000Z').getTime();
      // 1 hour, 24 minutes, 15 seconds remaining
      const endAt = new Date('2026-09-18T11:24:15.000Z');
      const result = formatRemainingDuration(endAt, baseNow);

      assert.equal(result.isExpired, false);
      assert.equal(result.urgency, 'normal');
      assert.equal(result.hours, 1);
      assert.equal(result.minutes, 24);
      assert.equal(result.seconds, 15);
      assert.equal(result.formatted, '01:24:15');
      assert.equal(result.label, '⏳ 01:24:15');
    });

    it('formats durations between 5 and 15 minutes with warning urgency', () => {
      const baseNow = new Date('2026-09-18T10:00:00.000Z').getTime();
      // 12 minutes, 45 seconds remaining (765 seconds)
      const endAt = new Date('2026-09-18T10:12:45.000Z');
      const result = formatRemainingDuration(endAt, baseNow);

      assert.equal(result.isExpired, false);
      assert.equal(result.urgency, 'warning');
      assert.equal(result.hours, 0);
      assert.equal(result.minutes, 12);
      assert.equal(result.seconds, 45);
      assert.equal(result.formatted, '12:45');
      assert.equal(result.label, '⏳ 12:45');
    });

    it('formats durations under 5 minutes with urgent urgency for turnover awareness', () => {
      const baseNow = new Date('2026-09-18T10:00:00.000Z').getTime();
      // 4 minutes, 12 seconds remaining (252 seconds)
      const endAt = new Date('2026-09-18T10:04:12.000Z');
      const result = formatRemainingDuration(endAt, baseNow);

      assert.equal(result.isExpired, false);
      assert.equal(result.urgency, 'urgent');
      assert.equal(result.hours, 0);
      assert.equal(result.minutes, 4);
      assert.equal(result.seconds, 12);
      assert.equal(result.formatted, '04:12');
      assert.equal(result.label, '⏳ 04:12');
    });

    it('formats exact 0 seconds and overdue times as expired with Overdue label', () => {
      const baseNow = new Date('2026-09-18T10:00:00.000Z').getTime();
      // Exactly at end time
      const exactEnd = new Date('2026-09-18T10:00:00.000Z');
      const exactResult = formatRemainingDuration(exactEnd, baseNow);

      assert.equal(exactResult.isExpired, true);
      assert.equal(exactResult.urgency, 'expired');
      assert.equal(exactResult.formatted, '00:00');
      assert.equal(exactResult.label, '⏳ Overdue');

      // 5 minutes past end time (overdue)
      const overdueEnd = new Date('2026-09-18T09:55:00.000Z');
      const overdueResult = formatRemainingDuration(overdueEnd, baseNow);

      assert.equal(overdueResult.isExpired, true);
      assert.equal(overdueResult.urgency, 'expired');
      assert.equal(overdueResult.formatted, '00:00');
      assert.equal(overdueResult.label, '⏳ Overdue');
    });

    it('handles null, undefined, and empty string timestamps gracefully', () => {
      const nullResult = formatRemainingDuration(null);
      assert.equal(nullResult.formatted, '--:--');
      assert.equal(nullResult.isExpired, false);

      const undefinedResult = formatRemainingDuration(undefined);
      assert.equal(undefinedResult.formatted, '--:--');

      const invalidResult = formatRemainingDuration('invalid-date-string');
      assert.equal(invalidResult.formatted, '--:--');
    });
  });

  describe('2. Centralized Clock & Deterministic Countdown Simulation', () => {
    it('accurately updates remaining time tick-by-tick without drift across simulated seconds', () => {
      const bookingEnd = new Date('2026-09-18T10:00:10.000Z');
      const startMs = new Date('2026-09-18T10:00:00.000Z').getTime();

      const ticks = [0, 1000, 5000, 9000, 10000, 11000];
      const expectedFormatted = ['00:10', '00:09', '00:05', '00:01', '00:00', '00:00'];
      const expectedUrgency = ['urgent', 'urgent', 'urgent', 'urgent', 'expired', 'expired'];

      for (let i = 0; i < ticks.length; i++) {
        const simulatedNowMs = startMs + ticks[i];
        const res = formatRemainingDuration(bookingEnd, simulatedNowMs);
        assert.equal(res.formatted, expectedFormatted[i], `Tick ${i} formatted mismatch`);
        assert.equal(res.urgency, expectedUrgency[i], `Tick ${i} urgency mismatch`);
      }
    });
  });

  describe('3. Availability Domain & Kiosk Occupancy Details', () => {
    it('returns occupiedInstanceIds and occupiedDetails with bookingEndAt for occupied spots', async () => {
      const memoryRepo = new InMemoryAvailabilityRepository();
      memoryRepo.seedWorkspaceInstance({
        id: 'spot-1',
        templateId: 'tmpl-1',
        floorId: 'fl-1',
        instanceCode: 'D01',
        displayName: 'Desk 01',
        operationalStatus: 'ACTIVE',
      });
      memoryRepo.seedWorkspaceInstance({
        id: 'spot-2',
        templateId: 'tmpl-1',
        floorId: 'fl-1',
        instanceCode: 'D02',
        displayName: 'Desk 02',
        operationalStatus: 'ACTIVE',
      });
      memoryRepo.seedBlockingReservation('spot-1', {
        reservationId: 'res-1',
        reservationStatus: 'CHECKED_IN',
        startAt: '2026-09-18T09:00:00.000Z',
        endAt: '2026-09-18T12:00:00.000Z',
      });

      const service = createAvailabilityService(memoryRepo);
      const res = await service.listOccupiedInstances({
        nowIso: '2026-09-18T10:00:00.000Z',
        durationMinutes: 60,
      });

      assert.equal(res.occupiedInstanceIds.length, 1);
      assert.equal(res.occupiedInstanceIds[0], 'spot-1');
      assert.ok(res.occupiedDetails, 'occupiedDetails should be populated');
      assert.equal(res.occupiedDetails.length, 1);
      assert.equal(res.occupiedDetails[0].workspaceInstanceId, 'spot-1');
      assert.equal(res.occupiedDetails[0].bookingEndAt, '2026-09-18T12:00:00.000Z');
    });

    it('ensures Kiosk payload contains zero customer PII', async () => {
      const memoryRepo = new InMemoryAvailabilityRepository();
      memoryRepo.seedBlockingReservation('spot-private', {
        reservationId: 'res-private',
        reservationStatus: 'CHECKED_IN',
        startAt: '2026-09-18T09:00:00.000Z',
        endAt: '2026-09-18T11:00:00.000Z',
      });

      const service = createAvailabilityService(memoryRepo);
      const res = await service.listOccupiedInstances({
        nowIso: '2026-09-18T09:30:00.000Z',
      });

      // Confirm no personal fields exist anywhere in the return payload
      const payloadString = JSON.stringify(res);
      assert.equal(payloadString.includes('customerFirstName'), false);
      assert.equal(payloadString.includes('customerLastName'), false);
      assert.equal(payloadString.includes('customerEmail'), false);
      assert.equal(payloadString.includes('referenceCode'), false);
    });
  });

  describe('4. Staff & Admin Operations Occupancy Integration', () => {
    it('returns full occupant details including bookingEndAt and checkInState for staff/admin inspection', async () => {
      const resRepo = new ReservationMemoryRepository();
      const service = createStaffOperationsService(resRepo, () => new Date('2026-09-18T10:00:00.000Z'));

      // Seed a confirmed and checked-in reservation
      const res = await resRepo.createReservation({
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        customerEmail: 'maria.santos@example.com',
        source: 'KIOSK',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst-staff-1',
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T11:30:00.000Z',
            isAssigned: true,
          },
        ],
      });
      res.status = 'CHECKED_IN';
      res.checkInState = 'CHECKED_IN';
      res.checkedInAt = '2026-09-18T09:05:00.000Z';
      if (res.candidates?.[0]) {
        res.candidates[0].isAssigned = true;
      }

      const occupancyList = await service.listOccupancy();
      assert.equal(occupancyList.length, 1);

      const item = occupancyList[0];
      assert.equal(item.workspaceInstanceId, 'inst-staff-1');
      assert.equal(item.customerFirstName, 'Maria');
      assert.equal(item.customerLastName, 'Santos');
      assert.equal(item.customerEmail, 'maria.santos@example.com');
      assert.equal(item.reservationStatus, 'CHECKED_IN');
      assert.equal(item.bookingStartAt, '2026-09-18T09:00:00.000Z');
      assert.equal(item.bookingEndAt, '2026-09-18T11:30:00.000Z');

      // Calculate countdown duration for this occupancy item
      const countdown = formatRemainingDuration(item.bookingEndAt, new Date('2026-09-18T10:00:00.000Z').getTime());
      // 1 hour 30 mins remaining
      assert.equal(countdown.formatted, '01:30:00');
      assert.equal(countdown.urgency, 'normal');
      assert.equal(countdown.isExpired, false);
    });

    it('immediately reflects reservation time extension in countdown duration', async () => {
      const resRepo = new ReservationMemoryRepository();
      const service = createStaffOperationsService(resRepo, () => new Date('2026-09-18T10:00:00.000Z'));

      const res = await resRepo.createReservation({
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        customerEmail: 'juan@example.com',
        source: 'ONLINE',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst-extend-1',
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T10:05:00.000Z', // 5 minutes remaining -> urgent
            isAssigned: true,
          },
        ],
      });
      res.status = 'CHECKED_IN';
      res.checkInState = 'CHECKED_IN';
      if (res.candidates?.[0]) {
        res.candidates[0].isAssigned = true;
      }

      const initialOccupancy = await service.listOccupancy();
      const initialCountdown = formatRemainingDuration(
        initialOccupancy[0].bookingEndAt,
        new Date('2026-09-18T10:00:00.000Z').getTime()
      );
      assert.equal(initialCountdown.formatted, '05:00');
      assert.equal(initialCountdown.urgency, 'urgent');

      // Extend reservation by 1 hour (MF-127 time extension)
      const candidate = res.candidates?.find((c) => c.isAssigned);
      if (candidate) {
        candidate.endAt = '2026-09-18T11:05:00.000Z';
      }

      const extendedOccupancy = await service.listOccupancy();
      const extendedCountdown = formatRemainingDuration(
        extendedOccupancy[0].bookingEndAt,
        new Date('2026-09-18T10:00:00.000Z').getTime()
      );
      assert.equal(extendedCountdown.formatted, '01:05:00');
      assert.equal(extendedCountdown.urgency, 'normal');
    });

    it('clears countdown badge immediately after check out', async () => {
      const resRepo = new ReservationMemoryRepository();
      const service = createStaffOperationsService(resRepo, () => new Date('2026-09-18T10:00:00.000Z'));

      const res = await resRepo.createReservation({
        customerFirstName: 'Ana',
        customerLastName: 'Reyes',
        customerEmail: 'ana@example.com',
        source: 'KIOSK',
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: 'inst-checkout-1',
            startAt: '2026-09-18T09:00:00.000Z',
            endAt: '2026-09-18T12:00:00.000Z',
            isAssigned: true,
          },
        ],
      });
      res.status = 'CHECKED_IN';
      res.checkInState = 'CHECKED_IN';
      if (res.candidates?.[0]) {
        res.candidates[0].isAssigned = true;
      }

      const beforeCheckout = await service.listOccupancy();
      assert.equal(beforeCheckout.length, 1);

      // Perform checkout action
      await service.checkOutReservation({
        reservationId: res.id,
        actor: {
          userId: 'staff-user-1',
          role: 'STAFF',
        },
      });

      const afterCheckout = await service.listOccupancy();
      assert.equal(afterCheckout.length, 0);
    });
  });
});
