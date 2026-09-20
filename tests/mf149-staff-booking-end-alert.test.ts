import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateApproachingBookingEnds,
  makeEndAlertDismissKey,
  isEndAlertDismissed,
  getBookingEndAlertMinutes,
  createAdminSettingsService,
  InMemorySettingsRepository,
  SettingsValidationError,
  ActiveBookingCandidate,
} from "@deskatlas/domain";
import { canSaveBusinessProfile } from "../apps/admin-portal/src/features/settings/components/Settings";

describe("MF-149: Staff Booking End-Time Alert Modal & Configurable Threshold", () => {
  describe("Domain Service: evaluateApproachingBookingEnds", () => {
    const baseNow = new Date("2026-09-20T10:00:00.000Z");

    it("evaluates and returns alerts for checked-in bookings within the configured threshold", () => {
      const activeBookings: ActiveBookingCandidate[] = [
        {
          id: "res-1",
          referenceCode: "DA-2026-0001",
          status: "CHECKED_IN",
          customerFirstName: "Alice",
          customerLastName: "Gupta",
          spotName: "Desk A1",
          startAt: "2026-09-20T08:00:00.000Z",
          endAt: "2026-09-20T10:04:00.000Z", // 4 mins remaining
        },
        {
          id: "res-2",
          referenceCode: "DA-2026-0002",
          status: "CHECKED_IN",
          customerFirstName: "Bob",
          customerLastName: "Smith",
          spotName: "Desk B2",
          startAt: "2026-09-20T09:00:00.000Z",
          endAt: "2026-09-20T10:02:00.000Z", // 2 mins remaining
        },
      ];

      const alerts = evaluateApproachingBookingEnds(activeBookings, 5, baseNow);
      expect(alerts).toHaveLength(2);
      // res-2 (2 mins) should come before res-1 (4 mins)
      expect(alerts[0].reservationId).toBe("res-2");
      expect(alerts[0].minutesRemaining).toBe(2);
      expect(alerts[0].customerName).toBe("Bob Smith");
      expect(alerts[0].spotName).toBe("Desk B2");

      expect(alerts[1].reservationId).toBe("res-1");
      expect(alerts[1].minutesRemaining).toBe(4);
      expect(alerts[1].customerName).toBe("Alice Gupta");
      expect(alerts[1].spotName).toBe("Desk A1");
    });

    it("does not fire for bookings outside the configured threshold", () => {
      const activeBookings: ActiveBookingCandidate[] = [
        {
          id: "res-3",
          referenceCode: "DA-2026-0003",
          status: "CHECKED_IN",
          customerFirstName: "Charlie",
          customerLastName: "Brown",
          spotName: "Desk C3",
          endAt: "2026-09-20T10:15:00.000Z", // 15 mins remaining (> 5m threshold)
        },
      ];

      const alerts = evaluateApproachingBookingEnds(activeBookings, 5, baseNow);
      expect(alerts).toHaveLength(0);

      // If threshold is expanded to 20m, it should fire
      const alertsExpanded = evaluateApproachingBookingEnds(activeBookings, 20, baseNow);
      expect(alertsExpanded).toHaveLength(1);
      expect(alertsExpanded[0].reservationId).toBe("res-3");
    });

    it("does not fire for bookings that already expired (endAt in the past)", () => {
      const activeBookings: ActiveBookingCandidate[] = [
        {
          id: "res-4",
          referenceCode: "DA-2026-0004",
          status: "CHECKED_IN",
          customerFirstName: "David",
          customerLastName: "Miller",
          spotName: "Desk D4",
          endAt: "2026-09-20T09:59:00.000Z", // 1 min ago
        },
      ];

      const alerts = evaluateApproachingBookingEnds(activeBookings, 5, baseNow);
      expect(alerts).toHaveLength(0);
    });

    it("ignores non-checked-in reservations (CONFIRMED, COMPLETED, CANCELLED)", () => {
      const bookings: ActiveBookingCandidate[] = [
        {
          id: "res-5",
          referenceCode: "DA-2026-0005",
          status: "CONFIRMED",
          customerFirstName: "Eve",
          customerLastName: "Adams",
          spotName: "Desk E5",
          endAt: "2026-09-20T10:03:00.000Z",
        },
        {
          id: "res-6",
          referenceCode: "DA-2026-0006",
          status: "COMPLETED",
          customerFirstName: "Frank",
          customerLastName: "Wright",
          spotName: "Desk F6",
          endAt: "2026-09-20T10:03:00.000Z",
        },
        {
          id: "res-7",
          referenceCode: "DA-2026-0007",
          status: "CANCELLED",
          customerFirstName: "Grace",
          customerLastName: "Hopper",
          spotName: "Desk G7",
          endAt: "2026-09-20T10:03:00.000Z",
        },
      ];

      const alerts = evaluateApproachingBookingEnds(bookings, 5, baseNow);
      expect(alerts).toHaveLength(0);
    });

    it("correctly resolves nested candidate endAt and workspaceName", () => {
      const activeBookings: ActiveBookingCandidate[] = [
        {
          reservationId: "res-8",
          referenceCode: "DA-2026-0008",
          status: "CHECKED_IN",
          customerName: "Hannah Abbott",
          candidates: [
            {
              workspaceName: "ThinkSpot 01",
              startAt: "2026-09-20T08:00:00.000Z",
              endAt: "2026-09-20T10:03:30.000Z",
              isAssigned: true,
            },
          ],
        },
      ];

      const alerts = evaluateApproachingBookingEnds(activeBookings, 5, baseNow);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].reservationId).toBe("res-8");
      expect(alerts[0].spotName).toBe("ThinkSpot 01");
      expect(alerts[0].customerName).toBe("Hannah Abbott");
    });
  });

  describe("Dismissal Helpers: makeEndAlertDismissKey & isEndAlertDismissed", () => {
    it("generates correct dismissal key", () => {
      expect(makeEndAlertDismissKey("res-101")).toBe("res-101");
      expect(makeEndAlertDismissKey("res-101", 5)).toBe("res-101:5");
    });

    it("verifies dismissed status from Set or Array", () => {
      const dismissedSet = new Set(["res-101", "res-102:10"]);
      expect(isEndAlertDismissed(dismissedSet, "res-101")).toBe(true);
      expect(isEndAlertDismissed(dismissedSet, "res-102", 10)).toBe(true);
      expect(isEndAlertDismissed(dismissedSet, "res-103")).toBe(false);

      const dismissedArray = ["res-201", "res-202:5"];
      expect(isEndAlertDismissed(dismissedArray, "res-201")).toBe(true);
      expect(isEndAlertDismissed(dismissedArray, "res-202", 5)).toBe(true);
      expect(isEndAlertDismissed(dismissedArray, "res-203")).toBe(false);
    });
  });

  describe("Settings: getBookingEndAlertMinutes helper", () => {
    it("returns default 5 for missing or invalid values", () => {
      expect(getBookingEndAlertMinutes(undefined)).toBe(5);
      expect(getBookingEndAlertMinutes(null)).toBe(5);
      expect(getBookingEndAlertMinutes(NaN)).toBe(5);
      expect(getBookingEndAlertMinutes(0)).toBe(5);
      expect(getBookingEndAlertMinutes(-5)).toBe(5);
      expect(getBookingEndAlertMinutes(61)).toBe(5);
      expect(getBookingEndAlertMinutes(5.5)).toBe(5);
    });

    it("returns the configured valid integer between 1 and 60", () => {
      expect(getBookingEndAlertMinutes(1)).toBe(1);
      expect(getBookingEndAlertMinutes(5)).toBe(5);
      expect(getBookingEndAlertMinutes(10)).toBe(10);
      expect(getBookingEndAlertMinutes(15)).toBe(15);
      expect(getBookingEndAlertMinutes(30)).toBe(30);
      expect(getBookingEndAlertMinutes(60)).toBe(60);
    });
  });

  describe("Settings Service & Repository: bookingEndAlertMinutes persistence and validation", () => {
    let repo: InMemorySettingsRepository;
    let service: ReturnType<typeof createAdminSettingsService>;

    beforeEach(() => {
      repo = new InMemorySettingsRepository();
      service = createAdminSettingsService(repo);
    });

    it("rejects bookingEndAlertMinutes outside 1-60 range", async () => {
      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          bookingEndAlertMinutes: 0,
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          bookingEndAlertMinutes: 61,
        })
      ).rejects.toThrow(SettingsValidationError);

      await expect(
        service.updateBusinessSettings({
          businessName: "DeskAtlas",
          timezone: "Asia/Manila",
          bookingIntervalMinutes: 30,
          paymentExpiryMinutes: 60,
          bookingEndAlertMinutes: -1,
        })
      ).rejects.toThrow(SettingsValidationError);
    });

    it("successfully persists and returns valid bookingEndAlertMinutes", async () => {
      const updated = await service.updateBusinessSettings({
        businessName: "DeskAtlas Manila",
        timezone: "Asia/Manila",
        bookingIntervalMinutes: 30,
        paymentExpiryMinutes: 60,
        bookingEndAlertMinutes: 10,
      });

      expect(updated.bookingEndAlertMinutes).toBe(10);

      const overview = await service.getSettingsOverview();
      expect(overview.businessSettings.bookingEndAlertMinutes).toBe(10);

      const publicSettings = await service.getPublicBusinessSettings();
      expect(publicSettings.bookingEndAlertMinutes).toBe(10);
    });
  });

  describe("UI Helper: canSaveBusinessProfile", () => {
    it("validates bookingEndAlertMinutes range in canSaveBusinessProfile", () => {
      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 30,
          bookingEndAlertMinutes: 5,
        })
      ).toEqual({ canSave: true });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 30,
          bookingEndAlertMinutes: 0,
        })
      ).toEqual({
        canSave: false,
        reason: "Booking end-time alert threshold must be between 1 and 60 minutes",
      });

      expect(
        canSaveBusinessProfile({
          businessName: "DeskAtlas",
          contactEmail: "admin@deskatlas.ph",
          phoneDigits: "9171234567",
          bookingIntervalMinutes: 30,
          bookingEndAlertMinutes: 65,
        })
      ).toEqual({
        canSave: false,
        reason: "Booking end-time alert threshold must be between 1 and 60 minutes",
      });
    });
  });
});
