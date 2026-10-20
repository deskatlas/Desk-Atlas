// MS-73: Customer Reservation Tracking Self-Service Cancellation Modal Clean Schedule Date and Time Formatting
// Traceability: PRD-F5, PRD-F14, SDD-C4, DSD-UI11, ERD-E10, QAD-TC54, MS73-TC01..06

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("react", async () => vi.importActual("../apps/customer-website/node_modules/react"));
import React from "../apps/customer-website/node_modules/react";
import { renderToStaticMarkup } from "../apps/customer-website/node_modules/react-dom/server";

import { formatCleanScheduleRange } from "../apps/customer-website/src/features/tracking/utils/scheduleFormatter";
import { formatCleanScheduleRange as domainFormatCleanScheduleRange } from "@deskatlas/domain";
import { CustomerCancelModal } from "../apps/customer-website/src/features/tracking/components/CustomerCancelModal";

describe("MS-73: Customer Reservation Tracking Self-Service Cancellation Modal Clean Schedule Date and Time Formatting (QAD-TC54)", () => {
  it("MS73-TC01: Same-Day Schedule Range Formatting", () => {
    // Pass start 2026-10-23T02:30:00Z and end 2026-10-23T03:30:00Z in Asia/Manila (UTC+8: 10:30am to 11:30am)
    const startIso = "2026-10-23T02:30:00Z";
    const endIso = "2026-10-23T03:30:00Z";

    const formatted = formatCleanScheduleRange(startIso, endIso, "Asia/Manila", new Date("2026-10-21T00:00:00Z"));
    expect(formatted).toBe("October 23, 10:30am - 11:30am");

    // Also verify domain exported helper produces identical output
    const domainFormatted = domainFormatCleanScheduleRange(startIso, endIso, "Asia/Manila", new Date("2026-10-21T00:00:00Z"));
    expect(domainFormatted).toBe("October 23, 10:30am - 11:30am");
  });

  it("MS73-TC02: Afternoon / PM Hour Formatting", () => {
    // Pass start 2026-10-23T06:00:00Z (14:00 UTC+8) and end 2026-10-23T09:00:00Z (17:00 UTC+8)
    const startIso = "2026-10-23T06:00:00Z";
    const endIso = "2026-10-23T09:00:00Z";

    const formatted = formatCleanScheduleRange(startIso, endIso, "Asia/Manila", new Date("2026-10-21T00:00:00Z"));
    expect(formatted).toBe("October 23, 2:00pm - 5:00pm");
  });

  it("MS73-TC03: Cross-Day Multi-Date Schedule Formatting", () => {
    // Pass start 2026-10-23T02:00:00Z (10:00 UTC+8) and end 2026-10-24T04:00:00Z (12:00 UTC+8)
    const startIso = "2026-10-23T02:00:00Z";
    const endIso = "2026-10-24T04:00:00Z";

    const formatted = formatCleanScheduleRange(startIso, endIso, "Asia/Manila", new Date("2026-10-21T00:00:00Z"));
    expect(formatted).toBe("October 23, 10:00am - October 24, 12:00pm");
  });

  it("MS73-TC04: Non-Current Year Inclusion", () => {
    // Pass timestamps in year 2027 (future year relative to reference year 2026)
    const startIso = "2027-10-23T02:30:00Z";
    const endIso = "2027-10-23T03:30:00Z";

    const formatted = formatCleanScheduleRange(startIso, endIso, "Asia/Manila", new Date("2026-10-21T00:00:00Z"));
    expect(formatted).toBe("October 23, 2027, 10:30am - 11:30am");
  });

  it("MS73-TC05: Defensive Fallback on Raw ISO String in Modal", () => {
    // Pass raw ISO string concatenation directly to CustomerCancelModal
    const rawIsoSchedule = "2026-10-23T10:30:00.000Z - 2026-10-23T11:30:00.000Z";

    const html = renderToStaticMarkup(
      React.createElement(CustomerCancelModal, {
        isOpen: true,
        onClose: () => {},
        onSuccess: () => {},
        referenceCode: "REF-MS73-05",
        customerEmail: "guest@example.com",
        amountDue: 750,
        formattedSchedule: rawIsoSchedule,
        workspaceName: "Dedicated Desk 04",
      })
    );

    // Modal must not leak raw ISO 8601 timestamps
    expect(html).not.toContain("2026-10-23T10:30:00.000Z");
    expect(html).not.toContain("2026-10-23T11:30:00.000Z");

    // Modal must render clean schedule text inside testid
    expect(html).toContain('data-testid="cancel-modal-schedule-text"');
    expect(html).toContain("October 23, 6:30pm - 7:30pm");
  });

  it("MS73-TC06: Modal Render and Accessibility Conformance", () => {
    // Mount CustomerCancelModal with clean schedule
    const cleanSchedule = "October 23, 10:30am - 11:30am";
    const workspace = "Dedicated Desk 04";

    const html = renderToStaticMarkup(
      React.createElement(CustomerCancelModal, {
        isOpen: true,
        onClose: () => {},
        onSuccess: () => {},
        referenceCode: "REF-MS73-06",
        customerEmail: "guest@example.com",
        amountDue: 500,
        formattedSchedule: cleanSchedule,
        workspaceName: workspace,
      })
    );

    // Verify modal container and schedule element
    expect(html).toContain('data-testid="customer-cancel-modal"');
    expect(html).toContain('data-testid="cancel-modal-schedule-text"');
    expect(html).toContain(cleanSchedule);

    // Verify styling tokens: font-semibold and text-[var(--da-text-primary)]
    expect(html).toContain("font-semibold");
    expect(html).toContain("text-[var(--da-text-primary)]");

    // Verify workspace name interpolation
    expect(html).toContain("for Dedicated Desk 04");

    // Verify upstream TrackingPage binding in source code
    const trackingPagePath = path.resolve(
      __dirname,
      "../apps/customer-website/src/features/tracking/components/TrackingPage.tsx"
    );
    const trackingPageContent = fs.readFileSync(trackingPagePath, "utf-8");

    expect(trackingPageContent).toContain("formatCleanScheduleRange(");
    expect(trackingPageContent).toContain("data.finalAssignment.bookingStartAt");
    expect(trackingPageContent).toContain("data.finalAssignment.bookingEndAt");
    expect(trackingPageContent).not.toContain(
      "`${data.finalAssignment.bookingStartAt} - ${data.finalAssignment.bookingEndAt}`"
    );

    // Verify zero em-dashes across relevant modified files (BAN-PUNCT-01)
    const modalPath = path.resolve(
      __dirname,
      "../apps/customer-website/src/features/tracking/components/CustomerCancelModal.tsx"
    );
    const modalContent = fs.readFileSync(modalPath, "utf-8");
    const formatterPath = path.resolve(
      __dirname,
      "../apps/customer-website/src/features/tracking/utils/scheduleFormatter.ts"
    );
    const formatterContent = fs.readFileSync(formatterPath, "utf-8");

    expect(modalContent).not.toContain("\u2014"); // em-dash
    expect(modalContent).not.toContain("\u2013"); // en-dash
    expect(formatterContent).not.toContain("\u2014");
    expect(formatterContent).not.toContain("\u2013");
    expect(trackingPageContent).not.toContain("\u2014");
  });
});
