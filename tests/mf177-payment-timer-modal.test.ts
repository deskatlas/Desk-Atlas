import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  formatCountdown,
  evaluateUrgentPaymentThreshold,
  evaluateUrgentPendingPayments,
  makeUrgentAlertDismissKey,
  isUrgentAlertDismissed,
  type PaymentReviewQueueItem,
} from "@deskatlas/domain";
import fs from "node:fs";
import path from "node:path";

describe("MF-177: Urgent Payment Timer Modal Seconds, Threshold Removal, and Countdown", () => {
  describe("1. Countdown Time Formatter with Seconds (formatCountdown)", () => {
    it("formats standard minute-second durations (mm:ss) correctly", () => {
      // 12 minutes, 34 seconds = (12 * 60 + 34) * 1000 = 754000 ms
      assert.equal(formatCountdown(754000), "12:34");
      // 5 minutes, 0 seconds
      assert.equal(formatCountdown(300000), "05:00");
      // 10 minutes, 9 seconds
      assert.equal(formatCountdown(609000), "10:09");
    });

    it("formats values greater than 1 hour (h:mm:ss) correctly", () => {
      // 1 hour, 12 minutes, 34 seconds = (3600 + 720 + 34) * 1000 = 4354000 ms
      assert.equal(formatCountdown(4354000), "1:12:34");
      // 2 hours, 5 minutes, 9 seconds = (7200 + 300 + 9) * 1000 = 7509000 ms
      assert.equal(formatCountdown(7509000), "2:05:09");
      // Exactly 1 hour = 3600000 ms
      assert.equal(formatCountdown(3600000), "1:00:00");
    });

    it("formats values less than 1 minute (< 1m) correctly with leading zeros", () => {
      // 45 seconds = 45000 ms
      assert.equal(formatCountdown(45000), "00:45");
      // 5 seconds = 5000 ms
      assert.equal(formatCountdown(5000), "00:05");
      // 1 second = 1000 ms
      assert.equal(formatCountdown(1000), "00:01");
      // 500 ms (sub-second floor)
      assert.equal(formatCountdown(500), "00:00");
    });

    it("stops at 00:00 and does not display negative time for expired values", () => {
      // Exactly 0 ms
      assert.equal(formatCountdown(0), "00:00");
      // Negative 1000 ms (-1s)
      assert.equal(formatCountdown(-1000), "00:00");
      // Negative 60000 ms (-1m)
      assert.equal(formatCountdown(-60000), "00:00");
      // Negative large number
      assert.equal(formatCountdown(-99999999), "00:00");
    });
  });

  describe("2. Real-Time Countdown Tick-by-Tick Progression", () => {
    it("decrements remaining time by 1 second per tick", () => {
      const startMs = 10000; // 10 seconds remaining
      const ticks = [0, 1000, 2000, 3000, 5000, 9000, 10000, 11000, 15000];
      const expectedDisplays = [
        "00:10",
        "00:09",
        "00:08",
        "00:07",
        "00:05",
        "00:01",
        "00:00",
        "00:00",
        "00:00",
      ];

      for (let i = 0; i < ticks.length; i++) {
        const elapsed = ticks[i];
        const remaining = Math.max(0, startMs - elapsed);
        const display = formatCountdown(remaining);
        assert.equal(display, expectedDisplays[i], `Failed at tick ${elapsed}ms`);
      }
    });

    it("calculates countdown dynamically against reservation start timestamp", () => {
      const startAt = "2026-09-22T10:00:00.000Z";
      const startMs = new Date(startAt).getTime();

      // Simulated current time: 9:47:26 (12 mins 34 secs before start)
      const now1 = new Date("2026-09-22T09:47:26.000Z").getTime();
      const remainingMs1 = Math.max(0, startMs - now1);
      assert.equal(formatCountdown(remainingMs1), "12:34");

      // Simulated current time 1 second later: 9:47:27
      const now2 = new Date("2026-09-22T09:47:27.000Z").getTime();
      const remainingMs2 = Math.max(0, startMs - now2);
      assert.equal(formatCountdown(remainingMs2), "12:33");

      // Simulated current time when start time is reached: 10:00:00
      const nowExact = new Date("2026-09-22T10:00:00.000Z").getTime();
      const remainingMsExact = Math.max(0, startMs - nowExact);
      assert.equal(formatCountdown(remainingMsExact), "00:00");

      // Simulated current time past start time: 10:05:00
      const nowPast = new Date("2026-09-22T10:05:00.000Z").getTime();
      const remainingMsPast = Math.max(0, startMs - nowPast);
      assert.equal(formatCountdown(remainingMsPast), "00:00");
    });
  });

  describe("3. Urgent Payment Modal Source Code Audit", () => {
    it("verifies Threshold badge element has been removed from UrgentPaymentModal.tsx", () => {
      const modalPath = path.resolve(
        __dirname,
        "../apps/admin-portal/src/features/notifications/components/UrgentPaymentModal.tsx"
      );
      const source = fs.readFileSync(modalPath, "utf-8");

      // Must not contain "Threshold: {"
      assert.equal(
        source.includes("Threshold: {"),
        false,
        "UrgentPaymentModal.tsx should not render Threshold display label"
      );
      assert.equal(
        source.includes("Threshold: "),
        false,
        "UrgentPaymentModal.tsx should not contain 'Threshold: ' string"
      );
    });

    it("verifies formatCountdown is integrated with ticking clock in UrgentPaymentModal.tsx", () => {
      const modalPath = path.resolve(
        __dirname,
        "../apps/admin-portal/src/features/notifications/components/UrgentPaymentModal.tsx"
      );
      const source = fs.readFileSync(modalPath, "utf-8");

      // Check formatCountdown is imported and used
      assert.ok(
        source.includes("formatCountdown"),
        "UrgentPaymentModal.tsx must import and use formatCountdown"
      );

      // Check real-time interval timer is defined
      assert.ok(
        source.includes("setInterval"),
        "UrgentPaymentModal.tsx must have an interval for ticking"
      );

      // Check urgent-payment-time-remaining renders formatCountdown
      assert.ok(
        source.includes('data-testid="urgent-payment-time-remaining"'),
        "UrgentPaymentModal.tsx must include urgent-payment-time-remaining testid"
      );
      assert.ok(
        source.includes("formatCountdown(remainingMs)"),
        "urgent-payment-time-remaining must format remainingMs using formatCountdown"
      );
    });
  });

  describe("4. Domain Alert Evaluation & Dismissal Key Deduplication", () => {
    const mockItem: PaymentReviewQueueItem = {
      paymentAttemptId: "pay-urgent-1",
      reservationId: "res-urgent-1",
      reservationReferenceCode: "DA-2026-0922-001",
      reservationStatus: "PAYMENT_UNDER_REVIEW",
      paymentStatus: "UNDER_REVIEW",
      customerFirstName: "Rey",
      customerLastName: "Navarro",
      customerEmail: "rey@example.com",
      amountDue: 500,
      currency: "PHP",
      paymentMethodId: "pm-gcash",
      proofSubmittedAt: "2026-09-22T08:00:00.000Z",
      submittedCandidates: [
        {
          rank: 0,
          workspaceInstanceId: "inst-1",
          startAt: "2026-09-22T10:00:00.000Z",
          endAt: "2026-09-22T12:00:00.000Z",
          isAssigned: false,
        },
      ],
    };

    it("evaluates urgent item within 10-minute threshold and computes correct countdown display", () => {
      const now = new Date("2026-09-22T09:51:30.000Z"); // 8 mins 30 secs away
      const alert = evaluateUrgentPaymentThreshold(mockItem, now);
      assert.ok(alert);
      assert.equal(alert.thresholdLevel, "10m");

      const remainingMs = Math.max(0, new Date(alert.startAt).getTime() - now.getTime());
      assert.equal(formatCountdown(remainingMs), "08:30");
    });

    it("verifies dismissal keys function properly per threshold level", () => {
      const key10m = makeUrgentAlertDismissKey("pay-urgent-1", "10m");
      assert.equal(key10m, "pay-urgent-1:10m");

      const dismissedSet = new Set<string>([key10m]);
      assert.equal(isUrgentAlertDismissed(dismissedSet, "pay-urgent-1", "10m"), true);
      assert.equal(isUrgentAlertDismissed(dismissedSet, "pay-urgent-1", "30m"), false);
    });
  });
});
