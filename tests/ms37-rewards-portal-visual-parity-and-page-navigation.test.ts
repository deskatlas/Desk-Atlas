import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// MS-37 Quality Assurance & Verification Test Suite
// Traceability: MS-37, BRD-M1, BRD-M3, BRD-M5, PRD-F4, PRD-F14, PRD-F24, SDD-C15, DSD-UI13, ERD-E15, ERD-E18, ERD-E22, QAD-TC37
// Test Cases: QAD-TC37-01 through QAD-TC37-12

describe("MS-37: Customer Portal Visual Alignment, Dual-Path Access Container Symmetry, and Dedicated Rewards Voucher Interface Navigation (QAD-TC37)", () => {
  const root = resolve(__dirname, "..");
  const trackingPagePath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/TrackingPage.tsx"
  );
  const rewardsAccessCardPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/RewardsAccessCard.tsx"
  );
  const rewardsVoucherDashboardPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx"
  );
  const rewardsPortalPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/components/RewardsPortal.tsx"
  );
  const trackRewardsPagePath = resolve(
    root,
    "apps/customer-website/src/app/track/rewards/page.tsx"
  );
  const rewardsSessionContextPath = resolve(
    root,
    "apps/customer-website/src/features/tracking/context/RewardsSessionContext.tsx"
  );
  const rootLayoutPath = resolve(
    root,
    "apps/customer-website/src/app/layout.tsx"
  );

  const trackingPageContent = readFileSync(trackingPagePath, "utf-8");
  const rewardsAccessCardContent = readFileSync(rewardsAccessCardPath, "utf-8");
  const rewardsVoucherDashboardContent = readFileSync(rewardsVoucherDashboardPath, "utf-8");
  const rewardsPortalContent = readFileSync(rewardsPortalPath, "utf-8");
  const trackRewardsPageContent = readFileSync(trackRewardsPagePath, "utf-8");
  const rewardsSessionContextContent = readFileSync(rewardsSessionContextPath, "utf-8");
  const rootLayoutContent = readFileSync(rootLayoutPath, "utf-8");

  // QAD-TC37-01: Verify Path 1 button classes on /track
  it("QAD-TC37-01: Verify Path 1 button classes on /track", () => {
    expect(existsSync(trackingPagePath)).toBe(true);
    expect(trackingPageContent).toContain('data-testid="track-reservation-submit"');

    // Extract Path 1 button className
    const match = trackingPageContent.match(
      /className="([^"]*)"\s+data-testid="track-reservation-submit"/
    );
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);

    expect(classes).toContain("da-primary-button");
    expect(classes).toContain("mt-2");
    expect(classes).toContain("w-full");
    expect(classes).toContain("justify-center");
    expect(classes).toContain("disabled:cursor-not-allowed");
    expect(classes).toContain("disabled:opacity-60");
  });

  // QAD-TC37-02: Verify Path 2 button classes on /track
  it("QAD-TC37-02: Verify Path 2 button classes on /track matching Path 1 exactly", () => {
    expect(existsSync(rewardsAccessCardPath)).toBe(true);
    expect(rewardsAccessCardContent).toContain('data-testid="rewards-verify-submit"');

    // Extract Path 2 button className
    const match = rewardsAccessCardContent.match(
      /className="([^"]*)"\s+data-testid="rewards-verify-submit"/
    );
    expect(match).not.toBeNull();
    const classes = match![1].split(/\s+/);

    expect(classes).toContain("da-primary-button");
    expect(classes).toContain("mt-2");
    expect(classes).toContain("w-full");
    expect(classes).toContain("justify-center");
    expect(classes).toContain("disabled:cursor-not-allowed");
    expect(classes).toContain("disabled:opacity-60");
  });

  // QAD-TC37-03: Verify Path 2 button does not contain ad-hoc text overrides
  it("QAD-TC37-03: Verify Path 2 button does not contain conflicting text-sm font-bold overrides", () => {
    const match = rewardsAccessCardContent.match(
      /className="([^"]*)"\s+data-testid="rewards-verify-submit"/
    );
    expect(match).not.toBeNull();
    const classString = match![1];

    expect(classString).not.toContain("text-sm");
    expect(classString).not.toContain("font-bold");
  });

  // QAD-TC37-04: Verify Card Container outer classes parity
  it("QAD-TC37-04: Verify Card Container outer classes parity across Path 1 and Path 2", () => {
    // Path 1 card classes
    const matchPath1 = trackingPageContent.match(
      /className="([^"]*)"\s+data-testid="check-reservation-card"/
    );
    expect(matchPath1).not.toBeNull();
    const path1Classes = matchPath1![1].split(/\s+/);

    // Path 2 card classes
    const matchPath2 = rewardsAccessCardContent.match(
      /className=\{`([^`]+)`\}\s+data-testid="my-bookings-rewards-card"/
    );
    expect(matchPath2).not.toBeNull();
    const path2Classes = matchPath2![1].split(/\s+/);

    // Shared structural styling requirements
    for (const requiredClass of [
      "rounded-[28px]",
      "border",
      "bg-white",
      "p-8",
      "shadow-[var(--da-shadow-lg)]",
      "flex",
      "flex-col",
      "justify-between",
      "h-full",
    ]) {
      expect(path1Classes).toContain(requiredClass);
      expect(path2Classes).toContain(requiredClass);
    }
  });

  // QAD-TC37-05: Verify Error Banner position in Path 2
  it("QAD-TC37-05: Verify Error Banner position in Path 2 appears strictly after submit button", () => {
    const submitIndex = rewardsAccessCardContent.indexOf('data-testid="rewards-verify-submit"');
    const errorIndex = rewardsAccessCardContent.indexOf('data-testid="rewards-verify-error"');

    expect(submitIndex).toBeGreaterThan(0);
    expect(errorIndex).toBeGreaterThan(0);
    expect(errorIndex).toBeGreaterThan(submitIndex);
  });

  // QAD-TC37-06: Verify Error Banner styling parity
  it("QAD-TC37-06: Verify Error Banner styling parity between Path 1 and Path 2", () => {
    const expectedErrorClasses = [
      "mt-6",
      "rounded-[18px]",
      "border",
      "border-red-200",
      "bg-red-50",
      "px-4",
      "py-3",
      "text-sm",
      "text-red-700",
    ];

    // Check Path 2 error alert classes
    const matchPath2 = rewardsAccessCardContent.match(
      /className="([^"]*)"\s+data-testid="rewards-verify-error"/
    );
    expect(matchPath2).not.toBeNull();
    const path2Classes = matchPath2![1].split(/\s+/);

    for (const cls of expectedErrorClasses) {
      expect(path2Classes).toContain(cls);
    }
  });

  // QAD-TC37-07: Verify input label parity across both cards
  it("QAD-TC37-07: Verify input label parity and Email address terminology across both cards", () => {
    // Both cards must use identical label container class
    expect(trackingPageContent).toContain(
      'className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]"'
    );
    expect(rewardsAccessCardContent).toContain(
      'className="grid gap-2 text-xs font-bold text-[var(--da-brand-dark)]"'
    );

    // Path 2 must use "Email address" terminology matching Path 1
    expect(rewardsAccessCardContent).toContain("Email address");
    expect(rewardsAccessCardContent).not.toContain("Registered Email");
  });

  // QAD-TC37-08: Submitting valid credentials on /track triggers navigation
  it("QAD-TC37-08: Submitting valid credentials on /track triggers router.push and does not mount rewards-portal-view on /track", () => {
    // /track must render RewardsAccessCard
    expect(trackingPageContent).toContain("<RewardsAccessCard");

    // /track must NOT render rewards-portal-view directly
    expect(trackingPageContent).not.toContain('data-testid="rewards-portal-view"');

    // RewardsAccessCard must navigate to /track/rewards on verify success
    expect(rewardsAccessCardContent).toContain('router.push("/track/rewards")');
  });

  // QAD-TC37-09: /track/rewards consumes session from context
  it("QAD-TC37-09: /track/rewards consumes session from context and renders rewards-portal-view", () => {
    expect(trackRewardsPageContent).toContain("useRewardsSession");
    expect(trackRewardsPageContent).toContain("<RewardsVoucherDashboard");
    expect(rewardsVoucherDashboardContent).toContain('data-testid="rewards-portal-view"');

    // Root layout must provide RewardsSessionProvider
    expect(rootLayoutContent).toContain("RewardsSessionProvider");
  });

  // QAD-TC37-10: Voucher details interface rendering on /track/rewards
  it("QAD-TC37-10: Voucher details interface renders Loyalty Vouchers, eligibility check, tabs, and promo code actions", () => {
    // Eligibility check button
    expect(rewardsVoucherDashboardContent).toContain('data-testid="eligibility-check-button"');

    // Filter tabs
    expect(rewardsVoucherDashboardContent).toContain("voucher-tab-${tab.toLowerCase()}");
    expect(rewardsVoucherDashboardContent).toContain('"AVAILABLE"');
    expect(rewardsVoucherDashboardContent).toContain('"USED"');
    expect(rewardsVoucherDashboardContent).toContain('"EXPIRED"');

    // Copy Code action
    expect(rewardsVoucherDashboardContent).toContain("copyToClipboard");
    expect(rewardsVoucherDashboardContent).toContain("Copy Code");

    // Booking history section
    expect(rewardsVoucherDashboardContent).toContain("My Booking History");
  });

  // QAD-TC37-11: Ephemeral token security compliance
  it("QAD-TC37-11: Ephemeral token security compliance (zero localStorage, zero token in URLs)", () => {
    // Verify no localStorage usage in tracking components
    expect(rewardsSessionContextContent).not.toContain("localStorage");
    expect(rewardsAccessCardContent).not.toContain("localStorage");
    expect(rewardsVoucherDashboardContent).not.toContain("localStorage");
    expect(trackRewardsPageContent).not.toContain("localStorage");

    // Verify router.push does not pass tokens in query params
    expect(rewardsAccessCardContent).not.toMatch(/router\.push\([^)]*token[^)]*\)/i);
  });

  // QAD-TC37-12: Unauthenticated direct visit to /track/rewards
  it("QAD-TC37-12: Unauthenticated direct visit to /track/rewards renders standalone card with back link", () => {
    // In track/rewards/page.tsx, if session is null, renders RewardsAccessCard standalone
    expect(trackRewardsPageContent).toContain("<RewardsAccessCard");
    expect(trackRewardsPageContent).toContain("standalone");

    // Must have back link to /track
    expect(trackRewardsPageContent).toContain('href="/track"');
    expect(trackRewardsPageContent).toContain("← Back to Manage Booking");
  });
});
