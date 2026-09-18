import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  formatRemainingDuration,
  useLiveCountdownClock,
  WorkspaceCountdownBadge,
} from '@deskatlas/ui';
import {
  type AdminReservationSummary,
  type StaffOperationalReservation,
  filterReservationsBySearch,
  filterStaffReservationsByStatus,
} from '@deskatlas/domain';

describe('MF-130: Remaining Time for Checked In / Active Reservations on Admin and Staff Lists', () => {
  const baseNow = new Date('2026-09-18T10:00:00.000Z').getTime();

  describe('1. Active & Checked-In Reservation Qualification Logic', () => {
    it('identifies checked-in and active confirmed reservations for Admin list', () => {
      const isCheckedInOrActive = (r: Partial<AdminReservationSummary>): boolean => {
        return Boolean(
          r.reservationStatus === 'CHECKED_IN' ||
            r.reservationStatus === 'CONFIRMED' ||
            r.status?.toLowerCase().includes('checked') ||
            r.status?.toLowerCase().includes('confirmed')
        );
      };

      assert.equal(isCheckedInOrActive({ reservationStatus: 'CHECKED_IN' }), true);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'CONFIRMED' }), true);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'COMPLETED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'CANCELLED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'EXPIRED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'REJECTED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'PENDING_PAYMENT' }), false);
    });

    it('identifies checked-in and active confirmed reservations for Staff list', () => {
      const isCheckedInOrActive = (res: Partial<StaffOperationalReservation>) => {
        return (
          (res.reservationStatus === 'CHECKED_IN' ||
            res.checkInState === 'CHECKED_IN' ||
            res.reservationStatus === 'CONFIRMED') &&
          res.reservationStatus !== 'COMPLETED' &&
          res.reservationStatus !== 'CANCELLED' &&
          res.reservationStatus !== 'EXPIRED' &&
          res.reservationStatus !== 'REJECTED'
        );
      };

      assert.equal(isCheckedInOrActive({ reservationStatus: 'CHECKED_IN', checkInState: 'CHECKED_IN' }), true);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'CONFIRMED', checkInState: 'PENDING' }), true);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'CONFIRMED', checkInState: 'CHECKED_IN' }), true);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'COMPLETED', checkInState: 'CHECKED_OUT' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'CANCELLED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'EXPIRED' }), false);
      assert.equal(isCheckedInOrActive({ reservationStatus: 'PENDING_COUNTER_CONFIRMATION' }), false);
    });
  });

  describe('2. Live Countdown Calculations on Table Records', () => {
    it('calculates accurate remaining time for checked-in admin reservation', () => {
      // 45 minutes remaining
      const endAt = new Date('2026-09-18T10:45:00.000Z').toISOString();
      const adminRes: Partial<AdminReservationSummary> = {
        referenceCode: 'RES-ADM-001',
        reservationStatus: 'CHECKED_IN',
        startAt: new Date('2026-09-18T09:00:00.000Z').toISOString(),
        endAt,
      };

      const remaining = formatRemainingDuration(adminRes.endAt, baseNow);
      assert.equal(remaining.isExpired, false);
      assert.equal(remaining.urgency, 'normal');
      assert.equal(remaining.minutes, 45);
      assert.equal(remaining.formatted, '45:00');
      assert.equal(remaining.label, '⏳ 45:00');
    });

    it('calculates warning state (5-15 min) for active staff reservation approaching end', () => {
      // 10 minutes remaining
      const bookingEndAt = new Date('2026-09-18T10:10:00.000Z').toISOString();
      const staffRes: Partial<StaffOperationalReservation> = {
        referenceCode: 'RES-STF-002',
        reservationStatus: 'CHECKED_IN',
        checkInState: 'CHECKED_IN',
        bookingStartAt: new Date('2026-09-18T08:00:00.000Z').toISOString(),
        bookingEndAt,
      };

      const remaining = formatRemainingDuration(staffRes.bookingEndAt, baseNow);
      assert.equal(remaining.isExpired, false);
      assert.equal(remaining.urgency, 'warning');
      assert.equal(remaining.minutes, 10);
      assert.equal(remaining.formatted, '10:00');
    });

    it('calculates urgent state (<5 min) for session imminent turnover', () => {
      // 3 minutes 30 seconds remaining
      const bookingEndAt = new Date('2026-09-18T10:03:30.000Z').toISOString();
      const remaining = formatRemainingDuration(bookingEndAt, baseNow);
      assert.equal(remaining.isExpired, false);
      assert.equal(remaining.urgency, 'urgent');
      assert.equal(remaining.minutes, 3);
      assert.equal(remaining.seconds, 30);
      assert.equal(remaining.formatted, '03:30');
    });

    it('marks overdue status when booking end time has elapsed', () => {
      // Past end time by 2 minutes
      const pastEndAt = new Date('2026-09-18T09:58:00.000Z').toISOString();
      const remaining = formatRemainingDuration(pastEndAt, baseNow);
      assert.equal(remaining.isExpired, true);
      assert.equal(remaining.urgency, 'expired');
      assert.equal(remaining.formatted, '00:00');
      assert.equal(remaining.label, '⏳ Overdue');
    });
  });

  describe('3. Staff & Admin Filter Integration', () => {
    it('preserves status filtering alongside countdown visibility in staff operations', () => {
      const mockReservations: StaffOperationalReservation[] = [
        {
          reservationId: '1',
          referenceCode: 'REF-001',
          source: 'ONLINE',
          customerFirstName: 'John',
          customerLastName: 'Doe',
          customerEmail: 'john@example.com',
          reservationStatus: 'CHECKED_IN',
          checkInState: 'CHECKED_IN',
          workspaceInstanceId: 'inst-1',
          workspaceDisplayName: 'Desk 1',
          workspaceInstanceCode: 'D1',
          workspaceTemplateName: 'Hot Desk',
          floorName: 'Floor 1',
          bookingStartAt: '2026-09-18T09:00:00.000Z',
          bookingEndAt: '2026-09-18T11:00:00.000Z',
          confirmedAt: '2026-09-18T08:50:00.000Z',
          checkedInAt: '2026-09-18T09:02:00.000Z',
          checkedOutAt: null,
          qrIssuedAt: null,
        },
        {
          reservationId: '2',
          referenceCode: 'REF-002',
          source: 'KIOSK',
          customerFirstName: 'Jane',
          customerLastName: 'Smith',
          customerEmail: 'jane@example.com',
          reservationStatus: 'CONFIRMED',
          checkInState: 'PENDING',
          workspaceInstanceId: 'inst-2',
          workspaceDisplayName: 'Desk 2',
          workspaceInstanceCode: 'D2',
          workspaceTemplateName: 'Hot Desk',
          floorName: 'Floor 1',
          bookingStartAt: '2026-09-18T10:30:00.000Z',
          bookingEndAt: '2026-09-18T12:30:00.000Z',
          confirmedAt: '2026-09-18T10:00:00.000Z',
          checkedInAt: null,
          checkedOutAt: null,
          qrIssuedAt: null,
        },
        {
          reservationId: '3',
          referenceCode: 'REF-003',
          source: 'ONLINE',
          customerFirstName: 'Bob',
          customerLastName: 'Wilson',
          customerEmail: 'bob@example.com',
          reservationStatus: 'COMPLETED',
          checkInState: 'CHECKED_OUT',
          workspaceInstanceId: 'inst-3',
          workspaceDisplayName: 'Desk 3',
          workspaceInstanceCode: 'D3',
          workspaceTemplateName: 'Hot Desk',
          floorName: 'Floor 1',
          bookingStartAt: '2026-09-18T08:00:00.000Z',
          bookingEndAt: '2026-09-18T09:30:00.000Z',
          confirmedAt: '2026-09-18T07:50:00.000Z',
          checkedInAt: '2026-09-18T08:00:00.000Z',
          checkedOutAt: '2026-09-18T09:30:00.000Z',
          qrIssuedAt: null,
        },
      ];

      const checkedInFiltered = filterStaffReservationsByStatus(mockReservations, 'checked_in');
      assert.equal(checkedInFiltered.length, 1);
      assert.equal(checkedInFiltered[0].referenceCode, 'REF-001');

      // Remaining duration calculated for checked in item
      const ref1Duration = formatRemainingDuration(checkedInFiltered[0].bookingEndAt, baseNow);
      assert.equal(ref1Duration.hours, 1);
      assert.equal(ref1Duration.minutes, 0);
      assert.equal(ref1Duration.formatted, '01:00:00');

      const allFiltered = filterStaffReservationsByStatus(mockReservations, 'all');
      assert.equal(allFiltered.length, 3);
    });
  });
});
