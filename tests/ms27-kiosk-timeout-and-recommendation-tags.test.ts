import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  resolveKioskTimeoutMs,
  resolveKioskWarningTimeoutMs,
  createAdminSettingsService,
  InMemorySettingsRepository,
} from "@deskatlas/domain";

/**
 * Tests for MS-27: Kiosk Dynamic Inactivity Timeout Configuration Enforcement
 * and Interactive Map Recommendation Tag Badges.
 * Traceability: MS-27, BRD-M1, BRD-M4, PRD-F7, PRD-F10, SDD-C5, SDD-C7, DSD-UI2, ERD-E2, ERD-E9, ERD-E10, QAD-TC27
 */
describe("MS-27: Kiosk Timeout Dynamic Settings Binding & Map Recommendation Tags", () => {
  // QAD-TC27-01: Calculate timeout with kiosk_timeout_minutes = 60
  it("QAD-TC27-01: resolveKioskTimeoutMs calculates 3,600,000 ms for kiosk_timeout_minutes = 60", () => {
    const timeoutMs = resolveKioskTimeoutMs(60);
    assert.equal(timeoutMs, 3600000, "60 minutes must resolve to 3,600,000 ms");

    const timeoutMs5 = resolveKioskTimeoutMs(5);
    assert.equal(timeoutMs5, 300000, "5 minutes must resolve to 300,000 ms");
  });

  // QAD-TC27-02: Verify fallback for missing/null timeout setting
  it("QAD-TC27-02: resolveKioskTimeoutMs returns 3,600,000 ms (60 minutes default) for null, undefined, or invalid input", () => {
    assert.equal(resolveKioskTimeoutMs(null), 3600000, "null must fallback to 60 minutes (3,600,000 ms)");
    assert.equal(resolveKioskTimeoutMs(undefined), 3600000, "undefined must fallback to 60 minutes (3,600,000 ms)");
    assert.equal(resolveKioskTimeoutMs(0), 3600000, "0 minutes must fallback to 60 minutes");
    assert.equal(resolveKioskTimeoutMs(-5), 3600000, "negative minutes must fallback to 60 minutes");
    assert.equal(resolveKioskTimeoutMs(NaN), 3600000, "NaN must fallback to 60 minutes");

    // Clamping over 180 minutes to 180 minutes (10,800,000 ms)
    assert.equal(resolveKioskTimeoutMs(200), 10800000, "Values over 180 minutes must clamp to 180 minutes");
  });

  // QAD-TC27-03: SessionManager warning threshold calculation for 60-minute session
  it("QAD-TC27-03: resolveKioskWarningTimeoutMs calculates 30,000 ms warning for a 60-minute session", () => {
    const sixtyMinMs = resolveKioskTimeoutMs(60);
    const warningMs = resolveKioskWarningTimeoutMs(sixtyMinMs);
    assert.equal(warningMs, 30000, "60-minute session must have a 30-second warning threshold");

    // For a shorter session (e.g. 1 minute = 60,000 ms)
    const oneMinMs = resolveKioskTimeoutMs(1);
    const shortWarningMs = resolveKioskWarningTimeoutMs(oneMinMs);
    assert.equal(shortWarningMs, 12000, "1-minute session must calculate 20% warning (12 seconds)");
  });

  // QAD-TC27-04: Verify source code in reserve/page.tsx renders recommendation tag micro-pills on map elements
  it("QAD-TC27-04: Kiosk map elements render recommendation tag pills from wsModel.tags", () => {
    const reservePagePath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/kiosk/reserve/page.tsx"
    );
    const content = fs.readFileSync(reservePagePath, "utf-8");

    // Must check for wsModel?.tags and render tag micro-pills
    assert.ok(
      content.includes("wsModel?.tags && wsModel.tags.length > 0"),
      "Kiosk reserve page must check for workspace recommendation tags on map elements"
    );
    assert.ok(
      content.includes("wsModel.tags.slice(0, 2).map((tag) =>"),
      "Kiosk reserve page must render tag micro-pills for up to 2 tags"
    );
  });

  // QAD-TC27-05: Verify source code in reserve/page.tsx renders recommendation tags on category cards
  it("QAD-TC27-05: Kiosk category instance cards render recommendation tag badges", () => {
    const reservePagePath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/kiosk/reserve/page.tsx"
    );
    const content = fs.readFileSync(reservePagePath, "utf-8");

    assert.ok(
      content.includes("inst.tags") && content.includes("rounded-full bg-[rgba(0,150,137,0.08)]"),
      "Category instance cards must render tag badge pills"
    );
  });

  // QAD-TC27-06: getPublicBusinessSettings returns kioskTimeoutMinutes
  it("QAD-TC27-06: getPublicBusinessSettings returns kioskTimeoutMinutes with fallback", async () => {
    const memoryRepo = new InMemorySettingsRepository();
    const service = createAdminSettingsService(memoryRepo);

    const publicSettings = await service.getPublicBusinessSettings();
    assert.equal(
      typeof publicSettings.kioskTimeoutMinutes,
      "number",
      "getPublicBusinessSettings must include kioskTimeoutMinutes"
    );
    assert.ok(
      publicSettings.kioskTimeoutMinutes >= 1,
      "kioskTimeoutMinutes must be a valid positive integer"
    );
  });

  // QAD-TC27-07: Source code verification for useKioskSettings and SessionManager wiring
  it("QAD-TC27-07: Kiosk start and reserve pages wire dynamic timeout settings to SessionManager", () => {
    const reservePagePath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/kiosk/reserve/page.tsx"
    );
    const reserveContent = fs.readFileSync(reservePagePath, "utf-8");
    assert.ok(
      reserveContent.includes("useKioskSettings"),
      "reserve/page.tsx must import and call useKioskSettings"
    );
    assert.ok(
      reserveContent.includes("timeoutMs={kioskTimeoutMs}"),
      "reserve/page.tsx must pass kioskTimeoutMs to SessionManager"
    );
    assert.ok(
      reserveContent.includes("warningTimeoutMs={warningTimeoutMs}"),
      "reserve/page.tsx must pass warningTimeoutMs to SessionManager"
    );

    const startPagePath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/kiosk/page.tsx"
    );
    const startContent = fs.readFileSync(startPagePath, "utf-8");
    assert.ok(
      startContent.includes("useKioskSettings"),
      "kiosk/page.tsx must import and call useKioskSettings"
    );
    assert.ok(
      startContent.includes("timeoutMs={kioskTimeoutMs}"),
      "kiosk/page.tsx must pass kioskTimeoutMs to SessionManager"
    );
  });
});
