import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BookingAccessService,
  createBookingAccessService,
  extractBookingToken,
  hashBookingToken,
  ReservationMemoryRepository,
  type AdminReservationDetail,
  renderBookingConfirmationEmail,
} from "@deskatlas/domain";
import {
  canViewBookingQr,
  getBookingQrValue,
} from "../apps/admin-portal/src/features/reservations/components/ReservationDetail";

describe("MF-58: Admin View QR Code Fix (PRD-F6, PRD-F7)", () => {
  describe("Booking Token Persistence & getAdminReservationDetail", () => {
    it("persists bookingToken in repository when issueBookingAccess is called and returns it in Admin detail", async () => {
      const repo = new ReservationMemoryRepository();
      const bookingAccessService = new BookingAccessService(repo);

      // Create a reservation and set it to CONFIRMED with assigned candidate
      const reservation = await repo.createReservation({
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "desk-01",
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T13:00:00.000Z",
          },
        ],
      });

      // Confirm reservation
      const stored = repo["reservations"].find((r) => r.id === reservation.id)!;
      stored.status = "CONFIRMED";
      stored.confirmedAt = new Date().toISOString();
      stored.candidates[0].isAssigned = true;

      // Issue booking access
      const accessUrlBase = "https://deskatlas.test/booking";
      const issueResult = await bookingAccessService.issueBookingAccess(
        reservation.id,
        reservation.referenceCode,
        accessUrlBase
      );

      assert.ok(issueResult, "Booking access should be issued");
      assert.ok(issueResult.token, "Opaque token should be present");
      assert.equal(issueResult.accessUrl, `https://deskatlas.test/booking/${encodeURIComponent(issueResult.token)}`);

      // Verify repository stored both hash and raw token
      assert.equal(stored.bookingToken, issueResult.token);
      assert.equal(stored.bookingTokenHash, hashBookingToken(issueResult.token));
      assert.ok(stored.qrIssuedAt);

      // Verify getAdminReservationDetail includes bookingToken and bookingAccessUrl
      const detail = await repo.getAdminReservationDetail(reservation.id);
      assert.ok(detail, "Reservation detail should exist");
      assert.equal(detail.bookingToken, issueResult.token);
      assert.equal(detail.bookingAccessUrl, issueResult.accessUrl);
      assert.equal(detail.hasBookingQr, true);
    });

    it("does not expose booking token on unconfirmed reservations", async () => {
      const repo = new ReservationMemoryRepository();
      const reservation = await repo.createReservation({
        source: "WEB",
        customerFirstName: "Bob",
        customerLastName: "Jones",
        customerEmail: "bob@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "desk-02",
            startAt: "2026-09-09T09:00:00.000Z",
            endAt: "2026-09-09T13:00:00.000Z",
          },
        ],
      });

      const detail = await repo.getAdminReservationDetail(reservation.id);
      assert.ok(detail);
      assert.equal(detail.bookingToken, null);
      assert.equal(detail.bookingAccessUrl, null);
      assert.equal(detail.hasBookingQr, false);
    });
  });

  describe("QR Value Generation & Parity with Email & Camera Scanner", () => {
    it("generates QR payload matching confirmation email and extractable by scanner", async () => {
      const token = "secure-opaque-token-xyz123";
      const accessUrl = `https://deskatlas.test/booking/${encodeURIComponent(token)}`;
      const sampleDetail: AdminReservationDetail = {
        id: "res-uuid-1",
        referenceCode: "REF-5801",
        source: "WEB",
        customerFirstName: "Clara",
        customerLastName: "Oswald",
        customerName: "Clara Oswald",
        customerInitials: "CO",
        customerEmail: "clara@example.com",
        reservationStatus: "CONFIRMED",
        status: "Confirmed",
        statusStyle: { background: "#dcfce7", color: "#166534" },
        mark: "✓",
        schedule: "9:00 AM - 1:00 PM",
        duration: "4 hours",
        paymentStatus: "Paid",
        paymentColor: "#22c55e",
        amountDue: 500,
        currency: "PHP",
        rateSnapshot: 500,
        createdAt: "2026-09-08T08:00:00.000Z",
        updatedAt: "2026-09-08T08:05:00.000Z",
        confirmedAt: "2026-09-08T08:05:00.000Z",
        qrIssuedAt: "2026-09-08T08:05:00.000Z",
        hasBookingQr: true,
        bookingToken: token,
        bookingAccessUrl: accessUrl,
        assignedCandidate: null,
        candidates: [],
        timeline: [],
      };

      // Admin QR value
      const qrValue = getBookingQrValue(sampleDetail);
      assert.equal(qrValue, accessUrl);

      // Email rendered QR target
      const emailRender = renderBookingConfirmationEmail({
        referenceCode: sampleDetail.referenceCode,
        customerFirstName: sampleDetail.customerFirstName,
        customerLastName: sampleDetail.customerLastName,
        bookingAccessUrl: sampleDetail.bookingAccessUrl!,
        bookingToken: sampleDetail.bookingToken!,
        workspaceDisplayName: "Desk 01",
        workspaceTemplateName: "Dedicated Desk",
        floorName: "2nd Floor",
        bookingStartAt: "2026-09-09T09:00:00.000Z",
        bookingEndAt: "2026-09-09T13:00:00.000Z",
      });

      // Verify email qrImageUrl encodes the same bookingAccessUrl
      assert.ok(emailRender.html.includes(encodeURIComponent(accessUrl)));

      // Verify scanner utility extracts token from the QR payload
      const extractedToken = extractBookingToken(qrValue);
      assert.equal(extractedToken, token);
    });

    it("falls back to raw bookingToken if bookingAccessUrl is not present", () => {
      const sampleDetail: AdminReservationDetail = {
        id: "res-uuid-2",
        referenceCode: "REF-5802",
        source: "KIOSK",
        customerFirstName: "Donna",
        customerLastName: "Noble",
        customerName: "Donna Noble",
        customerInitials: "DN",
        customerEmail: "donna@example.com",
        reservationStatus: "CONFIRMED",
        status: "Confirmed",
        statusStyle: { background: "#dcfce7", color: "#166534" },
        mark: "✓",
        schedule: "10:00 AM - 12:00 PM",
        duration: "2 hours",
        paymentStatus: "Paid",
        paymentColor: "#22c55e",
        amountDue: 300,
        currency: "PHP",
        rateSnapshot: 300,
        createdAt: "2026-09-08T08:00:00.000Z",
        updatedAt: "2026-09-08T08:05:00.000Z",
        confirmedAt: "2026-09-08T08:05:00.000Z",
        qrIssuedAt: "2026-09-08T08:05:00.000Z",
        hasBookingQr: true,
        bookingToken: "raw-kiosk-token-abc",
        assignedCandidate: null,
        candidates: [],
        timeline: [],
      };

      const qrValue = getBookingQrValue(sampleDetail);
      assert.equal(qrValue, "raw-kiosk-token-abc");
      assert.equal(extractBookingToken(qrValue), "raw-kiosk-token-abc");
    });
  });

  describe("Button Visibility Rules (canViewBookingQr)", () => {
    const baseDetail: AdminReservationDetail = {
      id: "res-test",
      referenceCode: "REF-TEST",
      source: "WEB",
      customerFirstName: "Test",
      customerLastName: "User",
      customerName: "Test User",
      customerInitials: "TU",
      customerEmail: "test@example.com",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "#dcfce7", color: "#166534" },
      mark: "✓",
      schedule: "9:00 AM - 1:00 PM",
      duration: "4 hours",
      paymentStatus: "Paid",
      paymentColor: "#22c55e",
      amountDue: 500,
      currency: "PHP",
      rateSnapshot: 500,
      createdAt: "2026-09-08T08:00:00.000Z",
      updatedAt: "2026-09-08T08:05:00.000Z",
      confirmedAt: "2026-09-08T08:05:00.000Z",
      qrIssuedAt: "2026-09-08T08:05:00.000Z",
      hasBookingQr: true,
      bookingToken: "token-123",
      assignedCandidate: null,
      candidates: [],
      timeline: [],
    };

    it("returns true for CONFIRMED reservations with booking token", () => {
      assert.equal(canViewBookingQr({ ...baseDetail, reservationStatus: "CONFIRMED" }), true);
    });

    it("returns true for CHECKED_IN reservations with booking token", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          reservationStatus: "CHECKED_IN",
          checkedInAt: "2026-09-08T09:00:00.000Z",
        }),
        true
      );
    });

    it("returns false for PENDING_PAYMENT reservations", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          reservationStatus: "PENDING_PAYMENT",
          bookingToken: null,
          hasBookingQr: false,
        }),
        false
      );
    });

    it("returns false for PAYMENT_UNDER_REVIEW reservations", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          reservationStatus: "PAYMENT_UNDER_REVIEW",
          bookingToken: null,
          hasBookingQr: false,
        }),
        false
      );
    });

    it("returns false for EXPIRED reservations", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          reservationStatus: "EXPIRED",
          bookingToken: null,
          hasBookingQr: false,
        }),
        false
      );
    });

    it("returns false for CANCELLED reservations (or revoked QR)", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          reservationStatus: "CANCELLED",
          qrRevokedAt: "2026-09-08T10:00:00.000Z",
          hasBookingQr: false,
        }),
        false
      );
    });

    it("returns false when detail is null", () => {
      assert.equal(canViewBookingQr(null), false);
    });

    it("returns false if confirmed reservation does not have any booking token or QR", () => {
      assert.equal(
        canViewBookingQr({
          ...baseDetail,
          bookingToken: null,
          bookingAccessUrl: null,
          hasBookingQr: false,
        }),
        false
      );
    });
  });
});
