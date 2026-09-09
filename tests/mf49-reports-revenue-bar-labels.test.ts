import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createPaymentReviewService,
  createPaymentSessionService,
  createReportsService,
  createReservationService,
  formatRevenueBarValue,
  getRevenueBarLabelInfo,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  type AdminRevenueOverviewBar,
} from "@deskatlas/domain";

describe("MF-49: Reports Revenue Overview Bar Labels (PRD-F15)", () => {
  describe("Revenue Bar Value Formatting", () => {
    it("formats zero amounts as unobtrusive ₱0", () => {
      assert.equal(formatRevenueBarValue(0), "₱0");
      assert.equal(formatRevenueBarValue(0.0), "₱0");
      assert.equal(formatRevenueBarValue(undefined), "₱0");
      assert.equal(formatRevenueBarValue(NaN), "₱0");
    });

    it("formats whole currency amounts with proper currency symbol and thousands separators", () => {
      assert.equal(formatRevenueBarValue(500), "₱500");
      assert.equal(formatRevenueBarValue(1234), "₱1,234");
      assert.equal(formatRevenueBarValue(5000), "₱5,000");
      assert.equal(formatRevenueBarValue(10000), "₱10,000");
      assert.equal(formatRevenueBarValue(1234567), "₱1,234,567");
    });

    it("formats fractional amounts with 2 decimal places", () => {
      assert.equal(formatRevenueBarValue(1234.5), "₱1,234.50");
      assert.equal(formatRevenueBarValue(99.99), "₱99.99");
    });

    it("supports custom currency codes", () => {
      assert.equal(formatRevenueBarValue(5000, "USD"), "$5,000");
    });
  });

  describe("Revenue Bar Label Placement Logic", () => {
    it("places zero-value labels above the bar", () => {
      const info = getRevenueBarLabelInfo(0, 0);
      assert.equal(info.formattedValue, "₱0");
      assert.equal(info.isInsideBar, false);
      assert.equal(info.isZero, true);
    });

    it("places small non-zero bars (<25% height) above the bar", () => {
      const info = getRevenueBarLabelInfo(15, 300);
      assert.equal(info.formattedValue, "₱300");
      assert.equal(info.isInsideBar, false);
      assert.equal(info.isZero, false);
    });

    it("handles the 24% and 25% boundary conditions correctly", () => {
      const at24 = getRevenueBarLabelInfo(24, 1200);
      assert.equal(at24.isInsideBar, false);
      assert.equal(at24.formattedValue, "₱1,200");

      const at25 = getRevenueBarLabelInfo(25, 1250);
      assert.equal(at25.isInsideBar, true);
      assert.equal(at25.formattedValue, "₱1,250");
    });

    it("places tall bars (>=25% height) inside the bar at the top", () => {
      const info = getRevenueBarLabelInfo(80, 5000);
      assert.equal(info.formattedValue, "₱5,000");
      assert.equal(info.isInsideBar, true);
      assert.equal(info.isZero, false);
    });

    it("defensively prevents zero-value labels from being placed inside even if height is high", () => {
      const info = getRevenueBarLabelInfo(50, 0);
      assert.equal(info.formattedValue, "₱0");
      assert.equal(info.isInsideBar, false);
      assert.equal(info.isZero, true);
    });
  });

  describe("End-to-End Reports Revenue Overview Bar Labels Integration", () => {
    it("renders all 7 day bars with labels for empty dataset", async () => {
      const reservationRepo = new ReservationMemoryRepository();
      const reportsService = createReportsService(
        reservationRepo,
        () => new Date("2026-08-29T12:00:00.000Z")
      );

      const snapshot = await reportsService.getAdminReportsSnapshot("30days");
      const { bars, currency } = snapshot.revenueOverview;

      assert.equal(bars.length, 7);
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]!;
        assert.equal(bar.amount, 0);
        const labelInfo = getRevenueBarLabelInfo(bar.heightPercentage, bar.amount, currency);
        assert.equal(labelInfo.formattedValue, "₱0");
        assert.equal(labelInfo.isInsideBar, false);
        assert.equal(labelInfo.isZero, true);
      }
    });

    it("renders accurate numerical value labels on bars with real revenue data", async () => {
      const now = new Date("2026-08-29T12:00:00.000Z");
      const nowProvider = () => now;

      const reservationRepo = new ReservationMemoryRepository(nowProvider);
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo,
        reservationRepo,
        paymentSessionService
      );
      const paymentReviewService = createPaymentReviewService(reservationRepo, nowProvider);
      const reportsService = createReportsService(reservationRepo, nowProvider);
      const adminActor = { userId: "admin-user-1", role: "ADMIN" as const };

      const floor = await workspaceRepo.createFloor({ name: "Floor 1" });
      const template = await workspaceRepo.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 500,
        pricingUnit: "HOURLY",
        defaultShape: "rectangle",
        defaultColor: "#0f172a",
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: "DD-01",
        displayName: "Desk 1",
      });

      // Create a 2-hour reservation (500 * 2 = 1000) on 2026-08-29
      const reservation = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "BarLabel",
          customerLastName: "Tester",
          customerEmail: "barlabels@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-08-29T14:00:00.000Z",
              endAt: "2026-08-29T16:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );

      // Submit payment and approve
      await paymentSessionService.submitPaymentProof({
        token: reservation.paymentSession!.token,
        paymentMethodId: "pm-gcash",
        proofStoragePath: "proofs/bar-proof.png",
      });
      const session = await paymentSessionService.getPaymentSession(reservation.paymentSession!.token);
      await paymentReviewService.reviewPayment({
        paymentAttemptId: session.paymentAttemptId,
        actor: adminActor,
        decision: "APPROVE",
      });

      const snapshot = await reportsService.getAdminReportsSnapshot("7days");
      const { bars, currency } = snapshot.revenueOverview;

      assert.equal(bars.length, 7);

      // The last bar (today, 2026-08-29) should reflect the approved payment
      const todayBar = bars[6]!;
      assert.equal(todayBar.date, "2026-08-29");
      assert.equal(todayBar.amount, 1000);
      assert.equal(todayBar.heightPercentage, 100);

      const todayLabelInfo = getRevenueBarLabelInfo(todayBar.heightPercentage, todayBar.amount, currency);
      assert.equal(todayLabelInfo.formattedValue, "₱1,000");
      assert.equal(todayLabelInfo.isInsideBar, true);
      assert.equal(todayLabelInfo.isZero, false);

      // Previous 6 days should have 0 amount and ₱0 label above the bar
      for (let i = 0; i < 6; i++) {
        const bar = bars[i]!;
        assert.equal(bar.amount, 0);
        const labelInfo = getRevenueBarLabelInfo(bar.heightPercentage, bar.amount, currency);
        assert.equal(labelInfo.formattedValue, "₱0");
        assert.equal(labelInfo.isInsideBar, false);
        assert.equal(labelInfo.isZero, true);
      }
    });

    it("updates snapshot and labels when the date filter changes", async () => {
      const now = new Date("2026-08-29T12:00:00.000Z");
      const nowProvider = () => now;
      const reservationRepo = new ReservationMemoryRepository(nowProvider);
      const reportsService = createReportsService(reservationRepo, nowProvider);

      const ranges = ["today", "7days", "30days", "month", "year"] as const;

      for (const r of ranges) {
        const snapshot = await reportsService.getAdminReportsSnapshot(r);
        assert.equal(snapshot.range, r);
        assert.ok(snapshot.revenueOverview.bars.length === 7);

        // Every bar in the snapshot maps to a valid label info
        for (const bar of snapshot.revenueOverview.bars) {
          const labelInfo = getRevenueBarLabelInfo(
            bar.heightPercentage,
            bar.amount,
            snapshot.revenueOverview.currency
          );
          assert.ok(labelInfo.formattedValue.startsWith("₱"));
          assert.equal(typeof labelInfo.isInsideBar, "boolean");
          assert.equal(typeof labelInfo.isZero, "boolean");
        }
      }
    });
  });
});
