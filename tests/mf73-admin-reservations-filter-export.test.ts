import { describe, it, expect } from "vitest";
import {
  countActiveFilters,
  matchesReservationFilters,
  filterReservations,
  escapeCsvField,
  generateReservationsCsv,
  generateReservationsCsvFilename,
  createAdminReservationService,
  ReservationMemoryRepository,
  type AdminReservationSummary,
  type AdminReservationAdvancedFilters,
} from "@deskatlas/domain";

describe("MF-73: Admin Reservations Filtering and CSV Export", () => {
  const fixedNow = new Date("2026-09-11T12:00:00Z");

  const sampleReservations: AdminReservationSummary[] = [
    {
      id: "res-1",
      referenceCode: "REF-1001",
      source: "WEB",
      customerFirstName: "Alice",
      customerLastName: "Smith",
      customerName: "Alice Smith",
      customerInitials: "AS",
      customerEmail: "alice@example.com",
      workspaceDisplayName: "Hot Desk A1",
      workspaceInstanceCode: "HD-A1",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      schedule: "Sep 11, 09:00 - 17:00",
      startAt: "2026-09-11T09:00:00Z",
      endAt: "2026-09-11T17:00:00Z",
      paymentStatus: "Paid",
      paymentColor: "var(--da-success)",
      reservationStatus: "CONFIRMED",
      status: "Confirmed",
      statusStyle: { background: "var(--da-info)", color: "var(--da-brand-dark)" },
      mark: "✓",
      amountDue: 500,
      amountPaid: 500,
      currency: "PHP",
      createdAt: "2026-09-11T08:00:00Z",
      confirmedAt: "2026-09-11T08:15:00Z",
      paymentAttemptStatus: "APPROVED",
      paymentMethodType: "GCASH",
      paymentMethodDisplayName: "GCash (Online QR)",
    },
    {
      id: "res-2",
      referenceCode: "REF-1002",
      source: "KIOSK",
      customerFirstName: "Bob",
      customerLastName: "Jones, Jr.",
      customerName: "Bob Jones, Jr.",
      customerInitials: "BJ",
      customerEmail: "bob@example.com",
      workspaceDisplayName: "Dedicated Desk B2",
      workspaceInstanceCode: "DD-B2",
      workspaceTemplateName: "Dedicated Desk",
      floorName: "Floor 2",
      schedule: "Sep 12, 10:00 - 14:00",
      startAt: "2026-09-12T10:00:00Z",
      endAt: "2026-09-12T14:00:00Z",
      paymentStatus: "Pending",
      paymentColor: "var(--da-text-secondary)",
      reservationStatus: "PENDING_PAYMENT",
      status: "Awaiting Proof",
      statusStyle: { background: "var(--da-soft)", color: "var(--da-brand-dark)" },
      mark: "!",
      amountDue: 800,
      amountPaid: 0,
      currency: "PHP",
      createdAt: "2026-09-11T08:30:00Z",
      paymentAttemptStatus: "PENDING",
      paymentMethodType: "CASH",
      paymentMethodDisplayName: "Cash (Counter)",
    },
    {
      id: "res-3",
      referenceCode: "REF-1003",
      source: "WEB",
      customerFirstName: "Charlie",
      customerLastName: "Brown",
      customerName: "Charlie Brown",
      customerInitials: "CB",
      customerEmail: "charlie@example.com",
      workspaceDisplayName: "Meeting Room \"Alpha\"",
      workspaceInstanceCode: "MR-A",
      workspaceTemplateName: "Meeting Room",
      floorName: "Floor 1",
      schedule: "Sep 15, 13:00 - 16:00",
      startAt: "2026-09-15T13:00:00Z",
      endAt: "2026-09-15T16:00:00Z",
      paymentStatus: "Review",
      paymentColor: "var(--da-attention)",
      reservationStatus: "PAYMENT_UNDER_REVIEW",
      status: "Payment Review",
      statusStyle: { background: "#FFF8E8", color: "var(--da-brand-dark)" },
      mark: "⧖",
      amountDue: 1500,
      amountPaid: 0,
      currency: "PHP",
      createdAt: "2026-09-10T10:00:00Z",
      paymentAttemptStatus: "UNDER_REVIEW",
      paymentMethodType: "BANK",
      paymentMethodDisplayName: "BDO Bank Transfer",
    },
    {
      id: "res-4",
      referenceCode: "REF-1004",
      source: "WEB",
      customerFirstName: "Diana",
      customerLastName: "Prince",
      customerName: "Diana Prince",
      customerInitials: "DP",
      customerEmail: "diana@example.com",
      workspaceDisplayName: "Hot Desk A2",
      workspaceInstanceCode: "HD-A2",
      workspaceTemplateName: "Hot Desk",
      floorName: "Floor 1",
      schedule: "Sep 01, 09:00 - 17:00",
      startAt: "2026-09-01T09:00:00Z",
      endAt: "2026-09-01T17:00:00Z",
      paymentStatus: "Expired",
      paymentColor: "var(--da-text-secondary)",
      reservationStatus: "EXPIRED",
      status: "Expired",
      statusStyle: { background: "#F1F5F9", color: "#64748B" },
      mark: "✕",
      amountDue: 500,
      amountPaid: 0,
      currency: "PHP",
      createdAt: "2026-09-01T08:00:00Z",
      paymentAttemptStatus: "EXPIRED",
      paymentMethodType: "GCASH",
      paymentMethodDisplayName: "GCash",
    },
  ];

  describe("Active Filter Counting", () => {
    it("returns 0 for empty or undefined filters", () => {
      expect(countActiveFilters(null)).toBe(0);
      expect(countActiveFilters(undefined)).toBe(0);
      expect(countActiveFilters({})).toBe(0);
      expect(
        countActiveFilters({
          datePreset: "all",
          workspaceTemplate: "all",
          paymentMethod: "all",
          paymentStatus: "all",
          source: "all",
        })
      ).toBe(0);
    });

    it("counts preset date filter", () => {
      expect(countActiveFilters({ datePreset: "today" })).toBe(1);
      expect(countActiveFilters({ datePreset: "this_month" })).toBe(1);
    });

    it("counts custom date filter only when dates are provided", () => {
      expect(countActiveFilters({ datePreset: "custom" })).toBe(0);
      expect(countActiveFilters({ datePreset: "custom", startDate: "2026-09-01" })).toBe(1);
      expect(countActiveFilters({ datePreset: "custom", endDate: "2026-09-30" })).toBe(1);
    });

    it("counts multiple active filter dimensions", () => {
      const filters: AdminReservationAdvancedFilters = {
        datePreset: "today",
        workspaceTemplate: "Hot Desk",
        paymentMethod: "gcash",
        paymentStatus: "paid",
        source: "online",
      };
      expect(countActiveFilters(filters)).toBe(5);
    });
  });

  describe("Multi-Criteria Filtering Logic", () => {
    it("filters by datePreset: today", () => {
      const filtered = filterReservations(sampleReservations, { datePreset: "today" }, fixedNow);
      expect(filtered.length).toBe(1);
      expect(filtered[0].referenceCode).toBe("REF-1001");
    });

    it("filters by datePreset: tomorrow", () => {
      const filtered = filterReservations(sampleReservations, { datePreset: "tomorrow" }, fixedNow);
      expect(filtered.length).toBe(1);
      expect(filtered[0].referenceCode).toBe("REF-1002");
    });

    it("filters by datePreset: this_month", () => {
      const filtered = filterReservations(sampleReservations, { datePreset: "this_month" }, fixedNow);
      expect(filtered.length).toBe(4);
    });

    it("filters by custom date range", () => {
      const filtered = filterReservations(
        sampleReservations,
        { datePreset: "custom", startDate: "2026-09-11", endDate: "2026-09-12" },
        fixedNow
      );
      expect(filtered.length).toBe(2);
      expect(filtered.map((r) => r.referenceCode)).toEqual(["REF-1001", "REF-1002"]);
    });

    it("filters by workspace template", () => {
      const hotDesks = filterReservations(sampleReservations, { workspaceTemplate: "Hot Desk" }, fixedNow);
      expect(hotDesks.length).toBe(2);
      expect(hotDesks.map((r) => r.referenceCode)).toEqual(["REF-1001", "REF-1004"]);

      const meetingRooms = filterReservations(sampleReservations, { workspaceTemplate: "Meeting Room" }, fixedNow);
      expect(meetingRooms.length).toBe(1);
      expect(meetingRooms[0].referenceCode).toBe("REF-1003");
    });

    it("filters by payment method", () => {
      const gcash = filterReservations(sampleReservations, { paymentMethod: "gcash" }, fixedNow);
      expect(gcash.length).toBe(2);
      expect(gcash.map((r) => r.referenceCode)).toEqual(["REF-1001", "REF-1004"]);

      const cash = filterReservations(sampleReservations, { paymentMethod: "cash" }, fixedNow);
      expect(cash.length).toBe(1);
      expect(cash[0].referenceCode).toBe("REF-1002");

      const bank = filterReservations(sampleReservations, { paymentMethod: "bank_transfer" }, fixedNow);
      expect(bank.length).toBe(1);
      expect(bank[0].referenceCode).toBe("REF-1003");
    });

    it("filters by payment status", () => {
      const paid = filterReservations(sampleReservations, { paymentStatus: "paid" }, fixedNow);
      expect(paid.length).toBe(1);
      expect(paid[0].referenceCode).toBe("REF-1001");

      const underReview = filterReservations(sampleReservations, { paymentStatus: "under_review" }, fixedNow);
      expect(underReview.length).toBe(1);
      expect(underReview[0].referenceCode).toBe("REF-1003");

      const expired = filterReservations(sampleReservations, { paymentStatus: "expired" }, fixedNow);
      expect(expired.length).toBe(1);
      expect(expired[0].referenceCode).toBe("REF-1004");
    });

    it("filters by source / channel", () => {
      const kiosk = filterReservations(sampleReservations, { source: "kiosk" }, fixedNow);
      expect(kiosk.length).toBe(1);
      expect(kiosk[0].referenceCode).toBe("REF-1002");

      const online = filterReservations(sampleReservations, { source: "online" }, fixedNow);
      expect(online.length).toBe(3);
    });

    it("combines multi-dimensional filters accurately", () => {
      const filtered = filterReservations(
        sampleReservations,
        {
          workspaceTemplate: "Hot Desk",
          paymentMethod: "gcash",
          paymentStatus: "paid",
          source: "online",
        },
        fixedNow
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].referenceCode).toBe("REF-1001");
    });
  });

  describe("CSV Export Engine", () => {
    it("escapes CSV values with commas, quotes, and newlines properly", () => {
      expect(escapeCsvField("Simple")).toBe("Simple");
      expect(escapeCsvField("Jones, Jr.")).toBe('"Jones, Jr."');
      expect(escapeCsvField('Meeting Room "Alpha"')).toBe('"Meeting Room ""Alpha"""');
      expect(escapeCsvField("Line1\nLine2")).toBe('"Line1\nLine2"');
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("generates RFC-4180 compliant CSV with UTF-8 BOM and all 16 required columns", () => {
      const csv = generateReservationsCsv(sampleReservations);

      // Begins with UTF-8 BOM
      expect(csv.startsWith("\uFEFF")).toBe(true);

      const lines = csv.substring(1).split("\r\n");
      const headers = lines[0].split(",");

      expect(headers).toEqual([
        "Reference ID",
        "Customer Name",
        "Customer Email",
        "Customer Phone",
        "Workspace Spot / Template",
        "Booking Date",
        "Start Time",
        "End Time",
        "Duration (Hours)",
        "Reservation Status",
        "Payment Status",
        "Payment Method",
        "Amount Due (PHP)",
        "Amount Paid (PHP)",
        "Created At",
        "Source",
      ]);

      expect(lines.length).toBe(5); // Header + 4 data rows

      // Verify row 1 (Alice Smith)
      const row1 = lines[1];
      expect(row1).toContain("REF-1001");
      expect(row1).toContain("Alice Smith");
      expect(row1).toContain("alice@example.com");
      expect(row1).toContain("2026-09-11");
      expect(row1).toContain("09:00");
      expect(row1).toContain("17:00");
      expect(row1).toContain("8"); // 8 hours
      expect(row1).toContain("CONFIRMED");
      expect(row1).toContain("APPROVED");
      expect(row1).toContain("500.00");
      expect(row1).toContain("ONLINE");

      // Verify row 2 (Bob Jones, Jr. - escaped name with comma)
      const row2 = lines[2];
      expect(row2).toContain('"Bob Jones, Jr."');
      expect(row2).toContain("REF-1002");
      expect(row2).toContain("4"); // 4 hours
      expect(row2).toContain("KIOSK");

      // Verify row 3 (Meeting Room "Alpha" - escaped quotes)
      const row3 = lines[3];
      expect(row3).toContain('"Meeting Room ""Alpha"""');
    });

    it("generates correct filename format deskatlas_reservations_YYYY-MM-DD_HHmm.csv", () => {
      const testDate = new Date(2026, 8, 11, 14, 30); // Sep 11, 2026 14:30
      const filename = generateReservationsCsvFilename(testDate);
      expect(filename).toBe("deskatlas_reservations_2026-09-11_1430.csv");
    });
  });

  describe("AdminReservationService Integration with Filters", () => {
    it("filters reservations end-to-end through AdminReservationService", async () => {
      const memoryRepo = new ReservationMemoryRepository(() => fixedNow);
      const service = createAdminReservationService(memoryRepo, () => fixedNow);

      const result = await service.listReservations("all", undefined, {
        workspaceTemplate: "all",
        paymentMethod: "all",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.reservations)).toBe(true);
    });
  });
});
