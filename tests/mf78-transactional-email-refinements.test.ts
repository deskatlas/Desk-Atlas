import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildReservationTrackingUrl,
  createGuestReservationTrackingService,
  createPaymentSessionService,
  createReservationService,
  InMemoryWorkspaceRepository,
  renderBookingConfirmationEmail,
  renderBookingEndedSurveyEmail,
  renderPaymentLinkEmail,
  renderReservationRescheduledEmail,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-78: Transactional Email Refinements & Direct Tracking Result", () => {
  describe("1. Payment Link Email (Email 1)", () => {
    it("does NOT include track live status link or section", () => {
      const email = renderPaymentLinkEmail({
        to: "juan@example.com",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        referenceCode: "421960",
        amountDue: 250,
        currency: "PHP",
        paymentUrl: "http://0.0.0.0:3000/pay/test-pay-token",
        expiresAt: "2026-09-12T19:00:00.000Z",
        trackingUrl: "http://0.0.0.0:3001/track?code=421960",
      });

      assert.equal(email.subject, "DeskAtlas Reservation Payment - Ref #421960");
      assert.ok(email.html.includes("http://0.0.0.0:3000/pay/test-pay-token"));
      assert.ok(email.html.includes("PHP 250.00"));
      // Item 1: Must not include track live status link
      assert.ok(!email.html.includes("Track live status:"));
      assert.ok(!email.html.includes("http://0.0.0.0:3001/track?code=421960"));
      assert.ok(!email.text.includes("Track Reservation:"));
      assert.ok(!email.text.includes("http://0.0.0.0:3001/track?code=421960"));
    });
  });

  describe("2. Live Tracking Link & Direct Tracking Without Credentials", () => {
    it("allows direct reservation tracking with reference code alone without providing customer email", async () => {
      const reservationRepo = new ReservationMemoryRepository();
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const paymentSessionService = createPaymentSessionService(reservationRepo);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo,
        reservationRepo,
        paymentSessionService
      );
      const trackingService = createGuestReservationTrackingService(reservationRepo);

      const floor = await workspaceRepo.createFloor({ name: "1st Floor" });
      const template = await workspaceRepo.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 150,
        pricingUnit: "HOURLY",
        defaultShape: "rectangle",
        defaultColor: "#0284c7",
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: "DD-01",
        displayName: "Desk 01",
      });

      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "Ana",
          customerLastName: "Reyes",
          customerEmail: "ana.reyes@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-09-12T10:00:00.000Z",
              endAt: "2026-09-12T14:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "http://0.0.0.0:3000/pay" }
      );

      // Direct tracking by reference code alone (no email typed by user)
      const trackingDirect = await trackingService.getReservationTracking({
        referenceCode: res.referenceCode,
      });

      assert.equal(trackingDirect.referenceCode, res.referenceCode);
      assert.equal(trackingDirect.status, "PENDING_PAYMENT");
      assert.equal(trackingDirect.amountDue, 600);

      // Also works when email is optionally provided
      const trackingWithEmail = await trackingService.getReservationTracking({
        referenceCode: res.referenceCode,
        customerEmail: "ana.reyes@example.com",
      });
      assert.equal(trackingWithEmail.referenceCode, res.referenceCode);
    });
  });

  describe("3. Booking Confirmed Email (Email 4)", () => {
    it("removes View Digital Pass Online CTA and Direct Pass Link, retaining the QR code card", () => {
      const email = renderBookingConfirmationEmail({
        to: "customer@example.com",
        customerFirstName: "Carlo",
        customerLastName: "Mendoza",
        referenceCode: "421960",
        workspaceDisplayName: "Desk A-1",
        workspaceTemplateName: "Dedicated Desk",
        floorName: "2nd Floor",
        bookingStartAt: "Sep 12, 10:00 AM",
        bookingEndAt: "Sep 12, 02:00 PM",
        bookingAccessUrl: "http://0.0.0.0:3000/api/booking/1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw",
        bookingToken: "1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw",
        qrIssuedAt: "2026-09-12T09:30:00.000Z",
        trackingUrl: "http://0.0.0.0:3001/track?code=421960",
      });

      assert.equal(email.subject, "Booking Confirmed! - DeskAtlas Ref #421960");
      // Item 3: Digital Pass button and Direct Pass Link removed
      assert.ok(!email.html.includes("View Digital Pass Online"));
      assert.ok(!email.html.includes("Direct Pass Link:"));
      assert.ok(!email.html.includes("http://0.0.0.0:3000/api/booking/1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw"));
      assert.ok(!email.text.includes("Digital Pass / Booking QR Link:"));

      // QR Pass image card remains present
      assert.ok(email.html.includes("Digital Access QR Pass"));
      assert.ok(email.html.includes("alt=\"Digital Pass QR Code\""));
      assert.ok(email.html.includes("421960"));
      assert.ok(email.text.includes("QR Code Image:"));
    });

    it("normalizes tracking URL port 3000 to port 3001 in booking confirmed email", () => {
      const email = renderBookingConfirmationEmail({
        to: "customer@example.com",
        customerFirstName: "Carlo",
        customerLastName: "Mendoza",
        referenceCode: "430500",
        workspaceDisplayName: "Desk A-1",
        workspaceTemplateName: "Dedicated Desk",
        floorName: "2nd Floor",
        bookingStartAt: "Sep 12, 10:00 AM",
        bookingEndAt: "Sep 12, 02:00 PM",
        bookingAccessUrl: "http://0.0.0.0:3000/api/booking/token123",
        bookingToken: "token123",
        qrIssuedAt: "2026-09-12T09:30:00.000Z",
        trackingUrl: "http://0.0.0.0:3000/track?code=430500",
      });

      assert.ok(email.html.includes("http://0.0.0.0:3001/track?code=430500"));
      assert.ok(!email.html.includes("http://0.0.0.0:3000/track?code=430500"));
      assert.ok(email.text.includes("http://0.0.0.0:3001/track?code=430500"));
      assert.ok(!email.text.includes("http://0.0.0.0:3000/track?code=430500"));
    });

    it("buildReservationTrackingUrl maps port 3000, 3002, 3003 to customer website port 3001", () => {
      assert.equal(
        buildReservationTrackingUrl("http://0.0.0.0:3000", "430500"),
        "http://0.0.0.0:3001/track?code=430500"
      );
      assert.equal(
        buildReservationTrackingUrl("http://localhost:3003", "430500"),
        "http://localhost:3001/track?code=430500"
      );
      assert.equal(
        buildReservationTrackingUrl("http://0.0.0.0:3002", "430500"),
        "http://0.0.0.0:3001/track?code=430500"
      );
    });
  });

  describe("4. Reschedules Email", () => {
    it("removes direct pass link and CTA, but renders the QR code pass card", () => {
      const email = renderReservationRescheduledEmail({
        to: "customer@example.com",
        customerFirstName: "Carlo",
        customerLastName: "Mendoza",
        referenceCode: "421960",
        oldSchedule: "Sep 12, 10:00 - 12:00",
        newSchedule: "Sep 12, 14:00 - 16:00",
        workspaceDisplayName: "Desk A-1",
        floorName: "2nd Floor",
        bookingAccessUrl: "http://0.0.0.0:3000/api/booking/1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw",
        bookingToken: "1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw",
        trackingUrl: "http://0.0.0.0:3001/track?code=421960",
      });

      assert.equal(email.subject, "Your DeskAtlas Reservation Has Been Rescheduled [421960]");
      // Item 4: Direct pass link and CTA removed
      assert.ok(!email.html.includes("View Digital Access Pass"));
      assert.ok(!email.html.includes("http://0.0.0.0:3000/api/booking/1_haVlnWHUe8R4zjGpxJrhgMIiFkWf2fBapM5DZRcQw"));
      assert.ok(!email.text.includes("Access Pass:"));

      // Item 4: QR Code Pass card is rendered
      assert.ok(email.html.includes("Digital Access QR Pass"));
      assert.ok(email.html.includes("alt=\"Digital Pass QR Code\""));
      assert.ok(email.html.includes("421960"));
      assert.ok(email.text.includes("Digital Access QR Pass:"));
    });
  });

  describe("5. Survey Email (Email 5)", () => {
    it("adds a fallback link to Google Forms if CTA is not working", () => {
      const email = renderBookingEndedSurveyEmail({
        to: "customer@example.com",
        customerFirstName: "Elena",
        customerLastName: "Torres",
        referenceCode: "421960",
        workspaceDisplayName: "Desk 14",
        surveyUrl: "https://forms.gle/LogUg86kGi2pveEZ8",
        bookAgainUrl: "http://0.0.0.0:3001/reserve",
        trackingUrl: "http://0.0.0.0:3001/track?code=421960",
      });

      assert.equal(email.subject, "Your DeskAtlas Booking Has Ended — We Value Your Feedback!");
      // CTA button exists
      assert.ok(email.html.includes("Share Your Feedback (1-Min Survey)"));
      // Item 5: Fallback link rendered
      assert.ok(email.html.includes("If the button above does not work, access the feedback form directly:"));
      assert.ok(email.html.includes("https://forms.gle/LogUg86kGi2pveEZ8"));
      assert.ok(email.text.includes("Survey Link: https://forms.gle/LogUg86kGi2pveEZ8"));
    });
  });
});
