import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  getUrgentThresholdLevel,
  formatUrgentThresholdLabel,
  getReservationBookingStartTime,
  evaluateUrgentPaymentThreshold,
  evaluateUrgentPendingPayments,
  makeUrgentAlertDismissKey,
  isUrgentAlertDismissed,
  type PaymentReviewQueueItem,
  type ReservationCandidate,
  type UrgentPaymentThresholdLevel,
} from "@deskatlas/domain";

describe("MF-103: Admin Urgent Modal Notification for Approaching Pending Payments", () => {
  describe("Threshold Level Detection", () => {
    it("identifies 60-minute threshold correctly (>30m and <=60m)", () => {
      assert.equal(getUrgentThresholdLevel(60), "60m");
      assert.equal(getUrgentThresholdLevel(55), "60m");
      assert.equal(getUrgentThresholdLevel(45), "60m");
      assert.equal(getUrgentThresholdLevel(31), "60m");
    });

    it("identifies 30-minute threshold correctly (>10m and <=30m)", () => {
      assert.equal(getUrgentThresholdLevel(30), "30m");
      assert.equal(getUrgentThresholdLevel(25), "30m");
      assert.equal(getUrgentThresholdLevel(15), "30m");
      assert.equal(getUrgentThresholdLevel(11), "30m");
    });

    it("identifies 10-minute threshold correctly (<=10m down to -15m)", () => {
      assert.equal(getUrgentThresholdLevel(10), "10m");
      assert.equal(getUrgentThresholdLevel(8), "10m");
      assert.equal(getUrgentThresholdLevel(1), "10m");
      assert.equal(getUrgentThresholdLevel(0), "10m");
      assert.equal(getUrgentThresholdLevel(-5), "10m");
      assert.equal(getUrgentThresholdLevel(-15), "10m");
    });

    it("returns null for times outside urgent thresholds", () => {
      assert.equal(getUrgentThresholdLevel(60.1), null);
      assert.equal(getUrgentThresholdLevel(120), null);
      assert.equal(getUrgentThresholdLevel(-15.1), null);
      assert.equal(getUrgentThresholdLevel(-60), null);
    });

    it("formats threshold labels according to specification", () => {
      assert.equal(formatUrgentThresholdLabel("60m"), "Starts in 1 hour");
      assert.equal(formatUrgentThresholdLabel("30m"), "Starts in 30 minutes");
      assert.equal(formatUrgentThresholdLabel("10m"), "Starts in 10 minutes");
    });
  });

  describe("Candidate Booking Start Time Resolution", () => {
    it("resolves assigned candidate start time first", () => {
      const candidates: ReservationCandidate[] = [
        {
          rank: 0,
          workspaceInstanceId: "w1",
          startAt: "2026-09-14T10:00:00.000Z",
          endAt: "2026-09-14T12:00:00.000Z",
          isAssigned: false,
        },
        {
          rank: 1,
          workspaceInstanceId: "w2",
          startAt: "2026-09-14T11:00:00.000Z",
          endAt: "2026-09-14T13:00:00.000Z",
          isAssigned: true,
        },
      ];

      assert.equal(
        getReservationBookingStartTime(candidates),
        "2026-09-14T11:00:00.000Z"
      );
    });

    it("resolves main candidate (rank 0) start time if none assigned", () => {
      const candidates: ReservationCandidate[] = [
        {
          rank: 1,
          workspaceInstanceId: "w2",
          startAt: "2026-09-14T11:00:00.000Z",
          endAt: "2026-09-14T13:00:00.000Z",
          isAssigned: false,
        },
        {
          rank: 0,
          workspaceInstanceId: "w1",
          startAt: "2026-09-14T10:00:00.000Z",
          endAt: "2026-09-14T12:00:00.000Z",
          isAssigned: false,
        },
      ];

      assert.equal(
        getReservationBookingStartTime(candidates),
        "2026-09-14T10:00:00.000Z"
      );
    });

    it("falls back to earliest start time if rank 0 is missing", () => {
      const candidates: ReservationCandidate[] = [
        {
          rank: 2,
          workspaceInstanceId: "w2",
          startAt: "2026-09-14T14:00:00.000Z",
          endAt: "2026-09-14T16:00:00.000Z",
          isAssigned: false,
        },
        {
          rank: 1,
          workspaceInstanceId: "w1",
          startAt: "2026-09-14T12:00:00.000Z",
          endAt: "2026-09-14T14:00:00.000Z",
          isAssigned: false,
        },
      ];

      assert.equal(
        getReservationBookingStartTime(candidates),
        "2026-09-14T12:00:00.000Z"
      );
    });
  });

  describe("Urgent Pending Payment Evaluation", () => {
    const createMockQueueItem = (
      id: string,
      startAt: string,
      status: "UNDER_REVIEW" | "SUBMITTED" | "APPROVED" | "REJECTED" = "UNDER_REVIEW"
    ): PaymentReviewQueueItem => ({
      paymentAttemptId: id,
      reservationId: `res-${id}`,
      reservationReferenceCode: `DA-2026-${id}`,
      reservationStatus: "PAYMENT_UNDER_REVIEW",
      paymentStatus: status,
      customerFirstName: "Alex",
      customerLastName: "Reyes",
      customerEmail: "alex@example.com",
      amountDue: 250,
      currency: "PHP",
      paymentMethodId: "pm-gcash",
      proofSubmittedAt: "2026-09-14T08:30:00.000Z",
      submittedCandidates: [
        {
          rank: 0,
          workspaceInstanceId: "inst-1",
          startAt,
          endAt: "2026-09-14T12:00:00.000Z",
          isAssigned: false,
        },
      ],
    });

    it("evaluates item at 60-minute threshold correctly", () => {
      const now = new Date("2026-09-14T09:10:00.000Z");
      // 50 minutes away
      const item = createMockQueueItem("pay-60", "2026-09-14T10:00:00.000Z");

      const alert = evaluateUrgentPaymentThreshold(item, now);
      assert.ok(alert);
      assert.equal(alert.thresholdLevel, "60m");
      assert.equal(alert.thresholdLabel, "Starts in 1 hour");
      assert.equal(alert.timeRemainingMinutes, 50);
      assert.equal(alert.customerName, "Alex Reyes");
      assert.equal(alert.reservationReferenceCode, "DA-2026-pay-60");
      assert.equal(alert.reviewUrl, "/manage/payments/review/pay-60");
    });

    it("evaluates item at 30-minute threshold correctly", () => {
      const now = new Date("2026-09-14T09:35:00.000Z");
      // 25 minutes away
      const item = createMockQueueItem("pay-30", "2026-09-14T10:00:00.000Z");

      const alert = evaluateUrgentPaymentThreshold(item, now);
      assert.ok(alert);
      assert.equal(alert.thresholdLevel, "30m");
      assert.equal(alert.thresholdLabel, "Starts in 30 minutes");
      assert.equal(alert.timeRemainingMinutes, 25);
    });

    it("evaluates item at 10-minute threshold correctly", () => {
      const now = new Date("2026-09-14T09:52:00.000Z");
      // 8 minutes away
      const item = createMockQueueItem("pay-10", "2026-09-14T10:00:00.000Z");

      const alert = evaluateUrgentPaymentThreshold(item, now);
      assert.ok(alert);
      assert.equal(alert.thresholdLevel, "10m");
      assert.equal(alert.thresholdLabel, "Starts in 10 minutes");
      assert.equal(alert.timeRemainingMinutes, 8);
    });

    it("ignores non-UNDER_REVIEW items even if time is urgent", () => {
      const now = new Date("2026-09-14T09:50:00.000Z");
      const item = createMockQueueItem(
        "pay-approved",
        "2026-09-14T10:00:00.000Z",
        "APPROVED"
      );

      const alert = evaluateUrgentPaymentThreshold(item, now);
      assert.equal(alert, null);
    });

    it("sorts multiple urgent pending payments from most urgent to least urgent", () => {
      const now = new Date("2026-09-14T09:00:00.000Z");
      const queue: PaymentReviewQueueItem[] = [
        createMockQueueItem("item-60m", "2026-09-14T09:55:00.000Z"), // 55 mins
        createMockQueueItem("item-10m", "2026-09-14T09:08:00.000Z"), // 8 mins
        createMockQueueItem("item-30m", "2026-09-14T09:25:00.000Z"), // 25 mins
        createMockQueueItem("item-not-urgent", "2026-09-14T12:00:00.000Z"), // 3 hours
      ];

      const alerts = evaluateUrgentPendingPayments(queue, now);
      assert.equal(alerts.length, 3);
      assert.equal(alerts[0].paymentAttemptId, "item-10m");
      assert.equal(alerts[0].thresholdLevel, "10m");
      assert.equal(alerts[1].paymentAttemptId, "item-30m");
      assert.equal(alerts[1].thresholdLevel, "30m");
      assert.equal(alerts[2].paymentAttemptId, "item-60m");
      assert.equal(alerts[2].thresholdLevel, "60m");
    });
  });

  describe("Dismissal Key & Deduplication Progression", () => {
    it("generates separate keys per payment attempt and threshold level", () => {
      assert.equal(makeUrgentAlertDismissKey("pay-1", "60m"), "pay-1:60m");
      assert.equal(makeUrgentAlertDismissKey("pay-1", "30m"), "pay-1:30m");
      assert.equal(makeUrgentAlertDismissKey("pay-1", "10m"), "pay-1:10m");
    });

    it("ensures dismissing 60m does not suppress the subsequent 30m or 10m alerts", () => {
      const dismissed = new Set<string>();

      // Admin dismisses at 60m
      dismissed.add(makeUrgentAlertDismissKey("pay-1", "60m"));
      assert.equal(isUrgentAlertDismissed(dismissed, "pay-1", "60m"), true);

      // Time passes: now at 30m threshold. Should NOT be dismissed!
      assert.equal(isUrgentAlertDismissed(dismissed, "pay-1", "30m"), false);

      // Admin dismisses at 30m
      dismissed.add(makeUrgentAlertDismissKey("pay-1", "30m"));
      assert.equal(isUrgentAlertDismissed(dismissed, "pay-1", "30m"), true);

      // Time passes: now at 10m threshold. Should NOT be dismissed!
      assert.equal(isUrgentAlertDismissed(dismissed, "pay-1", "10m"), false);
    });
  });
});
