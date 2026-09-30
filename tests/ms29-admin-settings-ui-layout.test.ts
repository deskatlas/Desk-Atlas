import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createAdminSettingsService,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

/**
 * Tests for MS-29: Admin Portal Settings UI Responsive Layout Redesign and Full-Width Multi-Column Optimization.
 * Traceability: MS-29, BRD-M2, PRD-F10, SDD-C7, DSD-UI4, ERD-E2, ERD-E3, ERD-E4, ERD-E5, QAD-TC29
 */
describe("MS-29: Admin Portal Settings UI Layout Redesign & Integrity", () => {
  const settingsFilePath = path.resolve(
    __dirname,
    "../apps/admin-portal/src/features/settings/components/Settings.tsx"
  );
  const cancellationUploaderPath = path.resolve(
    __dirname,
    "../apps/admin-portal/src/features/settings/components/CancellationPolicyUploader.tsx"
  );

  // QAD-TC29-01: Verify settings container does not contain restrictive maxWidth: '750px'
  it("QAD-TC29-01: Verify settings container does not contain restrictive maxWidth: '750px' and uses max-w-[1400px]", () => {
    const content = fs.readFileSync(settingsFilePath, "utf-8");

    // Must NOT have the old restrictive 750px outer card wrapper
    assert.ok(
      !content.includes("maxWidth: '750px'"),
      "Settings.tsx must not contain the restrictive maxWidth: '750px' container"
    );

    // Must have responsive max-w-[1400px] or full-width container
    assert.ok(
      content.includes("max-w-[1400px]") || content.includes("maxWidth: '1400px'"),
      "Settings.tsx must contain max-w-[1400px] responsive container"
    );
  });

  // QAD-TC29-02: Verify Business Profile tab renders multi-column grid layout
  it("QAD-TC29-02: Verify Business Profile tab renders multi-column grid layout", () => {
    const content = fs.readFileSync(settingsFilePath, "utf-8");

    // Tab 1 must use responsive 2-column grid
    assert.ok(
      content.includes("grid grid-cols-1 lg:grid-cols-2 gap-6"),
      "Business Profile tab must render a 2-column responsive layout on desktop screens"
    );

    // Form sections must be organized in cards
    assert.ok(
      content.includes("Facility Information") &&
        content.includes("Booking & Operational Rules") &&
        content.includes("Cancellation & Rescheduling Policy") &&
        content.includes("Workspace Status Colors"),
      "Business Profile tab must include structured card headings for Facility, Operational Rules, Cancellation Policy, and Workspace Status Colors"
    );
  });

  // QAD-TC29-03: Verify all input field data-testid attributes are preserved
  it("QAD-TC29-03: Verify critical data-testid and accessibility attributes are preserved", () => {
    const settingsContent = fs.readFileSync(settingsFilePath, "utf-8");
    const uploaderContent = fs.readFileSync(cancellationUploaderPath, "utf-8");

    // Critical data-testid attributes that automated suites depend on
    const requiredSettingsTestIds = [
      'data-screen-label="Settings"',
      'data-testid="reschedule-max-advance-value-input"',
      'data-testid="reschedule-max-advance-unit-select"',
      'data-testid="near-checkout-threshold-input"',
      'data-testid="max-advance-booking-days-input"',
    ];

    for (const testId of requiredSettingsTestIds) {
      assert.ok(
        settingsContent.includes(testId),
        `Settings.tsx must preserve test selector: ${testId}`
      );
    }

    // Cancellation policy uploader test ids
    const requiredUploaderTestIds = [
      'data-testid="cancellation-policy-file-input"',
      'data-testid="cancellation-policy-card"',
      'data-testid="cancellation-policy-dropzone"',
    ];

    for (const testId of requiredUploaderTestIds) {
      assert.ok(
        uploaderContent.includes(testId),
        `CancellationPolicyUploader.tsx must preserve test selector: ${testId}`
      );
    }
  });

  // QAD-TC29-04: Verify Closures & Holidays renders calendar and form simultaneously
  it("QAD-TC29-04: Verify Closures & Holidays renders calendar and form in side-by-side layout", () => {
    const content = fs.readFileSync(settingsFilePath, "utf-8");

    // Closures tab must feature side-by-side desktop layout
    assert.ok(
      content.includes("grid grid-cols-1 lg:grid-cols-2 gap-6"),
      "Closures & Holidays tab must use a responsive multi-column layout"
    );

    assert.ok(
      content.includes("Configure Date Exception") &&
        content.includes("Save Date Exception"),
      "Closures & Holidays tab must contain exception scheduler form and actions"
    );
  });

  // QAD-TC29-05: Verify Payment Methods renders responsive card grid
  it("QAD-TC29-05: Verify Payment Methods renders responsive multi-column card grid", () => {
    const content = fs.readFileSync(settingsFilePath, "utf-8");

    // Payment methods tab should feature multi-column grid
    assert.ok(
      content.includes("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"),
      "Payment Methods tab must use a multi-column card grid"
    );
  });

  // QAD-TC29-06: Form submission and domain service payload integrity verification
  it("QAD-TC29-06: Form submission and domain service updateBusinessSettings payload integrity", async () => {
    const repo = new InMemorySettingsRepository();
    const service = createAdminSettingsService(repo);

    // Initial retrieval
    const initialOverview = await service.getSettingsOverview();
    assert.ok(initialOverview.businessSettings.businessName, "Initial business settings must exist");

    // Update business settings through domain service
    const updated = await service.updateBusinessSettings({
      businessName: "DeskAtlas Central Coworking",
      timezone: "Asia/Manila",
      contactEmail: "info@deskatlas.ph",
      contactPhone: "+639179998877",
      bookingIntervalMinutes: 30,
      paymentExpiryMinutes: 60,
      customerSessionTimeoutMinutes: 25,
      rescheduleMaxAdvanceValue: 14,
      rescheduleMaxAdvanceUnit: "DAYS",
      nearCheckoutThresholdMinutes: 15,
      maxAdvanceBookingDays: 60,
      cancellationPolicyPdfUrl: "https://example.com/cancellation-policy.pdf",
    });

    assert.equal(updated.businessName, "DeskAtlas Central Coworking");
    assert.equal(updated.contactEmail, "info@deskatlas.ph");
    assert.equal(updated.customerSessionTimeoutMinutes, 25);
    assert.equal(updated.rescheduleMaxAdvanceValue, 14);
    assert.equal(updated.rescheduleMaxAdvanceUnit, "DAYS");
    assert.equal(updated.nearCheckoutThresholdMinutes, 15);
    assert.equal(updated.maxAdvanceBookingDays, 60);
    assert.equal(
      updated.cancellationPolicyPdfUrl,
      "https://example.com/cancellation-policy.pdf"
    );

    // Verify persistence across subsequent reads
    const overviewAfter = await service.getSettingsOverview();
    assert.equal(
      overviewAfter.businessSettings.businessName,
      "DeskAtlas Central Coworking"
    );
    assert.equal(
      overviewAfter.businessSettings.cancellationPolicyPdfUrl,
      "https://example.com/cancellation-policy.pdf"
    );
  });
});
