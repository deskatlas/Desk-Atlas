import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createBookingSurveyService,
  createGuestReservationTrackingService,
  createPaymentSessionService,
  createReservationService,
  createTransactionalEmailService,
  InMemoryWorkspaceRepository,
  renderBookingConfirmationEmail,
  renderBookingEndedSurveyEmail,
  renderPaymentLinkEmail,
  renderPaymentProofReceivedEmail,
  renderReservationTrackingEmail,
  ReservationMemoryRepository,
  TransactionalEmailService,
} from "@deskatlas/domain";

describe("MF-71: Transactional Email Lifecycle & Booking-Ended Survey", () => {
  describe("1. Email 1: DeskAtlas Reservation Payment", () => {
    it("renders payment email with PHP amount, 1-hour session warning, instructions, and payment URL", () => {
      const email = renderPaymentLinkEmail({
        to: "customer@example.com",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        referenceCode: "DA-20260911-PAY1",
        amountDue: 500,
        currency: "PHP",
        paymentUrl: "https://deskatlas.test/pay/token-12345",
        expiresAt: "2026-09-11T13:00:00.000Z",
        trackingUrl: "https://deskatlas.test/track?code=DA-20260911-PAY1",
      });

      assert.equal(email.subject, "DeskAtlas Reservation Payment - Ref #DA-20260911-PAY1");
      assert.ok(email.html.includes("PHP 500.00"));
      assert.ok(email.html.includes("https://deskatlas.test/pay/token-12345"));
      assert.ok(email.html.includes("1-Hour Session"));
      assert.ok(email.html.includes("GCash &amp; Bank Transfer"));
      assert.ok(email.html.includes("DeskAtlas No-Hold Policy"));
      assert.ok(!email.html.includes("https://deskatlas.test/track?code=DA-20260911-PAY1"));
    });
  });

  describe("2. Email 2: DeskAtlas Reservation Status", () => {
    it("renders reservation status email with candidate ranking list, status badge, and tracking link", () => {
      const email = renderReservationTrackingEmail({
        to: "customer@example.com",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        referenceCode: "DA-20260911-STAT2",
        trackingUrl: "https://deskatlas.test/track?code=DA-20260911-STAT2",
        status: "PENDING_PAYMENT",
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: "Hot Desk 01",
            workspaceTemplateName: "Flexible Hot Desk",
            floorName: "2nd Floor",
            startAt: "2026-09-11T09:00:00.000Z",
            endAt: "2026-09-11T12:00:00.000Z",
          },
          {
            rank: 1,
            workspaceDisplayName: "Hot Desk 02",
            workspaceTemplateName: "Flexible Hot Desk",
            floorName: "2nd Floor",
            startAt: "2026-09-11T09:00:00.000Z",
            endAt: "2026-09-11T12:00:00.000Z",
          },
        ],
      });

      assert.equal(email.subject, "DeskAtlas Reservation Status - Ref #DA-20260911-STAT2");
      assert.ok(email.html.includes("DA-20260911-STAT2"));
      assert.ok(email.html.includes("PENDING_PAYMENT"));
      assert.ok(email.html.includes("Main Spot"));
      assert.ok(email.html.includes("Hot Desk 01"));
      assert.ok(email.html.includes("Backup Choice 1"));
      assert.ok(email.html.includes("Hot Desk 02"));
      assert.ok(email.html.includes("Track Reservation Status"));
      assert.ok(email.html.includes("support@deskatlas.com"));
    });
  });

  describe("3. Email 3: Payment Proof Received / Waiting for Admin Approval", () => {
    it("renders proof received email confirming stopped timer and under review state", () => {
      const email = renderPaymentProofReceivedEmail({
        to: "customer@example.com",
        customerFirstName: "Clara",
        customerLastName: "Reyes",
        referenceCode: "DA-20260911-PRF3",
        trackingUrl: "https://deskatlas.test/track?code=DA-20260911-PRF3",
      });

      assert.equal(
        email.subject,
        "Payment Proof Received - Waiting for Admin Approval (Ref #DA-20260911-PRF3)"
      );
      assert.ok(email.html.includes("UNDER REVIEW"));
      assert.ok(email.html.includes("1-hour payment session timer has stopped"));
      assert.ok(email.html.includes("PAYMENT_UNDER_REVIEW"));
      assert.ok(email.html.includes("administration team is currently reviewing"));
      assert.ok(email.html.includes("https://deskatlas.test/track?code=DA-20260911-PRF3"));
    });
  });

  describe("4. Email 4: Booking Confirmed!", () => {
    it("renders booking confirmation email with allocated workspace, QR code pass, and facility guidelines", () => {
      const email = renderBookingConfirmationEmail({
        to: "customer@example.com",
        customerFirstName: "David",
        customerLastName: "Lim",
        referenceCode: "DA-20260911-CONF4",
        workspaceDisplayName: "Private Pod A",
        workspaceTemplateName: "Quiet ThinkPod",
        floorName: "Ground Floor",
        bookingStartAt: "2026-09-11T10:00:00.000Z",
        bookingEndAt: "2026-09-11T14:00:00.000Z",
        bookingAccessUrl: "https://deskatlas.test/api/booking/view/opaque-token-conf4",
        bookingToken: "opaque-token-conf4",
        qrIssuedAt: "2026-09-11T09:45:00.000Z",
        trackingUrl: "https://deskatlas.test/track?code=DA-20260911-CONF4",
      });

      assert.equal(email.subject, "Booking Confirmed! - DeskAtlas Ref #DA-20260911-CONF4");
      assert.ok(email.html.includes("Booking Confirmed! 🎉"));
      assert.ok(email.html.includes("Private Pod A"));
      assert.ok(email.html.includes("Quiet ThinkPod"));
      assert.ok(email.html.includes("Ground Floor"));
      assert.ok(email.html.includes("Digital Access QR Pass"));
      assert.ok(email.html.includes("Facility Guidelines &amp; Amenities"));
      assert.ok(email.html.includes("High-Speed WiFi"));
      assert.ok(email.html.includes("Facility Access"));
      assert.ok(email.html.includes("Quiet &amp; Focus Zones"));
    });
  });

  describe("5. Email 5: Booking Ended & Feedback Survey", () => {
    it("renders booking ended email with configured Google Forms survey CTA and book-again link", () => {
      const email = renderBookingEndedSurveyEmail({
        to: "customer@example.com",
        customerFirstName: "Elena",
        customerLastName: "Torres",
        referenceCode: "DA-20260911-END5",
        workspaceDisplayName: "Desk 14",
        workspaceTemplateName: "Dedicated Workspace",
        floorName: "3rd Floor",
        bookingStartAt: "2026-09-11T08:00:00.000Z",
        bookingEndAt: "2026-09-11T12:00:00.000Z",
        surveyUrl: "https://forms.google.com/custom-deskatlas-survey",
        bookAgainUrl: "https://deskatlas.test/reserve",
        trackingUrl: "https://deskatlas.test/track?code=DA-20260911-END5",
      });

      assert.equal(
        email.subject,
        "Your DeskAtlas Booking Has Ended — We Value Your Feedback!"
      );
      assert.ok(email.html.includes("Thank you for visiting DeskAtlas!"));
      assert.ok(email.html.includes("DA-20260911-END5"));
      assert.ok(email.html.includes("Desk 14"));
      assert.ok(email.html.includes("Dedicated Workspace"));
      assert.ok(email.html.includes("Share Your Feedback (1-Min Survey)"));
      assert.ok(email.html.includes("https://forms.google.com/custom-deskatlas-survey"));
      assert.ok(email.html.includes("Book Another Workspace"));
      assert.ok(email.html.includes("https://deskatlas.test/reserve"));
    });
  });

  describe("6. Automated Dispatch & Survey Deduplication Engine", () => {
    it("processes ended reservations, marks completion, sends survey email, and prevents duplicate dispatches", async () => {
      const reservationRepo = new ReservationMemoryRepository();
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const paymentSessionService = createPaymentSessionService(reservationRepo);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo,
        reservationRepo,
        paymentSessionService
      );

      const floor = await workspaceRepo.createFloor({ name: "Level 1" });
      const template = await workspaceRepo.createTemplate({
        name: "Dedicated Pod",
        capacity: 1,
        rateAmount: 150,
        pricingUnit: "HOURLY",
        defaultShape: "rectangle",
        defaultColor: "#0f172a",
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: "POD-01",
        displayName: "Pod 1",
      });

      // 1. Create a reservation that ended in the past
      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "Marco",
          customerLastName: "Polo",
          customerEmail: "marco@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-09-11T08:00:00.000Z",
              endAt: "2026-09-11T10:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );

      // Simulate payment approval & confirmation
      const stored = reservationRepo.getStoredReservation(res.id);
      assert.ok(stored);
      stored.status = "CONFIRMED";
      stored.candidates[0].isAssigned = true;

      // Track dispatched emails
      const sentEmails: any[] = [];
      const mockEmailService = new TransactionalEmailService({
        fetcher: (async (_url: string, opts: any) => {
          sentEmails.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ id: "msg-123" }), text: async () => "" } as any;
        }) as any,
        apiKey: "re_mock_test_key",
      });

      const surveyService = createBookingSurveyService(reservationRepo, {
        surveyFormUrl: "https://forms.google.com/test-survey",
        emailService: mockEmailService,
      });

      // Execute scan at 11:00 AM (after 10:00 AM end time)
      const scanTime = new Date("2026-09-11T11:00:00.000Z");
      const firstRun = await surveyService.processEndedBookings({ now: scanTime });

      assert.equal(firstRun.scanned, 1);
      assert.equal(firstRun.completed, 1);
      assert.equal(firstRun.surveysSent, 1);
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].to[0], "marco@example.com");
      assert.ok(sentEmails[0].subject.includes("We Value Your Feedback!"));
      assert.ok(sentEmails[0].html.includes("https://forms.google.com/test-survey"));

      // Status transitioned to COMPLETED
      assert.equal(stored.status, "COMPLETED");

      // Verify second execution does NOT send a duplicate email
      const secondRun = await surveyService.processEndedBookings({ now: scanTime });
      assert.equal(secondRun.scanned, 1);
      assert.equal(secondRun.surveysSent, 0); // Guarded by deduplication!
      assert.equal(sentEmails.length, 1); // Still 1
    });

    it("single reservation survey trigger is idempotent", async () => {
      const reservationRepo = new ReservationMemoryRepository();
      const sentEmails: any[] = [];
      const mockEmailService = new TransactionalEmailService({
        fetcher: (async (_url: string, opts: any) => {
          sentEmails.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ id: "msg-456" }), text: async () => "" } as any;
        }) as any,
        apiKey: "re_mock_test_key",
      });

      const surveyService = createBookingSurveyService(reservationRepo, {
        surveyFormUrl: "https://forms.google.com/test-survey",
        emailService: mockEmailService,
      });

      // Manually add ended reservation
      const resId = "res-ended-1";
      await reservationRepo.createReservation(
        {
          source: "WEB",
          customerFirstName: "Sofia",
          customerLastName: "Loren",
          customerEmail: "sofia@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: "inst-1",
              startAt: "2026-09-11T08:00:00.000Z",
              endAt: "2026-09-11T09:00:00.000Z",
            },
          ],
        },
        100,
        100
      );

      const stored = reservationRepo.getStoredReservation(resId) || (reservationRepo as any).reservations[0];
      stored.status = "COMPLETED";

      const firstSent = await surveyService.sendSurveyForReservation(stored.id);
      assert.equal(firstSent, true);
      assert.equal(sentEmails.length, 1);

      // Second attempt returns false and sends nothing
      const secondSent = await surveyService.sendSurveyForReservation(stored.id);
      assert.equal(secondSent, false);
      assert.equal(sentEmails.length, 1);
    });
  });
});
