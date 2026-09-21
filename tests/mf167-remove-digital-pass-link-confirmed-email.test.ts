import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  renderBookingConfirmationEmail,
  renderPaymentLinkEmail,
  renderReservationTrackingEmail,
  renderReservationRescheduledEmail,
  renderReservationRelocatedEmail,
  BookingConfirmationEmailInput,
} from '../packages/domain/src/services/transactionalEmailService';

describe('MF-167: Remove "View Digital Pass" Link from Booking Confirmed Email', () => {
  const sampleConfirmedInput: BookingConfirmationEmailInput = {
    to: 'customer@example.com',
    customerFirstName: 'Maria',
    customerLastName: 'Santos',
    referenceCode: 'DA-20260921-M167',
    workspaceDisplayName: 'Desk 12',
    workspaceTemplateName: 'Dedicated Desk',
    floorName: 'Main Floor',
    bookingStartAt: '2026-09-22T02:00:00.000Z', // 10:00 AM Manila
    bookingEndAt: '2026-09-22T06:00:00.000Z',   // 2:00 PM Manila
    bookingAccessUrl: 'http://localhost:3001/api/booking/tok-sample-123',
    bookingToken: 'tok-sample-123',
    trackingUrl: 'http://localhost:3001/track?code=DA-20260921-M167',
    digitalPassUrl: 'http://localhost:3001/pass/tok-sample-123',
    termsUrl: 'http://localhost:3001/terms',
  };

  describe('1. Absence of View Digital Pass in Confirmed Email', () => {
    it('does not contain "View Digital Pass", "Open Digital Pass", or "View QR Pass" in HTML (case-insensitive)', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.match(email.html, /Booking Confirmed!/i);
      assert.doesNotMatch(email.html, /View Digital Pass/i);
      assert.doesNotMatch(email.html, /Open Digital Pass/i);
      assert.doesNotMatch(email.html, /View QR Pass/i);
    });

    it('does not contain href link to pass URL in HTML', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.ok(!email.html.includes('href="http://localhost:3001/pass/tok-sample-123"'));
      assert.ok(!email.html.includes('/pass/'));
    });

    it('does not contain "View Digital Pass" text or pass link in plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.doesNotMatch(email.text, /View Digital Pass/i);
      assert.doesNotMatch(email.text, /http:\/\/localhost:3001\/pass\//);
    });
  });

  describe('2. Preservation of All Other Confirmed Email Content', () => {
    it('retains the QR code card, instructions, and reference code in HTML and plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      // QR Pass image card remains present
      assert.ok(email.html.includes('Digital Access QR Pass'));
      assert.ok(email.html.includes('alt="Digital Pass QR Code"'));
      assert.ok(email.html.includes('DA-20260921-M167'));
      assert.ok(email.html.includes('Please present this QR code upon arrival at the workspace reception desk or kiosk.'));

      assert.ok(email.text.includes('Digital Access Pass'));
      assert.ok(email.text.includes('QR Code Image:'));
      assert.ok(email.text.includes('Please present this QR code upon arrival at the workspace reception desk or kiosk.'));
    });

    it('retains booking details table and metadata in HTML and plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.ok(email.html.includes('Booking Details'));
      assert.ok(email.html.includes('<code>DA-20260921-M167</code>'));
      assert.ok(email.html.includes('Desk 12 (Dedicated Desk)'));
      assert.ok(email.html.includes('Main Floor'));
      assert.ok(email.html.includes('Sep 22, 2026, 10:00 AM'));
      assert.ok(email.html.includes('Sep 22, 2026, 2:00 PM'));

      assert.ok(email.text.includes('Reference Code: DA-20260921-M167'));
      assert.ok(email.text.includes('Assigned Spot: Desk 12 (Dedicated Desk)'));
      assert.ok(email.text.includes('Floor: Main Floor'));
      assert.ok(email.text.includes('Start Time: Sep 22, 2026, 10:00 AM'));
      assert.ok(email.text.includes('End Time: Sep 22, 2026, 2:00 PM'));
    });

    it('retains house rules, facility guidelines, and terms link', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.ok(email.html.includes('Before Your Booking'));
      assert.ok(email.html.includes('High-Speed WiFi'));
      assert.ok(email.html.includes('Facility Access'));
      assert.ok(email.html.includes('Quiet &amp; Focus Zones'));
      assert.ok(email.html.includes('href="http://localhost:3001/terms"'));
      assert.ok(email.html.includes('View Terms &amp; Conditions'));

      assert.ok(email.text.includes('Before Your Booking'));
      assert.ok(email.text.includes('View Terms & Conditions: http://localhost:3001/terms'));
    });

    it('retains Track Reservation CTA button and link when trackingUrl is provided', () => {
      const email = renderBookingConfirmationEmail(sampleConfirmedInput);

      assert.ok(email.html.includes('href="http://localhost:3001/track?code=DA-20260921-M167"'));
      assert.ok(email.html.includes('Track Reservation'));
      assert.ok(email.text.includes('Track Reservation: http://localhost:3001/track?code=DA-20260921-M167'));
    });
  });

  describe('3. Non-Regression on Other Email Types', () => {
    it('preserves payment link email formatting', () => {
      const email = renderPaymentLinkEmail({
        to: 'customer@example.com',
        customerFirstName: 'Maria',
        customerLastName: 'Santos',
        referenceCode: 'DA-20260921-M167',
        amountDue: 250,
        currency: 'PHP',
        paymentUrl: 'http://localhost:3001/pay/session-1',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      assert.ok(email.html.includes('Proceed to Payment'));
      assert.ok(email.html.includes('PHP 250.00'));
    });

    it('preserves tracking email formatting', () => {
      const email = renderReservationTrackingEmail({
        to: 'customer@example.com',
        customerFirstName: 'Maria',
        referenceCode: 'DA-20260921-M167',
        trackingUrl: 'http://localhost:3001/track?code=DA-20260921-M167',
        status: 'PENDING_PAYMENT',
      });

      assert.ok(email.html.includes('Track Reservation Status'));
      assert.ok(email.html.includes('DA-20260921-M167'));
    });

    it('preserves reschedule email formatting', () => {
      const email = renderReservationRescheduledEmail({
        to: 'customer@example.com',
        customerFirstName: 'Maria',
        referenceCode: 'DA-20260921-M167',
        oldSchedule: 'Sep 22, 10:00 AM - 02:00 PM',
        newSchedule: 'Sep 23, 10:00 AM - 02:00 PM',
        workspaceDisplayName: 'Desk 12',
        actorRole: 'CUSTOMER',
        trackingUrl: 'http://localhost:3001/track?code=DA-20260921-M167',
      });

      assert.ok(email.html.includes('Reservation Schedule Updated'));
      assert.ok(email.html.includes('Updated Schedule Details'));
    });

    it('preserves relocate email formatting', () => {
      const email = renderReservationRelocatedEmail({
        to: 'customer@example.com',
        customerFirstName: 'Maria',
        referenceCode: 'DA-20260921-M167',
        schedule: 'Sep 22, 10:00 AM - 02:00 PM',
        oldWorkspaceDisplayName: 'Desk 12',
        newWorkspaceDisplayName: 'Desk 15',
        relocationReason: 'Maintenance in Zone A',
        trackingUrl: 'http://localhost:3001/track?code=DA-20260921-M167',
      });

      assert.ok(email.html.includes('Workspace Spot Relocation Notice'));
      assert.ok(email.html.includes('Desk 15'));
    });
  });
});
