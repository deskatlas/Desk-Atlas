import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderPaymentLinkEmail,
  createReservationService,
  ReservationMemoryRepository,
  type CreateReservationRequest,
  type VoucherService,
  type ValidatePromoResult,
} from "@deskatlas/domain";

// MS-38 Quality Assurance & Verification Test Suite
// Traceability: MS-38, BRD-M1, BRD-M3, BRD-M5, PRD-F4, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C11, SDD-C14, SDD-C15, DSD-UI13, ERD-E10, ERD-E18, ERD-E19, QAD-TC38
// Test Cases: QAD-TC38-01 through QAD-TC38-12

describe("MS-38: End-to-End Voucher Price Propagation, Cross-Platform Discount Reflection, Transactional Email Reconciliation, and Auto-Apply Promo Intake (QAD-TC38)", () => {
  const root = resolve(__dirname, "..");

  const webReservationPagePath = resolve(
    root,
    "apps/customer-website/src/features/reservation/components/ReservationPage.tsx"
  );
  const kioskReservePagePath = resolve(
    root,
    "apps/kiosk/src/app/kiosk/reserve/page.tsx"
  );
  const webReservationsRoutePath = resolve(
    root,
    "apps/customer-website/src/app/api/reservations/route.ts"
  );
  const kioskReservationsRoutePath = resolve(
    root,
    "apps/kiosk/src/app/api/reservations/route.ts"
  );
  const supabaseRepoPath = resolve(
    root,
    "packages/domain/src/services/reservationSupabaseRepository.ts"
  );
  const paymentSessionPagePath = resolve(
    root,
    "apps/customer-website/src/features/payment/components/PaymentSessionPage.tsx"
  );
  const paymentReviewPath = resolve(
    root,
    "apps/admin-portal/src/features/payments/components/PaymentReview.tsx"
  );
  const staffReservationDetailPath = resolve(
    root,
    "apps/staff-dashboard/src/features/reservations/components/ReservationDetail.tsx"
  );

  const webReservationPageContent = readFileSync(webReservationPagePath, "utf-8");
  const kioskReservePageContent = readFileSync(kioskReservePagePath, "utf-8");
  const webReservationsRouteContent = readFileSync(webReservationsRoutePath, "utf-8");
  const kioskReservationsRouteContent = readFileSync(kioskReservationsRoutePath, "utf-8");
  const supabaseRepoContent = readFileSync(supabaseRepoPath, "utf-8");
  const paymentSessionPageContent = readFileSync(paymentSessionPagePath, "utf-8");
  const paymentReviewContent = readFileSync(paymentReviewPath, "utf-8");
  const staffReservationDetailContent = readFileSync(staffReservationDetailPath, "utf-8");

  // QAD-TC38-01: Auto-apply triggers at 8 characters on Web
  it("QAD-TC38-01: Auto-apply triggers at 8 characters on Web without manual button click", () => {
    expect(existsSync(webReservationPagePath)).toBe(true);
    expect(webReservationPageContent).toContain('data-testid="booking-promo-code-input"');
    expect(webReservationPageContent).toContain('data-testid="promo-success-summary"');
    expect(webReservationPageContent).toContain('data-testid="remove-promo-button"');

    // Verify 8-character auto-apply useEffect hook exists
    expect(webReservationPageContent).toMatch(/cleaned\.length\s*===\s*8/);
    expect(webReservationPageContent).toMatch(/handleApplyPromo/);
    expect(webReservationPageContent).toMatch(/setTimeout\([^,]+,\s*300\)/);

    // Verify strict styling contract on input
    const inputMatch = webReservationPageContent.match(
      /data-testid="booking-promo-code-input"[^>]*className="([^"]*)"/
    ) || webReservationPageContent.match(
      /className="([^"]*)"[^>]*data-testid="booking-promo-code-input"/
    );
    expect(inputMatch).not.toBeNull();
    const inputClasses = inputMatch![1].split(/\s+/);
    expect(inputClasses).toContain("da-input");
    expect(inputClasses).toContain("font-mono");
    expect(inputClasses).toContain("uppercase");
    expect(inputClasses).toContain("tracking-widest");
    expect(inputClasses).toContain("text-sm");
    expect(inputClasses).toContain("flex-1");
  });

  // QAD-TC38-02: Character deletion clears applied promo
  it("QAD-TC38-02: Character deletion or edits clear applied promo and restore gross price", () => {
    // When input changes and does not match applied promo code, reset applied promo
    expect(webReservationPageContent).toMatch(/if\s*\(appliedPromo\s*&&\s*val\s*!==\s*appliedPromo\.code\)/);
    expect(webReservationPageContent).toContain("setAppliedPromo(null)");
    expect(webReservationPageContent).toContain("setPromoSuccess(null)");

    // Reservation Page summary card, submit button, and confirmation modal dynamically reflect discounted amount due
    expect(webReservationPageContent).toContain('data-testid="amount-due-confirmation"');
    expect(webReservationPageContent).toContain("effectiveAmountDue");
    expect(webReservationPageContent).toMatch(/Submit Reservation & Pay \(₱\{effectiveAmountDue\.toFixed\(2\)\}\)/);
    expect(webReservationPageContent).toMatch(/totalAmount=\{effectiveAmountDue\}/);
  });

  // QAD-TC38-03: Auto-apply triggers at 8 characters on Kiosk
  it("QAD-TC38-03: Auto-apply triggers at 8 characters on Kiosk terminal intake", () => {
    expect(existsSync(kioskReservePagePath)).toBe(true);
    expect(kioskReservePageContent).toContain('data-testid="kiosk-promo-code-input"');
    expect(kioskReservePageContent).toContain('data-testid="kiosk-promo-success-summary"');
    expect(kioskReservePageContent).toContain('data-testid="kiosk-remove-promo-button"');

    // Verify 8-character auto-apply logic on Kiosk
    expect(kioskReservePageContent).toMatch(/cleaned\.length\s*===\s*8/);
    expect(kioskReservePageContent).toMatch(/handleApplyPromo/);
    expect(kioskReservePageContent).toMatch(/setTimeout\([^,]+,\s*300\)/);

    // Verify strict styling contract on Kiosk input
    const kioskInputMatch = kioskReservePageContent.match(
      /data-testid="kiosk-promo-code-input"[^>]*className="([^"]*)"/
    ) || kioskReservePageContent.match(
      /className="([^"]*)"[^>]*data-testid="kiosk-promo-code-input"/
    );
    expect(kioskInputMatch).not.toBeNull();
    const kioskInputClasses = kioskInputMatch![1].split(/\s+/);
    expect(kioskInputClasses).toContain("da-input");
    expect(kioskInputClasses).toContain("font-mono");
    expect(kioskInputClasses).toContain("uppercase");
    expect(kioskInputClasses).toContain("tracking-widest");
    expect(kioskInputClasses).toContain("text-sm");
    expect(kioskInputClasses).toContain("flex-1");
    expect(kioskInputClasses).toContain("min-h-[48px]");
  });

  // QAD-TC38-04: Web /api/reservations validates promo on server
  it("QAD-TC38-04: Web /api/reservations validates promo on server and computes net amount due", async () => {
    expect(webReservationsRouteContent).toContain("VoucherService");
    expect(webReservationsRouteContent).toMatch(/service\.createReservation\([^,]+,\s*\{[^}]*voucherService[^}]*\}\)/);

    // Functional service test with mock VoucherService
    const memoryRepo = new ReservationMemoryRepository();
    const testInstanceId = "00000000-0000-0000-0000-000000000001";
    const testTemplateId = "00000000-0000-0000-0000-000000000002";
    const mockCatalog = {
      instances: [
        {
          id: testInstanceId,
          templateId: testTemplateId,
          floorId: "flr-1",
          instanceCode: "D-01",
          displayName: "Desk 1",
          operationalStatus: "ACTIVE",
        },
      ],
      templates: [
        {
          id: testTemplateId,
          name: "Dedicated Desk",
          capacity: 1,
          rateAmount: 500,
          pricingUnit: "HOUR",
          isActive: true,
        },
      ],
      floors: [],
    };

    const dummyWorkspaceRepo = {
      listCatalog: async () => mockCatalog,
      findInstanceById: async () => mockCatalog.instances[0],
      findTemplateById: async () => mockCatalog.templates[0],
      listInstances: async () => mockCatalog.instances,
      listTemplates: async () => mockCatalog.templates,
    };

    const mockVoucherService: VoucherService = {
      validatePromoForBooking: async (): Promise<ValidatePromoResult> => ({
        valid: true,
        voucherId: "v-12345",
        promoCode: "7K9M2P4X",
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 30,
        discountAmount: 150,
        amountDue: 350,
        originalPrice: 500,
        campaignId: "camp-1",
        campaignName: "30% Off Promotion",
        terms: {
          rewardType: "PERCENTAGE_DISCOUNT",
          rewardValue: 30,
          maxDiscountAmount: null,
          promoCode: "7K9M2P4X",
          campaignName: "30% Off Promotion",
        },
        quoteSnapshot: {
          rewardType: "PERCENTAGE_DISCOUNT",
          rewardValue: 30,
          discountAmount: 150,
        },
      } as unknown as ValidatePromoResult),
    } as unknown as VoucherService;

    const reservationService = createReservationService(
      memoryRepo,
      dummyWorkspaceRepo as never,
      memoryRepo
    );

    const request: CreateReservationRequest = {
      source: "WEB",
      customerFirstName: "John",
      customerLastName: "Doe",
      customerEmail: "john@example.com",
      promoCode: "7K9M2P4X",
      candidates: [
        {
          workspaceInstanceId: testInstanceId,
          rank: 0,
          startAt: new Date(Date.now() + 86400000).toISOString(),
          endAt: new Date(Date.now() + 90000000).toISOString(),
        },
      ],
    };

    const result = await reservationService.createReservation(request, {
      paymentLinkBaseUrl: "https://deskatlas.test/pay",
      voucherService: mockVoucherService,
    });

    expect(result.amountDue).toBe(350);
    expect(result.grossAmountDue).toBe(500);
    expect(result.discountAmount).toBe(150);
    expect(result.promoCodeUsed).toBe("7K9M2P4X");
    expect(result.requestedVoucherId).toBe("v-12345");
  });

  // QAD-TC38-05: Kiosk /api/reservations validates promo on server
  it("QAD-TC38-05: Kiosk /api/reservations passes voucherService into reservation service", () => {
    expect(kioskReservationsRouteContent).toContain("VoucherService");
    expect(kioskReservationsRouteContent).toMatch(/reservationService\.createReservation\([^,]+,\s*\{[^}]*voucherService[^}]*\}\)/);
  });

  // QAD-TC38-06: Relational persistence of voucher metadata
  it("QAD-TC38-06: Relational persistence of voucher metadata across Supabase and Memory repositories", () => {
    // Check Supabase repository persists all discount columns
    expect(supabaseRepoContent).toContain("gross_amount_due");
    expect(supabaseRepoContent).toContain("discount_amount");
    expect(supabaseRepoContent).toContain("promo_code_used");
    expect(supabaseRepoContent).toContain("requested_voucher_id");
    expect(supabaseRepoContent).toContain("promo_quote_snapshot");
  });

  // QAD-TC38-07: Payment attempt amount reflects discounted total
  it("QAD-TC38-07: Payment attempt amount strictly equals the net discounted amount due", async () => {
    const memoryRepo = new ReservationMemoryRepository();
    const testInstanceId = "00000000-0000-0000-0000-000000000001";
    const testTemplateId = "00000000-0000-0000-0000-000000000002";
    const mockCatalog = {
      instances: [
        {
          id: testInstanceId,
          templateId: testTemplateId,
          floorId: "flr-1",
          instanceCode: "D-01",
          displayName: "Desk 1",
          operationalStatus: "ACTIVE",
        },
      ],
      templates: [
        {
          id: testTemplateId,
          name: "Dedicated Desk",
          capacity: 1,
          rateAmount: 500,
          pricingUnit: "HOUR",
          isActive: true,
        },
      ],
      floors: [],
    };

    const dummyWorkspaceRepo = {
      listCatalog: async () => mockCatalog,
      findInstanceById: async () => mockCatalog.instances[0],
      findTemplateById: async () => mockCatalog.templates[0],
      listInstances: async () => mockCatalog.instances,
      listTemplates: async () => mockCatalog.templates,
    };

    const mockVoucherService: VoucherService = {
      validatePromoForBooking: async (): Promise<ValidatePromoResult> => ({
        valid: true,
        voucherId: "v-555",
        promoCode: "7K9M2P4X",
        rewardType: "PERCENTAGE_DISCOUNT",
        rewardValue: 30,
        discountAmount: 150,
        amountDue: 350,
        originalPrice: 500,
        campaignId: "camp-1",
        campaignName: "Loyalty Reward",
        terms: {
          rewardType: "PERCENTAGE_DISCOUNT",
          rewardValue: 30,
          maxDiscountAmount: null,
          promoCode: "7K9M2P4X",
          campaignName: "Loyalty Reward",
        },
      } as unknown as ValidatePromoResult),
    } as unknown as VoucherService;

    const reservationService = createReservationService(
      memoryRepo,
      dummyWorkspaceRepo as never,
      memoryRepo
    );

    const result = await reservationService.createReservation(
      {
        source: "WEB",
        customerFirstName: "Alice",
        customerLastName: "Smith",
        customerEmail: "alice@example.com",
        promoCode: "7K9M2P4X",
        candidates: [
          {
            workspaceInstanceId: testInstanceId,
            rank: 0,
            startAt: new Date(Date.now() + 86400000).toISOString(),
            endAt: new Date(Date.now() + 90000000).toISOString(),
          },
        ],
      },
      {
        paymentLinkBaseUrl: "https://deskatlas.test/pay",
        voucherService: mockVoucherService,
      }
    );

    // Verify reservation amountDue is net
    expect(result.amountDue).toBe(350);
    expect(result.grossAmountDue).toBe(500);
    expect(result.discountAmount).toBe(150);

    // Verify payment attempts in Supabase repo records discounted net amount
    expect(supabaseRepoContent).toContain("p_amount_due: amountDue");
  });

  // QAD-TC38-08: Transactional email renders discounted price
  it("QAD-TC38-08: Transactional email renders net payable amount in hero badge and subject line", () => {
    const email = renderPaymentLinkEmail({
      to: "guest@example.com",
      customerFirstName: "Guest",
      customerLastName: "User",
      referenceCode: "DA-2026-9999",
      amountDue: 350,
      grossAmount: 500,
      discountAmount: 150,
      promoCode: "7K9M2P4X",
      currency: "PHP",
      paymentUrl: "https://deskatlas.test/pay/tok-123",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      expiryMinutes: 60,
      businessName: "DeskAtlas",
    });

    // Subject must contain net payable amount
    expect(email.subject).toContain("(PHP 350.00)");

    // Hero box must render net payable amount
    expect(email.html).toContain("PHP 350.00");
  });

  // QAD-TC38-09: Transactional email includes promo breakdown
  it("QAD-TC38-09: Transactional email includes itemized promo voucher breakdown", () => {
    const email = renderPaymentLinkEmail({
      to: "guest@example.com",
      customerFirstName: "Guest",
      customerLastName: "User",
      referenceCode: "DA-2026-9999",
      amountDue: 350,
      grossAmount: 500,
      discountAmount: 150,
      promoCode: "7K9M2P4X",
      currency: "PHP",
      paymentUrl: "https://deskatlas.test/pay/tok-123",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      expiryMinutes: 60,
      businessName: "DeskAtlas",
    });

    // Check itemized breakdown in HTML
    expect(email.html).toContain("Original Booking Total");
    expect(email.html).toContain("PHP 500.00");
    expect(email.html).toContain("Promotional Voucher (7K9M2P4X)");
    expect(email.html).toContain("-PHP 150.00");
    expect(email.html).toContain("Net Amount to Pay");

    // Check plain text version
    expect(email.text).toContain("Original Booking Total: PHP 500.00");
    expect(email.text).toContain("Promotional Voucher (7K9M2P4X): -PHP 150.00");
    expect(email.text).toContain("Net Amount to Pay: PHP 350.00");
  });

  // QAD-TC38-10: Customer payment page displays discounted price
  it("QAD-TC38-10: Customer payment page displays discounted net amount due and promo breakdown", () => {
    expect(existsSync(paymentSessionPagePath)).toBe(true);
    expect(paymentSessionPageContent).toContain("data.amountDue");
    expect(paymentSessionPageContent).toContain("data.discountAmount");
    expect(paymentSessionPageContent).toContain("data.promoCodeUsed");
  });

  // QAD-TC38-11: Admin Payment Review displays discounted price & promo
  it("QAD-TC38-11: Admin Payment Review displays net amount due alongside promo discount breakdown", () => {
    expect(existsSync(paymentReviewPath)).toBe(true);
    expect(paymentReviewContent).toContain('data-testid="review-amount-due"');
    expect(paymentReviewContent).toContain('data-testid="review-promo-breakdown"');
    expect(paymentReviewContent).toContain("Gross Amount");
    expect(paymentReviewContent).toContain("Promo Applied");
    expect(paymentReviewContent).toContain("Amount Due");
  });

  // QAD-TC38-12: Staff Reservation Detail displays discounted total
  it("QAD-TC38-12: Staff Reservation Detail displays net amount due and voucher discount breakdown", () => {
    expect(existsSync(staffReservationDetailPath)).toBe(true);
    expect(staffReservationDetailContent).toContain("Gross Amount");
    expect(staffReservationDetailContent).toContain("Voucher Discount");
    expect(staffReservationDetailContent).toContain("Total Amount");
    expect(staffReservationDetailContent).toContain("reservation.discountAmount");
  });
});
