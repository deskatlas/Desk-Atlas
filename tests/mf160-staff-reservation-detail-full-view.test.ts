import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  BookingAccessService,
  createStaffOperationsService,
  createAdminReservationService,
  extractBookingToken,
  hashBookingToken,
  ReservationMemoryRepository,
  type AdminReservationDetail,
} from "@deskatlas/domain";
import {
  canViewBookingQr,
  getBookingQrValue,
} from "../apps/staff-dashboard/src/features/reservations/components/ReservationDetail";

describe("MF-160: Staff Full Reservation Detail View Access (Timeline, Details, Payment History, QR)", () => {
  it("allows Staff actor to retrieve full reservation details with timeline, candidates, and payment history", async () => {
    const repo = new ReservationMemoryRepository();
    const staffService = createStaffOperationsService(repo);
    const bookingAccessService = new BookingAccessService(repo);

    // Create reservation
    const reservation = await repo.createReservation({
      source: "WEB",
      customerFirstName: "John",
      customerLastName: "Doe",
      customerEmail: "john.doe@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "desk-01",
          startAt: "2026-09-22T09:00:00.000Z",
          endAt: "2026-09-22T13:00:00.000Z",
        },
      ],
    });

    // Confirm reservation and assign candidate
    const stored = repo["reservations"].find((r) => r.id === reservation.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = new Date().toISOString();
    stored.candidates[0].isAssigned = true;

    // Issue booking QR access
    const accessUrlBase = "https://deskatlas.test/booking";
    const issueResult = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      accessUrlBase
    );

    // Staff retrieves full reservation detail
    const detail = await staffService.getReservationDetail(reservation.id, "STAFF");
    assert.ok(detail, "Staff should be able to retrieve reservation detail");
    assert.equal(detail.referenceCode, reservation.referenceCode);
    assert.equal(detail.customerFirstName, "John");
    assert.equal(detail.customerLastName, "Doe");
    assert.equal(detail.customerEmail, "john.doe@example.com");
    assert.equal(detail.reservationStatus, "CONFIRMED");
    assert.equal(detail.bookingToken, issueResult.token);
    assert.equal(detail.bookingAccessUrl, issueResult.accessUrl);
    assert.equal(detail.hasBookingQr, true);
    assert.ok(Array.isArray(detail.timeline), "Timeline should be an array");
    assert.ok(detail.timeline.length > 0, "Timeline should have events");
  });

  it("allows Staff actor to retrieve the reservation timeline", async () => {
    const repo = new ReservationMemoryRepository();
    const staffService = createStaffOperationsService(repo);

    const reservation = await repo.createReservation({
      source: "WEB",
      customerFirstName: "Sarah",
      customerLastName: "Connor",
      customerEmail: "sarah@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "desk-02",
          startAt: "2026-09-22T10:00:00.000Z",
          endAt: "2026-09-22T14:00:00.000Z",
        },
      ],
    });

    const timeline = await staffService.getReservationTimeline(reservation.id, "STAFF");
    assert.ok(Array.isArray(timeline), "Timeline should be an array");
    assert.ok(
      timeline.some((t) => t.toLowerCase().includes("reservation requested")),
      "Timeline should contain creation event"
    );
  });

  it("allows Staff actor to retrieve the payment history including proof metadata", async () => {
    const repo = new ReservationMemoryRepository();
    const staffService = createStaffOperationsService(repo);

    const reservation = await repo.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alex",
        customerLastName: "Murphy",
        customerEmail: "alex@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: "desk-03",
            startAt: "2026-09-22T11:00:00.000Z",
            endAt: "2026-09-22T15:00:00.000Z",
          },
        ],
      },
      150,
      600,
      {
        paymentAttemptId: "attempt-alex-1",
        token: "tok-alex",
        tokenHash: "hash-alex",
        paymentUrl: "https://pay.test/alex",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }
    );

    const paymentHistory = await staffService.getPaymentHistory(reservation.id, "STAFF");
    assert.ok(Array.isArray(paymentHistory), "Payment history should be an array");
    assert.ok(paymentHistory.length > 0, "Payment history should have recorded attempt");
    assert.equal(paymentHistory[0].channel, "WEB");
  });

  it("allows Staff actor to retrieve booking QR token for CONFIRMED reservations", async () => {
    const repo = new ReservationMemoryRepository();
    const staffService = createStaffOperationsService(repo);
    const bookingAccessService = new BookingAccessService(repo);

    const reservation = await repo.createReservation({
      source: "WEB",
      customerFirstName: "Ellen",
      customerLastName: "Ripley",
      customerEmail: "ripley@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "desk-04",
          startAt: "2026-09-22T08:00:00.000Z",
          endAt: "2026-09-22T12:00:00.000Z",
        },
      ],
    });

    const stored = repo["reservations"].find((r) => r.id === reservation.id)!;
    stored.status = "CONFIRMED";
    stored.confirmedAt = new Date().toISOString();
    stored.candidates[0].isAssigned = true;

    const issueResult = await bookingAccessService.issueBookingAccess(
      reservation.id,
      reservation.referenceCode,
      "https://deskatlas.test/booking"
    );

    const qrData = await staffService.getBookingQrToken(reservation.id, "STAFF");
    assert.ok(qrData, "QR data should be returned");
    assert.equal(qrData.bookingToken, issueResult.token);
    assert.equal(qrData.bookingAccessUrl, issueResult.accessUrl);
    assert.equal(qrData.hasBookingQr, true);
    assert.equal(qrData.referenceCode, reservation.referenceCode);
  });

  it("prevents Staff actor from cancelling a reservation (unauthorized / forbidden)", async () => {
    const repo = new ReservationMemoryRepository();
    const adminService = createAdminReservationService(repo);

    const reservation = await repo.createReservation({
      source: "WEB",
      customerFirstName: "Dana",
      customerLastName: "Scully",
      customerEmail: "scully@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "desk-05",
          startAt: "2026-09-22T09:00:00.000Z",
          endAt: "2026-09-22T13:00:00.000Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await adminService.cancelReservation({
          reservationId: reservation.id,
          reason: "Customer Request",
          actorRole: "STAFF",
        });
      },
      /Staff members are not authorized to cancel reservations/i,
      "Staff role should be rejected from cancelling reservations"
    );
  });

  it("prevents Staff actor from rescheduling a reservation (unauthorized / forbidden)", async () => {
    const repo = new ReservationMemoryRepository();
    const adminService = createAdminReservationService(repo);

    const reservation = await repo.createReservation({
      source: "WEB",
      customerFirstName: "Fox",
      customerLastName: "Mulder",
      customerEmail: "mulder@example.com",
      candidates: [
        {
          rank: 0,
          workspaceInstanceId: "desk-06",
          startAt: "2026-09-22T09:00:00.000Z",
          endAt: "2026-09-22T13:00:00.000Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await adminService.rescheduleReservation({
          reservationId: reservation.id,
          startAt: "2026-09-23T09:00:00.000Z",
          endAt: "2026-09-23T13:00:00.000Z",
          actorRole: "STAFF",
        });
      },
      /Staff members are not authorized to reschedule reservations/i,
      "Staff role should be rejected from rescheduling reservations"
    );
  });

  describe("canViewBookingQr and getBookingQrValue helpers in Staff view", () => {
    it("evaluates QR visibility correctly for Staff view", () => {
      assert.equal(
        canViewBookingQr({
          reservationStatus: "CONFIRMED",
          bookingToken: "tok-123",
          hasBookingQr: true,
        }),
        true
      );

      assert.equal(
        canViewBookingQr({
          reservationStatus: "CHECKED_IN",
          bookingAccessUrl: "https://deskatlas.test/booking/tok-123",
          hasBookingQr: true,
        }),
        true
      );

      assert.equal(
        canViewBookingQr({
          reservationStatus: "PENDING_PAYMENT",
          bookingToken: null,
          hasBookingQr: false,
        }),
        false
      );

      assert.equal(
        canViewBookingQr({
          reservationStatus: "CONFIRMED",
          bookingToken: "tok-123",
          qrRevokedAt: "2026-09-22T10:00:00.000Z",
        }),
        false
      );

      assert.equal(canViewBookingQr(null), false);
    });

    it("extracts QR value correctly for Staff view", () => {
      const detail = {
        referenceCode: "REF-160",
        bookingToken: "token-staff-123",
        bookingAccessUrl: "https://deskatlas.test/booking/token-staff-123",
      };
      assert.equal(getBookingQrValue(detail), "https://deskatlas.test/booking/token-staff-123");
      assert.equal(extractBookingToken(getBookingQrValue(detail)), "token-staff-123");
    });
  });
});
