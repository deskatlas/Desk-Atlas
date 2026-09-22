import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  renderBusinessFooter,
  renderBusinessFooterText,
  resolveBusinessProfile,
  getOrResolveBusinessProfile,
  renderPaymentLinkEmail,
  renderBookingConfirmationEmail,
  renderManualResolutionEmail,
  renderPaymentProofReceivedEmail,
  renderPaymentProofRejectedEmail,
  renderReservationTrackingEmail,
  renderBookingEndedSurveyEmail,
  renderReservationCancelledEmail,
  renderReservationRescheduledEmail,
  renderReservationRelocatedEmail,
  renderReservationExtendedEmail,
  createTransactionalEmailService,
  InMemorySettingsRepository,
  BusinessEmailProfile,
} from "@deskatlas/domain";

describe("MF-189: Business Socials and Contact Information in All Customer Transactional Emails", () => {
  const fullProfile: BusinessEmailProfile = {
    businessName: "Atlas Coworking Hub",
    contactEmail: "support@atlascowork.ph",
    contactPhone: "+63 917 123 4567",
    websiteUrl: "https://atlascowork.ph",
    facebookUrl: "https://facebook.com/AtlasCoworkPH",
    instagramUrl: "https://instagram.com/AtlasCoworkPH",
    twitterUrl: "https://x.com/AtlasCoworkPH",
  };

  describe("1. Universal Customer Email Templates Coverage (11 Scenarios)", () => {
    it("1. Reservation Tracking Link email renders all socials and contact info", () => {
      const email = renderReservationTrackingEmail({
        to: "user@example.com",
        customerFirstName: "Juan",
        customerLastName: "Dela Cruz",
        referenceCode: "TRACK-001",
        trackingUrl: "https://app.deskatlas.com/track/TRACK-001",
        businessSettings: fullProfile,
      });

      // HTML Verification
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("mailto:support@atlascowork.ph"));
      assert.ok(email.html.includes("+63 917 123 4567"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://instagram.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://x.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://atlascowork.ph"));

      // Plaintext Verification
      assert.ok(email.text.includes("Atlas Coworking Hub"));
      assert.ok(email.text.includes("Email: support@atlascowork.ph"));
      assert.ok(email.text.includes("Phone: +63 917 123 4567"));
      assert.ok(email.text.includes("Facebook: https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Instagram: https://instagram.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Twitter/X: https://x.com/AtlasCoworkPH"));
    });

    it("2. Payment Session Link email renders all socials and contact info", () => {
      const email = renderPaymentLinkEmail({
        to: "user@example.com",
        customerFirstName: "Maria",
        referenceCode: "PAY-002",
        amountDue: 250,
        currency: "PHP",
        paymentUrl: "https://app.deskatlas.com/pay/token-123",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("mailto:support@atlascowork.ph"));
      assert.ok(email.html.includes("+63 917 123 4567"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://instagram.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Facebook: https://facebook.com/AtlasCoworkPH"));
    });

    it("3. Payment Proof Received email renders all socials and contact info", () => {
      const email = renderPaymentProofReceivedEmail({
        to: "user@example.com",
        customerFirstName: "Carlos",
        referenceCode: "PROOF-003",
        trackingUrl: "https://app.deskatlas.com/track/PROOF-003",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("mailto:support@atlascowork.ph"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
      assert.ok(email.text.includes("Instagram: https://instagram.com/AtlasCoworkPH"));
    });

    it("4. Booking Confirmation email renders all socials and contact info", () => {
      const email = renderBookingConfirmationEmail({
        to: "user@example.com",
        customerFirstName: "Ana",
        referenceCode: "CONF-004",
        workspaceDisplayName: "Hot Desk 5",
        workspaceTemplateName: "Solo Workspace",
        floorName: "2nd Floor",
        bookingStartAt: "2026-09-23T08:00:00Z",
        bookingEndAt: "2026-09-23T12:00:00Z",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://x.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
      assert.ok(email.text.includes("Twitter/X: https://x.com/AtlasCoworkPH"));
    });

    it("5. Payment Proof Rejected email features accessible social channels for resubmission inquiries", () => {
      const email = renderPaymentProofRejectedEmail({
        to: "user@example.com",
        customerFirstName: "Pedro",
        referenceCode: "REJ-005",
        rejectionReason: "Screenshot blurred and transaction reference unreadable",
        paymentUrl: "https://app.deskatlas.com/pay/token-resubmit",
        businessSettings: fullProfile,
      });

      // HTML contains dedicated inquiries card with social support links
      assert.ok(email.html.includes("Need Help or Have Inquiries?"));
      assert.ok(email.html.includes("mailto:support@atlascowork.ph"));
      assert.ok(email.html.includes("tel:+63 917 123 4567"));
      assert.ok(email.html.includes("Message us on Facebook"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://instagram.com/AtlasCoworkPH"));
      assert.ok(email.html.includes("https://x.com/AtlasCoworkPH"));

      // Plaintext contains contact and social lines
      assert.ok(email.text.includes("If you have inquiries or need assistance resubmitting payment proof"));
      assert.ok(email.text.includes("Email: support@atlascowork.ph"));
      assert.ok(email.text.includes("Call / Text: +63 917 123 4567"));
      assert.ok(email.text.includes("Facebook: https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Instagram: https://instagram.com/AtlasCoworkPH"));
    });

    it("6. Reservation Rescheduled email renders all socials and contact info", () => {
      const email = renderReservationRescheduledEmail({
        to: "user@example.com",
        customerFirstName: "Rosa",
        referenceCode: "RESCHED-006",
        oldSchedule: "Wed, Sep 23, 2026, 09:00 AM - 01:00 PM",
        newSchedule: "Thu, Sep 24, 2026, 10:00 AM - 02:00 PM",
        workspaceDisplayName: "Dedicated Desk A",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("7. Reservation Relocated email renders all socials and contact info", () => {
      const email = renderReservationRelocatedEmail({
        to: "user@example.com",
        customerFirstName: "Gabriel",
        referenceCode: "RELOC-007",
        oldWorkspace: "Pod 1",
        newWorkspace: "Pod 4",
        reason: "Maintenance on Floor 1",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://instagram.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("8. Reservation Extended email renders all socials and contact info", () => {
      const email = renderReservationExtendedEmail({
        to: "user@example.com",
        customerFirstName: "Diana",
        referenceCode: "EXT-008",
        workspaceDisplayName: "Meeting Room Alpha",
        previousEndAt: "2026-09-23T14:00:00Z",
        extendedEndAt: "2026-09-23T16:00:00Z",
        extensionHours: 2,
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("9. Reservation Cancelled email renders all socials and contact info", () => {
      const email = renderReservationCancelledEmail({
        to: "user@example.com",
        customerFirstName: "Elena",
        referenceCode: "CANC-009",
        cancelledSchedule: "Wed, Sep 23, 2026, 08:00 AM - 12:00 PM",
        cancellationReason: "User requested cancellation",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("10. Manual Resolution Notification email renders all socials and contact info", () => {
      const email = renderManualResolutionEmail({
        to: "user@example.com",
        customerFirstName: "Luis",
        referenceCode: "MANUAL-010",
        trackingUrl: "https://app.deskatlas.com/track/MANUAL-010",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("11. Post-Booking Survey email renders all socials and contact info", () => {
      const email = renderBookingEndedSurveyEmail({
        to: "user@example.com",
        customerFirstName: "Kaye",
        referenceCode: "SURVEY-011",
        surveyUrl: "https://app.deskatlas.com/survey/SURVEY-011",
        businessSettings: fullProfile,
      });

      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });
  });

  describe("2. Graceful Handling of Empty, Partial, or Malformed Fields", () => {
    it("omits empty social fields gracefully without empty tags or broken markup", () => {
      const minimalProfile: BusinessEmailProfile = {
        businessName: "Simple Hub",
        contactEmail: "info@simplehub.ph",
        facebookUrl: "https://facebook.com/SimpleHub",
      };

      const html = renderBusinessFooter(minimalProfile);
      assert.ok(html.includes("Simple Hub"));
      assert.ok(html.includes("mailto:info@simplehub.ph"));
      assert.ok(html.includes("https://facebook.com/SimpleHub"));
      assert.ok(!html.includes("Instagram"));
      assert.ok(!html.includes("Twitter / X"));

      const text = renderBusinessFooterText(minimalProfile);
      assert.ok(text.includes("Simple Hub"));
      assert.ok(text.includes("Email: info@simplehub.ph"));
      assert.ok(text.includes("Facebook: https://facebook.com/SimpleHub"));
      assert.ok(!text.includes("Instagram:"));
      assert.ok(!text.includes("Twitter/X:"));
    });

    it("handles malformed or non-http URLs safely without crashing", () => {
      const weirdProfile: BusinessEmailProfile = {
        businessName: "Weird URL Hub",
        websiteUrl: "not-a-valid-protocol",
        facebookUrl: "just_a_string",
      };

      const html = renderBusinessFooter(weirdProfile);
      assert.ok(html.includes("Weird URL Hub"));
      assert.ok(html.includes("just_a_string"));

      const text = renderBusinessFooterText(weirdProfile);
      assert.ok(text.includes("Weird URL Hub"));
    });
  });

  describe("3. TransactionalEmailService Lazy Settings Resolution & Aliases", () => {
    it("automatically populates business settings from settingsRepository when omitted from input", async () => {
      const settingsRepo = new InMemorySettingsRepository();
      await settingsRepo.updateBusinessSettings({
        businessName: "Auto Loaded Hub",
        contactEmail: "auto@loaded.ph",
        contactPhone: "+63 900 111 2222",
        facebookUrl: "https://facebook.com/AutoLoadedHub",
        instagramUrl: "https://instagram.com/AutoLoadedHub",
        twitterUrl: "https://x.com/AutoLoadedHub",
        websiteUrl: "https://autoloaded.ph",
      });

      let dispatchedPayload: any = null;
      const mockFetcher = (async (url: string, init?: any) => {
        dispatchedPayload = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({ id: "msg_auto_1" }),
        };
      }) as any;

      const service = createTransactionalEmailService({
        apiKey: "re_test_key",
        fetcher: mockFetcher,
        settingsRepository: settingsRepo,
      });

      const result = await service.sendBookingConfirmationEmail({
        to: "customer@example.com",
        customerFirstName: "Test",
        referenceCode: "AUTO-RES-1",
        workspaceDisplayName: "Desk 1",
        workspaceTemplateName: "Standard",
        floorName: "1F",
        bookingStartAt: "2026-09-23T08:00:00Z",
        bookingEndAt: "2026-09-23T10:00:00Z",
      });

      assert.equal(result.success, true);
      assert.ok(dispatchedPayload);
      assert.ok(dispatchedPayload.html.includes("Auto Loaded Hub"));
      assert.ok(dispatchedPayload.html.includes("https://facebook.com/AutoLoadedHub"));
      assert.ok(dispatchedPayload.html.includes("https://instagram.com/AutoLoadedHub"));
      assert.ok(dispatchedPayload.text.includes("Auto Loaded Hub"));
      assert.ok(dispatchedPayload.text.includes("Facebook: https://facebook.com/AutoLoadedHub"));
    });

    it("automatically populates business settings from settingsProvider", async () => {
      let dispatchedPayload: any = null;
      const mockFetcher = (async (url: string, init?: any) => {
        dispatchedPayload = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({ id: "msg_provider_1" }),
        };
      }) as any;

      const service = createTransactionalEmailService({
        apiKey: "re_test_key",
        fetcher: mockFetcher,
        settingsProvider: async () => fullProfile,
      });

      const result = await service.sendReservationTrackingEmail({
        to: "customer@example.com",
        customerFirstName: "ProviderUser",
        referenceCode: "PROV-001",
      });

      assert.equal(result.success, true);
      assert.ok(dispatchedPayload);
      assert.ok(dispatchedPayload.html.includes("Atlas Coworking Hub"));
      assert.ok(dispatchedPayload.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(dispatchedPayload.text.includes("Atlas Coworking Hub"));
    });

    it("supports all method aliases seamlessly", async () => {
      const service = createTransactionalEmailService({
        businessSettings: fullProfile,
      });

      // Verify aliases exist and are callable
      assert.equal(typeof service.sendPaymentProofSubmittedEmail, "function");
      assert.equal(typeof service.sendPaymentRejectionEmail, "function");
      assert.equal(typeof service.sendReservationRelocationEmail, "function");
      assert.equal(typeof service.sendReservationTimeExtensionEmail, "function");
      assert.equal(typeof service.sendReservationCancellationEmail, "function");
      assert.equal(typeof service.sendSurveyEmail, "function");
    });

    it("getOrResolveBusinessProfile resolves existing profile or falls back cleanly", async () => {
      const resolved = await getOrResolveBusinessProfile({
        businessSettings: fullProfile,
      });
      assert.equal(resolved.businessName, "Atlas Coworking Hub");
      assert.equal(resolved.facebookUrl, "https://facebook.com/AtlasCoworkPH");

      const emptyResolved = await getOrResolveBusinessProfile({});
      assert.equal(emptyResolved.businessName, "DeskAtlas");
    });
  });
});
