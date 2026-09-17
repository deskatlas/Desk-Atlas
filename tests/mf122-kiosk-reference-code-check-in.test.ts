import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createBookingAccessService,
  createPaymentReviewService,
  createPaymentSessionService,
  createReservationService,
  extractBookingToken,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  BookingAccessError,
} from "@deskatlas/domain";

async function createKioskTestContext() {
  const reservationRepo = new ReservationMemoryRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  let currentTime = new Date("2026-09-14T08:00:00.000Z");
  const nowProvider = () => currentTime;

  const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
  const reservationService = createReservationService(
    reservationRepo,
    workspaceRepo,
    reservationRepo,
    paymentSessionService
  );
  const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
  const bookingAccessService = createBookingAccessService(reservationRepo, nowProvider);

  const floor = await workspaceRepo.createFloor({ name: "Ground Floor" });
  const template = await workspaceRepo.createTemplate({
    name: "Hot Desk",
    capacity: 1,
    rateAmount: 100,
    pricingUnit: "HOURLY",
    defaultShape: "rectangle",
    defaultColor: "#0f172a",
    isActive: true,
  });
  const instance = await workspaceRepo.createInstance({
    templateId: template.id,
    floorId: floor.id,
    instanceCode: "HD-01",
    displayName: "Hot Desk 1",
  });

  const helperCreateAndConfirm = async (startAt: string, endAt: string) => {
    const res = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alex",
        customerLastName: "Rivera",
        customerEmail: "alex@example.com",
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt,
            endAt,
          },
        ],
      },
      { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: "pm-gcash",
      proofStoragePath: "proofs/test.png",
    });
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: "admin-1", role: "ADMIN" },
      decision: "APPROVE",
    });

    const issue = await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      "https://deskatlas.test/access"
    );

    return { reservation: res, issue };
  };

  return {
    reservationRepo,
    workspaceRepo,
    bookingAccessService,
    setTime: (d: Date) => {
      currentTime = d;
    },
    helperCreateAndConfirm,
  };
}

describe("MF-122: Kiosk Reference ID / Reference Code Check-In & Re-Entry", () => {
  it("extractBookingToken parses reference code, lowercase code, UUID, and tracking URLs", () => {
    assert.equal(extractBookingToken("DA-2026-00042"), "DA-2026-00042");
    assert.equal(extractBookingToken("da-2026-00042"), "da-2026-00042");
    assert.equal(
      extractBookingToken("123e4567-e89b-12d3-a456-426614174000"),
      "123e4567-e89b-12d3-a456-426614174000"
    );
    assert.equal(
      extractBookingToken("https://deskatlas.test/track?code=DA-2026-00042"),
      "DA-2026-00042"
    );
    assert.equal(
      extractBookingToken(JSON.stringify({ referenceCode: "DA-2026-00042" })),
      "DA-2026-00042"
    );
  });

  it("automatically checks in guest when entering reference code on-time at kiosk", async () => {
    const ctx = await createKioskTestContext();
    const startAt = "2026-09-14T09:00:00.000Z";
    const endAt = "2026-09-14T11:00:00.000Z";
    const { reservation } = await ctx.helperCreateAndConfirm(startAt, endAt);

    // Guest arrives at kiosk at 9:05 AM (on time within window)
    ctx.setTime(new Date("2026-09-14T09:05:00.000Z"));

    const scanResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: null, role: "STAFF" }
    );

    assert.equal(scanResult.accessState, "ACTIVE");
    assert.equal(scanResult.checkInState, "CHECKED_IN");
    assert.equal(scanResult.reservationStatus, "CHECKED_IN");
    assert.equal(scanResult.checkedInAt, "2026-09-14T09:05:00.000Z");
    assert.equal(scanResult.reentry, false);
    assert.equal(scanResult.referenceCode, reservation.referenceCode);
    assert.equal(scanResult.customerName, "Alex Rivera");
  });

  it("identifies authorized re-entry when guest enters reference code while already checked in", async () => {
    const ctx = await createKioskTestContext();
    const startAt = "2026-09-14T09:00:00.000Z";
    const endAt = "2026-09-14T11:00:00.000Z";
    const { reservation } = await ctx.helperCreateAndConfirm(startAt, endAt);

    // Initial check-in at 9:00 AM
    ctx.setTime(new Date("2026-09-14T09:00:00.000Z"));
    await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: null, role: "STAFF" }
    );

    // Guest steps out and returns to kiosk at 9:45 AM
    ctx.setTime(new Date("2026-09-14T09:45:00.000Z"));
    const reentryResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: null, role: "STAFF" }
    );

    assert.equal(reentryResult.accessState, "ACTIVE");
    assert.equal(reentryResult.checkInState, "CHECKED_IN");
    assert.equal(reentryResult.reentry, true);
    assert.equal(reentryResult.checkedInAt, "2026-09-14T09:00:00.000Z");
  });

  it("returns NOT_ACTIVE status when guest enters reference code too early", async () => {
    const ctx = await createKioskTestContext();
    const startAt = "2026-09-14T14:00:00.000Z";
    const endAt = "2026-09-14T16:00:00.000Z";
    const { reservation } = await ctx.helperCreateAndConfirm(startAt, endAt);

    // Guest arrives at kiosk at 13:30 (30 mins before start)
    ctx.setTime(new Date("2026-09-14T13:30:00.000Z"));
    const earlyResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: null, role: "STAFF" }
    );

    assert.equal(earlyResult.accessState, "NOT_ACTIVE");
    assert.equal(earlyResult.checkInState, "NOT_CHECKED_IN");
    assert.equal(earlyResult.bookingStartAt, startAt);
  });

  it("returns EXPIRED status when guest enters reference code after booking ended", async () => {
    const ctx = await createKioskTestContext();
    const startAt = "2026-09-14T09:00:00.000Z";
    const endAt = "2026-09-14T10:00:00.000Z";
    const { reservation } = await ctx.helperCreateAndConfirm(startAt, endAt);

    // Current time is past end time
    ctx.setTime(new Date("2026-09-14T10:30:00.000Z"));
    const expiredResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.referenceCode,
      { userId: null, role: "STAFF" }
    );

    assert.equal(expiredResult.accessState, "EXPIRED");
  });

  it("resolves booking access identically when providing reservation UUID instead of reference code", async () => {
    const ctx = await createKioskTestContext();
    const startAt = "2026-09-14T09:00:00.000Z";
    const endAt = "2026-09-14T11:00:00.000Z";
    const { reservation } = await ctx.helperCreateAndConfirm(startAt, endAt);

    ctx.setTime(new Date("2026-09-14T09:00:00.000Z"));

    // Lookup using UUID
    const uuidResult = await ctx.bookingAccessService.resolveBookingAccess(
      reservation.id,
      { userId: null, role: "STAFF" }
    );

    assert.equal(uuidResult.reservationId, reservation.id);
    assert.equal(uuidResult.referenceCode, reservation.referenceCode);
    assert.equal(uuidResult.accessState, "ACTIVE");
    assert.equal(uuidResult.checkInState, "CHECKED_IN");
  });

  it("throws BookingAccessError on invalid or non-existent reference code", async () => {
    const ctx = await createKioskTestContext();
    await assert.rejects(
      async () => {
        await ctx.bookingAccessService.resolveBookingAccess("DA-DOES-NOT-EXIST");
      },
      (err: any) => {
        assert(err instanceof BookingAccessError);
        assert.equal(err.message, "Invalid booking token or reference code.");
        return true;
      }
    );
  });

  it("verifies Kiosk WelcomeScreen, Scanner, and ReferenceEntry source code contracts", () => {
    const welcomePath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/features/welcome/WelcomeScreen.tsx"
    );
    const welcomeSrc = fs.readFileSync(welcomePath, "utf-8");
    assert(welcomeSrc.includes("Enter Reference ID"), "WelcomeScreen must render Enter Reference ID button");
    assert(welcomeSrc.includes("Scan QR"), "WelcomeScreen must render Scan QR button");
    assert(welcomeSrc.includes("Tap to Begin"), "WelcomeScreen must render Tap to Begin");

    const scannerPath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/features/qr-scanner/KioskScanner.tsx"
    );
    const scannerSrc = fs.readFileSync(scannerPath, "utf-8");
    assert(scannerSrc.includes("onSwitchToReference"), "KioskScanner must support onSwitchToReference");
    assert(
      scannerSrc.includes("Enter Reference Code or ID Instead"),
      "KioskScanner must provide switch button to reference entry"
    );

    const refEntryPath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/features/qr-scanner/KioskReferenceEntry.tsx"
    );
    const refEntrySrc = fs.readFileSync(refEntryPath, "utf-8");
    assert(refEntrySrc.includes("Check In"), "KioskReferenceEntry must have Check In button");
    assert(refEntrySrc.includes("extractBookingToken"), "KioskReferenceEntry must extract token/reference code");
    assert(refEntrySrc.includes("Scan QR Code Instead"), "KioskReferenceEntry must provide switch button to scanner");

    const pagePath = path.resolve(__dirname, "../apps/kiosk/src/app/kiosk/page.tsx");
    const pageSrc = fs.readFileSync(pagePath, "utf-8");
    assert(pageSrc.includes("KioskReferenceEntry"), "Kiosk page must import KioskReferenceEntry");
    assert(pageSrc.includes("activeView"), "Kiosk page must manage activeView state");
  });
});
