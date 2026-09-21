import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  renderBookingConfirmationEmail,
  BookingConfirmationEmailInput,
} from '../packages/domain/src/services/transactionalEmailService';

describe('MF-143: Booking Confirmed Email Details, Arrival Expectations, House Rules & Relocation Guidance', () => {
  const sampleInput: BookingConfirmationEmailInput = {
    to: 'jane.smith@example.com',
    customerFirstName: 'Jane',
    customerLastName: 'Smith',
    referenceCode: 'DA-20260919-X89',
    workspaceDisplayName: 'Desk A-04',
    workspaceTemplateName: 'Dedicated Desk',
    floorName: '2nd Floor',
    bookingStartAt: '2026-09-19T05:00:00.000Z', // 1:00 PM Manila
    bookingEndAt: '2026-09-19T08:00:00.000Z',   // 4:00 PM Manila
    bookingAccessUrl: 'http://localhost:3001/api/booking/token-xyz-123',
    bookingToken: 'token-xyz-123',
    qrIssuedAt: '2026-09-19T04:30:00.000Z',
    trackingUrl: 'http://localhost:3001/track?code=DA-20260919-X89',
    digitalPassUrl: 'http://localhost:3001/pass/token-xyz-123',
    termsUrl: 'http://localhost:3001/terms',
  };

  describe('1. Booking Details Layout and Content', () => {
    it('renders header, greeting, and all booking details correctly in HTML', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.equal(email.subject, 'Booking Confirmed! - DeskAtlas Ref #DA-20260919-X89');
      assert.ok(email.html.includes('CONFIRMED'));
      assert.ok(email.html.includes('Hello Jane Smith,'));
      assert.ok(email.html.includes('Your workspace reservation is confirmed. Here are your booking details:'));

      // Section title
      assert.ok(email.html.includes('Booking Details'));

      // Metadata Table rows
      assert.ok(email.html.includes('<code>DA-20260919-X89</code>'));
      assert.ok(email.html.includes('Desk A-04 (Dedicated Desk)'));
      assert.ok(email.html.includes('2nd Floor'));
      assert.ok(email.html.includes('Sep 19, 2026, 1:00 PM'));
      assert.ok(email.html.includes('Sep 19, 2026, 4:00 PM'));
    });

    it('renders all booking details accurately in plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.ok(email.text.includes('Booking Confirmed! - DeskAtlas Ref #DA-20260919-X89'));
      assert.ok(email.text.includes('Hello Jane Smith,'));
      assert.ok(email.text.includes('Booking Details'));
      assert.ok(email.text.includes('Reference Code: DA-20260919-X89'));
      assert.ok(email.text.includes('Assigned Spot: Desk A-04 (Dedicated Desk)'));
      assert.ok(email.text.includes('Floor: 2nd Floor'));
      assert.ok(email.text.includes('Start Time: Sep 19, 2026, 1:00 PM'));
      assert.ok(email.text.includes('End Time: Sep 19, 2026, 4:00 PM'));
    });
  });

  describe('2. Digital Access Pass & Dual Action CTAs', () => {
    it('renders high-res QR code card with arrival instruction copy', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.ok(email.html.includes('Digital Access QR Pass'));
      assert.ok(email.html.includes('alt="Digital Pass QR Code"'));
      assert.ok(email.html.includes('DA-20260919-X89'));
      assert.ok(
        email.html.includes('Please present this QR code upon arrival at the workspace reception desk or kiosk.')
      );
      assert.ok(
        email.text.includes('Please present this QR code upon arrival at the workspace reception desk or kiosk.')
      );
    });

    it('renders [Track Reservation] button in HTML and plaintext without [View Digital Pass]', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      // HTML buttons
      assert.ok(!email.html.includes('View Digital Pass'));
      assert.ok(!email.html.includes('href="http://localhost:3001/pass/token-xyz-123"'));
      assert.ok(email.html.includes('href="http://localhost:3001/track?code=DA-20260919-X89"'));
      assert.ok(email.html.includes('Track Reservation'));

      // Plaintext links
      assert.ok(!email.text.includes('View Digital Pass'));
      assert.ok(email.text.includes('Track Reservation: http://localhost:3001/track?code=DA-20260919-X89'));
    });
  });

  describe('3. Before Your Booking, House Rules, Relocation & Extension Guidance', () => {
    it('renders exact rules copy on workspace usage, relocation, extension, and staff assistance in HTML', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.ok(email.html.includes('Before Your Booking'));
      assert.ok(
        email.html.includes(
          'Please use only your assigned workspace and observe the applicable booking rules during your stay.'
        )
      );
      assert.ok(
        email.html.includes(
          'If you need to relocate to another workspace, extend your booking time, or require assistance, please approach a Staff member. Relocation and extension requests are subject to workspace availability and existing reservations.'
        )
      );
    });

    it('renders exact rules copy on workspace usage, relocation, extension, and staff assistance in plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.ok(email.text.includes('Before Your Booking'));
      assert.ok(
        email.text.includes(
          'Please use only your assigned workspace and observe the applicable booking rules during your stay.'
        )
      );
      assert.ok(
        email.text.includes(
          'If you need to relocate to another workspace, extend your booking time, or require assistance, please approach a Staff member. Relocation and extension requests are subject to workspace availability and existing reservations.'
        )
      );
    });

    it('renders [View Terms & Conditions] link in HTML and plaintext', () => {
      const email = renderBookingConfirmationEmail(sampleInput);

      assert.ok(email.html.includes('href="http://localhost:3001/terms"'));
      assert.ok(email.html.includes('View Terms &amp; Conditions'));
      assert.ok(email.text.includes('View Terms & Conditions: http://localhost:3001/terms'));
    });
  });

  describe('4. Defaults and Fallback Inference', () => {
    it('infers termsUrl when not explicitly provided and omits digital pass link', () => {
      const fallbackInput: BookingConfirmationEmailInput = {
        referenceCode: 'BK-FALLBACK-1',
        customerFirstName: 'Alex',
        workspaceDisplayName: 'Meeting Pod 3',
        workspaceTemplateName: 'Team Pod',
        floorName: 'Ground Floor',
        bookingStartAt: '10:00 AM',
        bookingEndAt: '12:00 PM',
        bookingToken: 'tok-fb-456',
        trackingUrl: 'https://deskatlas.app/track?code=BK-FALLBACK-1',
      };

      const email = renderBookingConfirmationEmail(fallbackInput);

      assert.ok(email.html.includes('href="https://deskatlas.app/terms"'));
      assert.ok(!email.html.includes('View Digital Pass'));
      assert.ok(!email.text.includes('View Digital Pass'));
      assert.ok(email.text.includes('View Terms & Conditions: https://deskatlas.app/terms'));
    });

    it('handles customer with single name or missing last name gracefully', () => {
      const singleNameInput: BookingConfirmationEmailInput = {
        referenceCode: 'BK-SINGLE-1',
        customerFirstName: 'Madonna',
        workspaceDisplayName: 'Solo Desk',
        workspaceTemplateName: 'Hot Desk',
        floorName: '1st Floor',
        bookingStartAt: '09:00 AM',
        bookingEndAt: '05:00 PM',
      };

      const email = renderBookingConfirmationEmail(singleNameInput);
      assert.ok(email.html.includes('Hello Madonna,'));
      assert.ok(email.text.includes('Hello Madonna,'));
    });
  });
});
