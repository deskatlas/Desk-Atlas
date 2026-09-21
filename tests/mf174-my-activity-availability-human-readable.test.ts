import { describe, it, expect } from "vitest";
import {
  formatAvailability,
  formatOperationalStatus,
  formatBlockingReason,
  formatMetadataValue,
  getHumanReadableMetadata,
} from "@deskatlas/domain";

describe("MF-174: My Activity View Details: Human-Readable Availability Fields", () => {
  it("formatAvailability returns 'Available' for isBookable: true", () => {
    const result = formatAvailability({ isBookable: true });
    expect(result.status).toBe("Available");
  });

  it("formatAvailability returns 'Not Available' for isBookable: false without extra context", () => {
    const result = formatAvailability({ isBookable: false });
    expect(result.status).toBe("Not Available");
  });

  it("formatAvailability returns clean friendly unavailable reason when operationalStatus is under maintenance", () => {
    const result = formatAvailability({
      isBookable: false,
      operationalStatus: "UNDER_MAINTENANCE",
      blockingReason: "OPERATIONAL_STATUS_BLOCKED",
    });
    expect(result.status).toBe("Unavailable (Under Maintenance)");
  });

  it("formatAvailability returns clean friendly unavailable reason when operationalStatus is inactive", () => {
    const result = formatAvailability({
      isBookable: false,
      operationalStatus: "INACTIVE",
      blockingReason: "OPERATIONAL_STATUS_BLOCKED",
    });
    expect(result.status).toBe("Unavailable (Inactive)");
  });

  it("null blocking reason does not produce the string 'null'", () => {
    const result = formatAvailability({
      isBookable: true,
      blockingReason: null,
    });
    expect(result.blockingReason).toBeNull();
    expect(result.blockingReason).not.toBe("null");

    // Also check formatting through formatMetadataValue and getHumanReadableMetadata
    const formattedMeta = getHumanReadableMetadata({
      availability: {
        isBookable: true,
        blockingReason: null,
      },
    });
    expect(formattedMeta.length).toBe(1);
    expect(formattedMeta[0].value).not.toContain("null");
    expect(formattedMeta[0].value).toBe("Available");
  });

  it("ACTIVE operational status renders as 'Active'", () => {
    expect(formatOperationalStatus("ACTIVE")).toBe("Active");

    const avail = formatAvailability({
      isBookable: true,
      operationalStatus: "ACTIVE",
    });
    expect(avail.operationalStatus).toBe("Active");
  });

  it("UNDER_MAINTENANCE renders as 'Under Maintenance'", () => {
    expect(formatOperationalStatus("UNDER_MAINTENANCE")).toBe("Under Maintenance");

    const avail = formatAvailability({
      isBookable: false,
      operationalStatus: "UNDER_MAINTENANCE",
    });
    expect(avail.operationalStatus).toBe("Under Maintenance");
  });

  it("INACTIVE operational status renders as 'Inactive'", () => {
    expect(formatOperationalStatus("INACTIVE")).toBe("Inactive");
  });

  it("CLOSED, MAINTENANCE, and HOLIDAY blocking reasons render cleanly", () => {
    expect(formatBlockingReason("CLOSED")).toBe("Closed");
    expect(formatBlockingReason("MAINTENANCE")).toBe("Under Maintenance");
    expect(formatBlockingReason("HOLIDAY")).toBe("Holiday");
    expect(formatBlockingReason("OPERATIONAL_STATUS_BLOCKED")).toBe("Workspace Status Blocked");
    expect(formatBlockingReason("RESERVATION_CONFLICT")).toBe("Reserved / Occupied");
  });

  it("unknown enum values fall back gracefully (no crash)", () => {
    expect(formatOperationalStatus("CUSTOM_STATUS")).toBe("Custom Status");
    expect(formatBlockingReason("SPECIAL_EVENT_BLOCK")).toBe("Special Event Block");

    const customAvail = formatAvailability({
      isBookable: false,
      blockingReason: "CUSTOM_UNKNOWN_REASON",
      operationalStatus: "CUSTOM_UNKNOWN_STATUS",
    });
    expect(customAvail.status).toBe("Unavailable (Custom Unknown Status)");
    expect(customAvail.blockingReason).toBe("Custom Unknown Reason");
    expect(customAvail.operationalStatus).toBe("Custom Unknown Status");
  });

  it("formats composite availability metadata object without raw booleans, nulls, or technical clauses", () => {
    const rawMetadata = {
      availability: {
        isBookable: true,
        blockingReason: null,
        templateIsActive: true,
        operationalStatus: "ACTIVE",
      },
    };

    const items = getHumanReadableMetadata(rawMetadata);
    expect(items.length).toBe(1);
    expect(items[0].key).toBe("availability");
    expect(items[0].label).toBe("Availability");
    expect(items[0].value).toBe("Available");
    expect(items[0].value).not.toContain("null");
    expect(items[0].value).not.toContain("true");
    expect(items[0].value).not.toContain("Status:");
    expect(items[0].value).not.toContain("ACTIVE");
  });

  it("formats under maintenance availability cleanly for non-tech users (no technical semi-colon lists)", () => {
    const rawMetadata = {
      availability: {
        isBookable: false,
        blockingReason: "OPERATIONAL_STATUS_BLOCKED",
        templateIsActive: true,
        operationalStatus: "UNDER_MAINTENANCE",
      },
    };

    const items = getHumanReadableMetadata(rawMetadata);
    expect(items.length).toBe(1);
    expect(items[0].value).toBe("Unavailable (Under Maintenance)");
    expect(items[0].value).not.toContain("Status: Not Available");
    expect(items[0].value).not.toContain("Operational Status Blocked");
  });

  it("formats inactive template correctly in availability object", () => {
    const rawMetadata = {
      availability: {
        isBookable: false,
        blockingReason: "TEMPLATE_INACTIVE",
        templateIsActive: false,
      },
    };

    const items = getHumanReadableMetadata(rawMetadata);
    expect(items.length).toBe(1);
    expect(items[0].value).toBe("Unavailable (Template Inactive)");
  });

  it("formats top-level availability fields cleanly", () => {
    const rawMetadata = {
      is_bookable: true,
      operational_status: "ACTIVE",
      blocking_reason: null,
    };

    const items = getHumanReadableMetadata(rawMetadata);
    // blocking_reason: null is omitted
    expect(items.some((i) => i.key === "blocking_reason")).toBe(false);

    const bookableItem = items.find((i) => i.key === "is_bookable");
    expect(bookableItem?.value).toBe("Available");

    const statusItem = items.find((i) => i.key === "operational_status");
    expect(statusItem?.value).toBe("Active");
  });
});
