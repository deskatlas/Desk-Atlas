import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  formatEmailTime,
  formatEmailTimeOnly,
  formatEmailSchedule,
  renderBookingConfirmationEmail,
  renderReservationTrackingEmail,
  renderBookingEndedSurveyEmail,
  renderReservationCancelledEmail,
  renderReservationRescheduledEmail,
  renderPaymentLinkEmail,
  renderStaffInvitationEmail,
  renderAdminPasswordResetEmail,
} from '../packages/domain/src/services/transactionalEmailService';

describe('Transactional Email 12-Hour AM/PM Time Formatting', () => {
  describe('formatEmailTime', () => {
    it('converts pure 24-hour military time to 12-hour AM/PM format', () => {
      assert.equal(formatEmailTime('14:00'), '2:00 PM');
      assert.equal(formatEmailTime('09:00'), '9:00 AM');
      assert.equal(formatEmailTime('00:00'), '12:00 AM');
      assert.equal(formatEmailTime('12:00'), '12:00 PM');
      assert.equal(formatEmailTime('23:45'), '11:45 PM');
    });

    it('converts military time with seconds', () => {
      assert.equal(formatEmailTime('14:00:00'), '2:00 PM');
      assert.equal(formatEmailTime('08:30:00'), '8:30 AM');
    });

    it('converts date with military time', () => {
      assert.equal(formatEmailTime('Sep 12, 14:00'), 'Sep 12, 2:00 PM');
      assert.equal(formatEmailTime('Sep 12, 09:00'), 'Sep 12, 9:00 AM');
    });

    it('converts ISO timestamps to date and 12-hour AM/PM in Asia/Manila (UTC+8)', () => {
      // 02:00 UTC = 10:00 AM Manila
      assert.equal(formatEmailTime('2026-09-12T02:00:00.000Z'), 'Sep 12, 2026, 10:00 AM');
      // 14:00 UTC = 10:00 PM Manila
      assert.equal(formatEmailTime('2026-09-12T14:00:00.000Z'), 'Sep 12, 2026, 10:00 PM');
    });

    it('preserves strings that are already in AM/PM format', () => {
      assert.equal(formatEmailTime('Sep 12, 10:00 AM'), 'Sep 12, 10:00 AM');
      assert.equal(formatEmailTime('Sep 12, 02:00 PM'), 'Sep 12, 02:00 PM');
      assert.equal(formatEmailTime('10:00 AM'), '10:00 AM');
      assert.equal(formatEmailTime('2:00 PM'), '2:00 PM');
    });

    it('handles falsy or empty values safely', () => {
      assert.equal(formatEmailTime(''), '');
      assert.equal(formatEmailTime(null), '');
      assert.equal(formatEmailTime(undefined), '');
      assert.equal(formatEmailTime('   '), '');
    });
  });

  describe('formatEmailTimeOnly', () => {
    it('formats ISO timestamps to 12-hour AM/PM time only', () => {
      assert.equal(formatEmailTimeOnly('2026-09-12T02:00:00.000Z'), '10:00 AM');
      assert.equal(formatEmailTimeOnly('2026-09-12T06:00:00.000Z'), '2:00 PM');
    });

    it('formats pure military time to 12-hour AM/PM', () => {
      assert.equal(formatEmailTimeOnly('14:00'), '2:00 PM');
      assert.equal(formatEmailTimeOnly('09:00'), '9:00 AM');
    });

    it('preserves existing AM/PM time', () => {
      assert.equal(formatEmailTimeOnly('10:00 AM'), '10:00 AM');
      assert.equal(formatEmailTimeOnly('2:00 PM'), '2:00 PM');
    });
  });

  describe('formatEmailSchedule', () => {
    it('converts military time range to 12-hour AM/PM format', () => {
      assert.equal(formatEmailSchedule('Sep 15, 09:00 - 11:00'), 'Sep 15, 9:00 AM - 11:00 AM');
      assert.equal(formatEmailSchedule('Sep 16, 14:00 - 16:00'), 'Sep 16, 2:00 PM - 4:00 PM');
      assert.equal(formatEmailSchedule('14:00 - 16:00'), '2:00 PM - 4:00 PM');
      assert.equal(formatEmailSchedule('09:00 to 11:00'), '9:00 AM to 11:00 AM');
    });

    it('preserves schedules that are already in AM/PM format', () => {
      assert.equal(formatEmailSchedule('Sep 15, 9:00 AM - 11:00 AM'), 'Sep 15, 9:00 AM - 11:00 AM');
    });
  });

  describe('renderBookingConfirmationEmail', () => {
    it('renders start and end time in 12-hour AM/PM format when given ISO timestamps', () => {
      const email = renderBookingConfirmationEmail({
        to: 'customer@example.com',
        customerFirstName: 'Juan',
        customerLastName: 'Dela Cruz',
        referenceCode: 'BK-1001',
        workspaceDisplayName: 'Desk A-1',
        workspaceTemplateName: 'Hot Desk',
        floorName: '2nd Floor',
        bookingStartAt: '2026-09-12T02:00:00.000Z', // 10:00 AM Manila
        bookingEndAt: '2026-09-12T06:00:00.000Z',   // 2:00 PM Manila
        bookingAccessUrl: 'https://deskatlas.test/access/token123',
        bookingToken: 'token123',
        qrIssuedAt: '2026-09-12T01:30:00.000Z',
      });

      // HTML table
      assert.ok(email.html.includes('<td>Start Time</td>\n          <td>Sep 12, 2026, 10:00 AM</td>'));
      assert.ok(email.html.includes('<td>End Time</td>\n          <td>Sep 12, 2026, 2:00 PM</td>'));

      // Plain text
      assert.ok(email.text.includes('Start Time: Sep 12, 2026, 10:00 AM'));
      assert.ok(email.text.includes('End Time: Sep 12, 2026, 2:00 PM'));

      // Must not contain raw ISO strings or military time
      assert.ok(!email.html.includes('2026-09-12T02:00:00.000Z'));
      assert.ok(!email.html.includes('2026-09-12T06:00:00.000Z'));
    });

    it('renders start and end time in 12-hour AM/PM format when given military times', () => {
      const email = renderBookingConfirmationEmail({
        to: 'customer@example.com',
        referenceCode: 'BK-1002',
        workspaceDisplayName: 'Desk B-2',
        workspaceTemplateName: 'Dedicated Desk',
        floorName: '1st Floor',
        bookingStartAt: '14:00',
        bookingEndAt: '16:00',
        bookingAccessUrl: 'https://deskatlas.test/access/token456',
        bookingToken: 'token456',
        qrIssuedAt: '2026-09-12T01:30:00.000Z',
      });

      assert.ok(email.html.includes('<td>Start Time</td>\n          <td>2:00 PM</td>'));
      assert.ok(email.html.includes('<td>End Time</td>\n          <td>4:00 PM</td>'));
      assert.ok(email.text.includes('Start Time: 2:00 PM'));
      assert.ok(email.text.includes('End Time: 4:00 PM'));
    });

    it('preserves pre-formatted AM/PM strings', () => {
      const email = renderBookingConfirmationEmail({
        to: 'customer@example.com',
        referenceCode: 'BK-1003',
        workspaceDisplayName: 'Desk C-3',
        workspaceTemplateName: 'Private Office',
        floorName: '3rd Floor',
        bookingStartAt: 'Sep 12, 10:00 AM',
        bookingEndAt: 'Sep 12, 02:00 PM',
        bookingAccessUrl: 'https://deskatlas.test/access/token789',
        bookingToken: 'token789',
        qrIssuedAt: '2026-09-12T01:30:00.000Z',
      });

      assert.ok(email.html.includes('<td>Start Time</td>\n          <td>Sep 12, 10:00 AM</td>'));
      assert.ok(email.html.includes('<td>End Time</td>\n          <td>Sep 12, 02:00 PM</td>'));
      assert.ok(email.text.includes('Start Time: Sep 12, 10:00 AM'));
      assert.ok(email.text.includes('End Time: Sep 12, 02:00 PM'));
    });
  });

  describe('renderReservationTrackingEmail', () => {
    it('renders candidate slot times in 12-hour AM/PM format in both HTML and text', () => {
      const email = renderReservationTrackingEmail({
        referenceCode: 'TRK-2001',
        trackingUrl: 'https://deskatlas.test/track?code=TRK-2001',
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: 'Desk 1',
            floorName: 'Floor 1',
            startAt: '2026-09-12T02:00:00.000Z', // 10:00 AM Manila
            endAt: '2026-09-12T06:00:00.000Z',   // 2:00 PM Manila
          },
          {
            rank: 1,
            workspaceDisplayName: 'Desk 2',
            floorName: 'Floor 1',
            startAt: '14:00',
            endAt: '16:00',
          },
        ],
      });

      // Candidate 0: 10:00 AM to 2:00 PM
      assert.ok(email.html.includes('10:00 AM to 2:00 PM'));
      assert.ok(email.text.includes('(10:00 AM to 2:00 PM)'));

      // Candidate 1: 2:00 PM to 4:00 PM
      assert.ok(email.html.includes('2:00 PM to 4:00 PM'));
      assert.ok(email.text.includes('(2:00 PM to 4:00 PM)'));
    });
  });

  describe('renderBookingEndedSurveyEmail', () => {
    it('renders session start and end times in 12-hour AM/PM format', () => {
      const email = renderBookingEndedSurveyEmail({
        referenceCode: 'SRV-3001',
        workspaceDisplayName: 'Desk 10',
        bookingStartAt: '2026-09-12T02:00:00.000Z', // 10:00 AM Manila
        bookingEndAt: '2026-09-12T06:00:00.000Z',   // 2:00 PM Manila
      });

      assert.ok(email.html.includes('Sep 12, 2026, 10:00 AM &ndash; Sep 12, 2026, 2:00 PM'));
      assert.ok(email.text.includes('Start Time: Sep 12, 2026, 10:00 AM'));
      assert.ok(email.text.includes('End Time: Sep 12, 2026, 2:00 PM'));
    });
  });

  describe('renderReservationCancelledEmail', () => {
    it('formats original schedule in 12-hour AM/PM format', () => {
      const email = renderReservationCancelledEmail({
        to: 'customer@example.com',
        referenceCode: 'CAN-4001',
        cancellationReason: 'Maintenance',
        schedule: 'Sep 15, 09:00 - 11:00',
        workspaceDisplayName: 'Desk D-01',
      });

      assert.ok(email.html.includes('Original Schedule:</strong> Sep 15, 9:00 AM - 11:00 AM'));
      assert.ok(email.text.includes('Original Schedule: Sep 15, 9:00 AM - 11:00 AM'));
    });
  });

  describe('renderReservationRescheduledEmail', () => {
    it('formats old and new schedule in 12-hour AM/PM format', () => {
      const email = renderReservationRescheduledEmail({
        to: 'customer@example.com',
        referenceCode: 'RES-5001',
        oldSchedule: 'Sep 15, 09:00 - 11:00',
        newSchedule: 'Sep 16, 14:00 - 16:00',
        workspaceDisplayName: 'Desk D-02',
      });

      assert.ok(email.html.includes('New Schedule:</strong> Sep 16, 2:00 PM - 4:00 PM'));
      assert.ok(email.html.includes('Previous Schedule:</strong> Sep 15, 9:00 AM - 11:00 AM'));
      assert.ok(email.text.includes('New Schedule: Sep 16, 2:00 PM - 4:00 PM'));
      assert.ok(email.text.includes('Previous Schedule: Sep 15, 9:00 AM - 11:00 AM'));
    });
  });

  describe('Session Expiry Emails', () => {
    it('renders payment link expiry with 12-hour AM/PM format', () => {
      const email = renderPaymentLinkEmail({
        to: 'customer@example.com',
        referenceCode: 'PAY-6001',
        amountDue: 500,
        currency: 'PHP',
        paymentUrl: 'https://deskatlas.test/pay/token',
        expiresAt: '2026-09-12T19:00:00.000Z',
      });

      // 19:00 UTC = 7:00 PM UTC
      assert.ok(email.html.includes('7:00 PM UTC'));
      assert.ok(email.text.includes('7:00 PM UTC'));
    });

    it('renders staff invitation expiry with 12-hour AM/PM format', () => {
      const email = renderStaffInvitationEmail({
        to: 'staff@example.com',
        displayName: 'Maria Santos',
        role: 'STAFF',
        invitationUrl: 'https://deskatlas.test/invite/token',
        expiresAt: '2026-09-12T06:00:00.000Z', // 2:00 PM Manila
      });

      assert.ok(email.html.includes('2:00 PM'));
      assert.ok(email.text.includes('2:00 PM'));
    });

    it('renders admin password reset expiry with 12-hour AM/PM format', () => {
      const email = renderAdminPasswordResetEmail({
        to: 'admin@example.com',
        displayName: 'Admin User',
        resetUrl: 'https://deskatlas.test/reset/token',
        expiresAt: '2026-09-12T06:00:00.000Z', // 2:00 PM Manila
      });

      assert.ok(email.html.includes('2:00 PM'));
      assert.ok(email.text.includes('2:00 PM'));
    });
  });
});
