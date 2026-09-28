import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AdminReservationService,
  createAdminSettingsService,
  createPaymentSessionService,
  createReservationService,
  createStaffOperationsService,
  evaluateApproachingBookingEnds,
  filterAdminReservationsByTab,
  filterStaffReservationsByTab,
  getAdminReservationTabCounts,
  getNearCheckoutThresholdMinutes,
  getStaffReservationTabCounts,
  InMemorySettingsRepository,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  resolveReservationOperationalStatus,
  type AdminReservationSummary,
  type StaffOperationalReservation,
} from "@deskatlas/domain";

describe("MS-18: Operational Reservation Lifecycle Harmonization & Dynamic Dashboard Near-End Checkout Threshold Synchronization", () => {
  const simulatedNow = new Date("2026-09-28T14:00:00.000Z");

  describe("QAD-TC18.1: Completed Status on Check-In with Elapsed End Time", () => {
    it("classifies checked-in reservation whose endAt has elapsed as COMPLETED in canonical resolver", () => {
      const status = resolveReservationOperationalStatus(
        {
          status: "CONFIRMED",
          reservationStatus: "CONFIRMED",
          checkedInAt: "2026-09-28T10:00:00.000Z",
          endAt: "2026-09-28T12:00:00.000Z",
        },
        simulatedNow.getTime()
      );

      assert.equal(status, "COMPLETED");
    });

    it("evaluates checked-in booking as COMPLETED in AdminReservationService without manual checkout", async () => {
      const nowProvider = () => simulatedNow;
      const reservationRepo = new ReservationMemoryRepository(nowProvider);
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo,
        reservationRepo,
        paymentSessionService
      );
      const adminService = new AdminReservationService(reservationRepo, nowProvider);

      const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
      const template = await workspaceRepo.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 100,
        pricingUnit: "HOURLY",
        defaultShape: "rectangle",
        defaultColor: "#10b981",
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: "D-01",
        displayName: "Desk 01",
      });

      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "John",
          customerLastName: "Doe",
          customerEmail: "john@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-09-28T09:00:00.000Z",
              endAt: "2026-09-28T12:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );

      const stored = reservationRepo.getStoredReservation(res.id)!;
      stored.status = "CONFIRMED";
      stored.checkedInAt = "2026-09-28T09:05:00.000Z";
      stored.candidates![0].isAssigned = true;

      const listRes = await adminService.listReservations("all");
      assert.equal(listRes.total, 1);
      assert.equal(listRes.reservations[0].reservationStatus, "COMPLETED");
      assert.equal(listRes.reservations[0].status, "Completed");
      assert.equal(listRes.reservations[0].mark, "✓");

      const detail = await adminService.getReservationDetail(res.id);
      assert.ok(detail);
      assert.equal(detail.reservationStatus, "COMPLETED");
      assert.equal(detail.status, "Completed");
      assert.equal(detail.mark, "✓");
    });
  });

  describe("QAD-TC18.2: Expired Status on No-Show with Elapsed End Time", () => {
    it("classifies unattended reservation whose endAt has elapsed as EXPIRED (No-Show)", () => {
      const status = resolveReservationOperationalStatus(
        {
          status: "CONFIRMED",
          reservationStatus: "CONFIRMED",
          checkedInAt: null,
          endAt: "2026-09-28T12:00:00.000Z",
        },
        simulatedNow.getTime()
      );

      assert.equal(status, "EXPIRED");
    });

    it("evaluates unattended reservation as EXPIRED in AdminReservationService and excludes from COMPLETED", async () => {
      const nowProvider = () => simulatedNow;
      const reservationRepo = new ReservationMemoryRepository(nowProvider);
      const workspaceRepo = new InMemoryWorkspaceRepository();
      const paymentSessionService = createPaymentSessionService(reservationRepo, nowProvider);
      const reservationService = createReservationService(
        reservationRepo,
        workspaceRepo,
        reservationRepo,
        paymentSessionService
      );
      const adminService = new AdminReservationService(reservationRepo, nowProvider);

      const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
      const template = await workspaceRepo.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 100,
        pricingUnit: "HOURLY",
        defaultShape: "rectangle",
        defaultColor: "#10b981",
        isActive: true,
      });
      const instance = await workspaceRepo.createInstance({
        templateId: template.id,
        floorId: floor.id,
        instanceCode: "D-02",
        displayName: "Desk 02",
      });

      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "No",
          customerLastName: "Show",
          customerEmail: "noshow@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instance.id,
              startAt: "2026-09-28T09:00:00.000Z",
              endAt: "2026-09-28T12:00:00.000Z",
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );

      const stored = reservationRepo.getStoredReservation(res.id)!;
      stored.status = "CONFIRMED";
      stored.checkedInAt = null;
      stored.candidates![0].isAssigned = true;

      const expiredList = await adminService.listReservations("expired");
      assert.equal(expiredList.total, 1);
      assert.equal(expiredList.reservations[0].reservationStatus, "EXPIRED");
      assert.equal(expiredList.reservations[0].status, "Expired");
      assert.equal(expiredList.reservations[0].mark, "✕");

      const detail = await adminService.getReservationDetail(res.id);
      assert.ok(detail);
      assert.equal(detail.reservationStatus, "EXPIRED");
      assert.equal(detail.status, "Expired");
      assert.equal(detail.mark, "✕");
    });
  });

  describe("QAD-TC18.3: Rejected Payments Excluded from Expired Counts", () => {
    it("segregates rejected payments into REJECTED status and excludes from EXPIRED in domain resolver", () => {
      const status = resolveReservationOperationalStatus(
        {
          status: "REJECTED",
          reservationStatus: "CANCELLED",
          paymentAttemptStatus: "REJECTED",
          checkedInAt: null,
          endAt: "2026-09-28T12:00:00.000Z",
        },
        simulatedNow.getTime()
      );

      assert.equal(status, "REJECTED");
    });

    it("excludes rejected payments from EXPIRED tab subfilter", () => {
      const mockAdminRes: AdminReservationSummary[] = [
        {
          id: "res-rej-1",
          referenceCode: "DA-REJ-01",
          customerName: "Rejected User",
          customerEmail: "rej@example.com",
          spotName: "Desk 01",
          startAt: "2026-09-28T09:00:00.000Z",
          endAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "REJECTED",
          status: "Rejected",
          statusStyle: { background: "#FEE2E2", color: "#991B1B" },
          mark: "✕",
          amountDue: 300,
          currency: "PHP",
          paymentStatus: "Rejected",
          source: "WEB",
          checkedInAt: null,
          checkedOutAt: null,
          paymentAttemptStatus: "REJECTED",
        },
        {
          id: "res-exp-1",
          referenceCode: "DA-EXP-01",
          customerName: "No Show User",
          customerEmail: "noshow@example.com",
          spotName: "Desk 02",
          startAt: "2026-09-28T09:00:00.000Z",
          endAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "EXPIRED",
          status: "Expired",
          statusStyle: { background: "#F1F5F9", color: "#475569" },
          mark: "✕",
          amountDue: 300,
          currency: "PHP",
          paymentStatus: "Unpaid",
          source: "WEB",
          checkedInAt: null,
          checkedOutAt: null,
        },
      ];

      const expiredOnly = filterAdminReservationsByTab(mockAdminRes, "expired", "expired", simulatedNow);
      assert.equal(expiredOnly.length, 1);
      assert.equal(expiredOnly[0].id, "res-exp-1");

      const rejectedOnly = filterAdminReservationsByTab(mockAdminRes, "expired", "rejected", simulatedNow);
      assert.equal(rejectedOnly.length, 1);
      assert.equal(rejectedOnly[0].id, "res-rej-1");
    });
  });

  describe("QAD-TC18.4: Staff and Admin Tab Count Parity", () => {
    it("evaluates identical Completed and Expired counts across Staff and Admin tab count services", () => {
      const mockAdminRes: AdminReservationSummary[] = [
        {
          id: "res-1",
          referenceCode: "DA-01",
          customerName: "Checked In And Ended",
          customerEmail: "user1@example.com",
          spotName: "Desk 01",
          startAt: "2026-09-28T09:00:00.000Z",
          endAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "COMPLETED",
          status: "Completed",
          statusStyle: { background: "#DCFCE7", color: "#166534" },
          mark: "✓",
          amountDue: 300,
          currency: "PHP",
          paymentStatus: "Paid",
          source: "WEB",
          checkedInAt: "2026-09-28T09:02:00.000Z",
          checkedOutAt: null,
        },
        {
          id: "res-2",
          referenceCode: "DA-02",
          customerName: "No Show Ended",
          customerEmail: "user2@example.com",
          spotName: "Desk 02",
          startAt: "2026-09-28T09:00:00.000Z",
          endAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "EXPIRED",
          status: "Expired",
          statusStyle: { background: "#F1F5F9", color: "#475569" },
          mark: "✕",
          amountDue: 300,
          currency: "PHP",
          paymentStatus: "Unpaid",
          source: "WEB",
          checkedInAt: null,
          checkedOutAt: null,
        },
        {
          id: "res-3",
          referenceCode: "DA-03",
          customerName: "Active Live Checked In",
          customerEmail: "user3@example.com",
          spotName: "Desk 03",
          startAt: "2026-09-28T13:00:00.000Z",
          endAt: "2026-09-28T16:00:00.000Z",
          reservationStatus: "CHECKED_IN",
          status: "Checked In",
          statusStyle: { background: "#ECFDF5", color: "#065F46" },
          mark: "✓",
          amountDue: 300,
          currency: "PHP",
          paymentStatus: "Paid",
          source: "WEB",
          checkedInAt: "2026-09-28T13:01:00.000Z",
          checkedOutAt: null,
        },
        {
          id: "res-4",
          referenceCode: "DA-04",
          customerName: "Upcoming Confirmed",
          customerEmail: "user4@example.com",
          spotName: "Desk 04",
          startAt: "2026-09-28T17:00:00.000Z",
          endAt: "2026-09-28T19:00:00.000Z",
          reservationStatus: "CONFIRMED",
          status: "Confirmed",
          statusStyle: { background: "#EFF6FF", color: "#1E40AF" },
          mark: "✓",
          amountDue: 200,
          currency: "PHP",
          paymentStatus: "Paid",
          source: "WEB",
          checkedInAt: null,
          checkedOutAt: null,
        },
      ];

      const mockStaffRes: StaffOperationalReservation[] = [
        {
          reservationId: "res-1",
          referenceCode: "DA-01",
          customerFirstName: "Checked In",
          customerLastName: "And Ended",
          customerEmail: "user1@example.com",
          spotName: "Desk 01",
          bookingStartAt: "2026-09-28T09:00:00.000Z",
          bookingEndAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "COMPLETED",
          checkInState: "CHECKED_OUT",
          checkedInAt: "2026-09-28T09:02:00.000Z",
          checkedOutAt: null,
          source: "WEB",
          status: "Completed",
          amountDue: 300,
          currency: "PHP",
        },
        {
          reservationId: "res-2",
          referenceCode: "DA-02",
          customerFirstName: "No Show",
          customerLastName: "Ended",
          customerEmail: "user2@example.com",
          spotName: "Desk 02",
          bookingStartAt: "2026-09-28T09:00:00.000Z",
          bookingEndAt: "2026-09-28T12:00:00.000Z",
          reservationStatus: "EXPIRED",
          checkInState: "NOT_CHECKED_IN",
          checkedInAt: null,
          checkedOutAt: null,
          source: "WEB",
          status: "Expired",
          amountDue: 300,
          currency: "PHP",
        },
        {
          reservationId: "res-3",
          referenceCode: "DA-03",
          customerFirstName: "Active Live",
          customerLastName: "Checked In",
          customerEmail: "user3@example.com",
          spotName: "Desk 03",
          bookingStartAt: "2026-09-28T13:00:00.000Z",
          bookingEndAt: "2026-09-28T16:00:00.000Z",
          reservationStatus: "CHECKED_IN",
          checkInState: "CHECKED_IN",
          checkedInAt: "2026-09-28T13:01:00.000Z",
          checkedOutAt: null,
          source: "WEB",
          status: "Checked In",
          amountDue: 300,
          currency: "PHP",
        },
        {
          reservationId: "res-4",
          referenceCode: "DA-04",
          customerFirstName: "Upcoming",
          customerLastName: "Confirmed",
          customerEmail: "user4@example.com",
          spotName: "Desk 04",
          bookingStartAt: "2026-09-28T17:00:00.000Z",
          bookingEndAt: "2026-09-28T19:00:00.000Z",
          reservationStatus: "CONFIRMED",
          checkInState: "NOT_CHECKED_IN",
          checkedInAt: null,
          checkedOutAt: null,
          source: "WEB",
          status: "Confirmed",
          amountDue: 200,
          currency: "PHP",
        },
      ];

      const adminCounts = getAdminReservationTabCounts(mockAdminRes, simulatedNow);
      const staffCounts = getStaffReservationTabCounts(mockStaffRes, simulatedNow);

      assert.equal(adminCounts.completedBadgeCount, staffCounts.completedBadgeCount);
      assert.equal(adminCounts.completedBadgeCount, 1);

      assert.equal(adminCounts.expiredBadgeCount, staffCounts.expiredBadgeCount);
      assert.equal(adminCounts.expiredBadgeCount, 1);

      assert.equal(adminCounts.operationsBadgeCount, staffCounts.operationsBadgeCount);
      assert.equal(adminCounts.operationsBadgeCount, 1);

      assert.equal(adminCounts.reservationsBadgeCount, staffCounts.reservationsBadgeCount);
      assert.equal(adminCounts.reservationsBadgeCount, 1);
    });
  });

  describe("QAD-TC18.5: Dynamic Near-End Threshold Propagation", () => {
    it("evaluates custom near-checkout threshold (e.g. 60m) from settings and propagates to approaching ends evaluation", async () => {
      const settingsRepo = new InMemorySettingsRepository();
      const settingsService = createAdminSettingsService(settingsRepo);

      // Default is 15 minutes
      const defaultOverview = await settingsService.getSettingsOverview();
      const defaultThreshold = getNearCheckoutThresholdMinutes(
        defaultOverview.businessSettings.nearCheckoutThresholdMinutes
      );
      assert.equal(defaultThreshold, 15);

      // Update to 60 minutes
      await settingsService.updateBusinessSettings({
        nearCheckoutThresholdMinutes: 60,
      });

      const updatedOverview = await settingsService.getSettingsOverview();
      const customThreshold = getNearCheckoutThresholdMinutes(
        updatedOverview.businessSettings.nearCheckoutThresholdMinutes
      );
      assert.equal(customThreshold, 60);

      // Test approaching booking ends evaluation with 60-minute threshold
      const mockReservations: StaffOperationalReservation[] = [
        {
          reservationId: "res-ending-45m",
          referenceCode: "DA-45M",
          customerFirstName: "Ending",
          customerLastName: "Soon",
          customerEmail: "ending@example.com",
          spotName: "Desk 01",
          bookingStartAt: "2026-09-28T12:00:00.000Z",
          bookingEndAt: "2026-09-28T14:45:00.000Z", // 45m from simulatedNow (14:00)
          reservationStatus: "CHECKED_IN",
          checkInState: "CHECKED_IN",
          checkedInAt: "2026-09-28T12:05:00.000Z",
          source: "WEB",
        },
      ];

      // With 15-minute threshold, 45m remaining should NOT trigger alert
      const alerts15 = evaluateApproachingBookingEnds(mockReservations, 15, simulatedNow);
      assert.equal(alerts15.length, 0);

      // With 60-minute threshold, 45m remaining SHOULD trigger alert
      const alerts60 = evaluateApproachingBookingEnds(mockReservations, 60, simulatedNow);
      assert.equal(alerts60.length, 1);
      assert.equal(alerts60[0].reservationId, "res-ending-45m");
      assert.equal(alerts60[0].minutesRemaining, 45);
    });
  });
});
