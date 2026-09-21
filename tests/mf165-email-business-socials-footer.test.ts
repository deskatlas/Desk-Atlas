import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  renderBusinessFooter,
  renderBusinessFooterText,
  resolveBusinessProfile,
  renderPaymentLinkEmail,
  renderBookingConfirmationEmail,
  renderManualResolutionEmail,
  renderPaymentProofReceivedEmail,
  renderPaymentProofRejectedEmail,
  renderReservationTrackingEmail,
  renderBookingEndedSurveyEmail,
  renderStaffInvitationEmail,
  renderSuperAdminInvitationAcceptedEmail,
  renderAdminPasswordResetEmail,
  renderReservationCancelledEmail,
  renderReservationRescheduledEmail,
  renderReservationRelocatedEmail,
  renderReservationExtendedEmail,
  renderTeamMemberJoinedEmail,
  renderAccountDeactivatedEmail,
  renderAccountReactivatedEmail,
  createTransactionalEmailService,
  createAdminSettingsService,
  InMemorySettingsRepository,
  BusinessEmailProfile,
} from "@deskatlas/domain";

describe("MF-165: Business Socials and Contact Information in Transactional Emails", () => {
  const fullProfile: BusinessEmailProfile = {
    businessName: "Atlas Coworking Hub",
    contactEmail: "contact@atlascowork.ph",
    contactPhone: "+63 917 123 4567",
    websiteUrl: "https://atlascowork.ph",
    facebookUrl: "https://facebook.com/AtlasCoworkPH",
    instagramUrl: "https://instagram.com/AtlasCoworkPH",
    twitterUrl: "https://x.com/AtlasCoworkPH",
  };

  describe("1. Shared Footer Renderers", () => {
    it("renders complete footer with all contact info and social links when fully configured", () => {
      const html = renderBusinessFooter(fullProfile);

      assert.ok(html.includes("Atlas Coworking Hub"));
      assert.ok(html.includes("mailto:contact@atlascowork.ph"));
      assert.ok(html.includes("+63 917 123 4567"));
      assert.ok(html.includes("https://atlascowork.ph"));
      assert.ok(html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(html.includes("https://instagram.com/AtlasCoworkPH"));
      assert.ok(html.includes("https://x.com/AtlasCoworkPH"));
      assert.ok(html.includes("Facebook"));
      assert.ok(html.includes("Instagram"));
      assert.ok(html.includes("Twitter / X"));

      const text = renderBusinessFooterText(fullProfile);
      assert.ok(text.includes("Atlas Coworking Hub"));
      assert.ok(text.includes("Email: contact@atlascowork.ph"));
      assert.ok(text.includes("Phone: +63 917 123 4567"));
      assert.ok(text.includes("Website: https://atlascowork.ph"));
      assert.ok(text.includes("Facebook: https://facebook.com/AtlasCoworkPH"));
      assert.ok(text.includes("Instagram: https://instagram.com/AtlasCoworkPH"));
      assert.ok(text.includes("Twitter/X: https://x.com/AtlasCoworkPH"));
    });

    it("omits empty or undefined social links and contact info cleanly without broken links", () => {
      const partialProfile: BusinessEmailProfile = {
        businessName: "Minimal Cowork",
        contactEmail: "hello@minimal.ph",
        facebookUrl: "https://facebook.com/MinimalCowork",
      };

      const html = renderBusinessFooter(partialProfile);
      assert.ok(html.includes("Minimal Cowork"));
      assert.ok(html.includes("mailto:hello@minimal.ph"));
      assert.ok(html.includes("https://facebook.com/MinimalCowork"));
      assert.ok(!html.includes("Instagram"));
      assert.ok(!html.includes("Twitter"));
      assert.ok(!html.includes("Website"));

      const text = renderBusinessFooterText(partialProfile);
      assert.ok(text.includes("Minimal Cowork"));
      assert.ok(text.includes("Email: hello@minimal.ph"));
      assert.ok(text.includes("Facebook: https://facebook.com/MinimalCowork"));
      assert.ok(!text.includes("Instagram:"));
      assert.ok(!text.includes("Twitter/X:"));
      assert.ok(!text.includes("Website:"));
    });

    it("defaults to DeskAtlas when profile is undefined or empty", () => {
      const html = renderBusinessFooter();
      assert.ok(html.includes("DeskAtlas"));
      assert.ok(!html.includes("Facebook"));
      assert.ok(!html.includes("Instagram"));

      const text = renderBusinessFooterText();
      assert.ok(text.includes("DeskAtlas"));
    });

    it("supports custom branding suffix for staff/admin notifications", () => {
      const html = renderBusinessFooter(fullProfile, "Atlas Coworking Hub Automated Staff Onboarding");
      assert.ok(html.includes("Atlas Coworking Hub Automated Staff Onboarding"));

      const text = renderBusinessFooterText(fullProfile, "Atlas Coworking Hub Automated Staff Onboarding");
      assert.ok(text.includes("Atlas Coworking Hub Automated Staff Onboarding"));
    });
  });

  describe("2. Profile Resolution", () => {
    it("resolves business fields from input or nested businessSettings", () => {
      const profile1 = resolveBusinessProfile({
        businessSettings: fullProfile,
      });
      assert.equal(profile1.businessName, "Atlas Coworking Hub");
      assert.equal(profile1.facebookUrl, "https://facebook.com/AtlasCoworkPH");

      const profile2 = resolveBusinessProfile({
        businessName: "Direct Overridden Name",
        businessSettings: fullProfile,
      });
      assert.equal(profile2.businessName, "Direct Overridden Name");
      assert.equal(profile2.facebookUrl, "https://facebook.com/AtlasCoworkPH");
    });
  });

  describe("3. All 17 Email Templates Include Business Footer", () => {
    it("Payment Link Email includes business footer", () => {
      const email = renderPaymentLinkEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        amountDue: 500,
        currency: "PHP",
        paymentUrl: "https://deskatlas.com/pay/123",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Booking Confirmation Email includes business footer", () => {
      const email = renderBookingConfirmationEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        workspaceDisplayName: "Hot Desk 01",
        workspaceTemplateName: "Hot Desk",
        floorName: "2nd Floor",
        bookingStartAt: "2026-09-22T09:00:00Z",
        bookingEndAt: "2026-09-22T17:00:00Z",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Manual Resolution Email includes business footer", () => {
      const email = renderManualResolutionEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Payment Proof Received Email includes business footer", () => {
      const email = renderPaymentProofReceivedEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Payment Proof Rejected Email includes business footer", () => {
      const email = renderPaymentProofRejectedEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        rejectionReason: "Invalid receipt",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Reservation Tracking Email includes business footer", () => {
      const email = renderReservationTrackingEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        trackingUrl: "https://deskatlas.com/track?code=REF123",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Booking Ended Survey Email includes business footer", () => {
      const email = renderBookingEndedSurveyEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Staff Invitation Email includes business footer", () => {
      const email = renderStaffInvitationEmail({
        to: "staff@example.com",
        displayName: "John Staff",
        role: "STAFF",
        invitationUrl: "https://deskatlas.com/invite/123",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Super Admin Invitation Accepted Email includes business footer", () => {
      const email = renderSuperAdminInvitationAcceptedEmail({
        to: "super@example.com",
        adminName: "Jane Admin",
        adminEmail: "jane@example.com",
        role: "ADMIN",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Admin Password Reset Email includes business footer", () => {
      const email = renderAdminPasswordResetEmail({
        to: "admin@example.com",
        displayName: "Jane Admin",
        resetUrl: "https://deskatlas.com/reset/123",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Reservation Cancelled Email includes business footer", () => {
      const email = renderReservationCancelledEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        cancellationReason: "User requested",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Reservation Rescheduled Email includes business footer", () => {
      const email = renderReservationRescheduledEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        oldSchedule: "Sep 22, 10:00 AM - 12:00 PM",
        newSchedule: "Sep 22, 02:00 PM - 04:00 PM",
        workspaceDisplayName: "Hot Desk 01",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Reservation Relocated Email includes business footer", () => {
      const email = renderReservationRelocatedEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        schedule: "Sep 22, 10:00 AM - 12:00 PM",
        oldWorkspaceDisplayName: "Desk 01",
        newWorkspaceDisplayName: "Desk 02",
        relocationReason: "Maintenance",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Reservation Extended Email includes business footer", () => {
      const email = renderReservationExtendedEmail({
        to: "user@example.com",
        referenceCode: "REF123",
        previousEndAt: "2026-09-22T12:00:00Z",
        newEndAt: "2026-09-22T14:00:00Z",
        addedDurationMinutes: 120,
        additionalFee: 200,
        paymentMethod: "GCASH",
        workspaceDisplayName: "Hot Desk 01",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Team Member Joined Email includes business footer", () => {
      const email = renderTeamMemberJoinedEmail({
        to: "admin@example.com",
        memberName: "New Staff",
        memberEmail: "staff@example.com",
        role: "STAFF",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Account Deactivated Email includes business footer", () => {
      const email = renderAccountDeactivatedEmail({
        to: "staff@example.com",
        memberName: "Former Staff",
        role: "STAFF",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });

    it("Account Reactivated Email includes business footer", () => {
      const email = renderAccountReactivatedEmail({
        to: "staff@example.com",
        memberName: "Restored Staff",
        role: "STAFF",
        businessSettings: fullProfile,
      });
      assert.ok(email.html.includes("Atlas Coworking Hub"));
      assert.ok(email.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(email.text.includes("Atlas Coworking Hub"));
    });
  });

  describe("4. TransactionalEmailService with Configured Business Settings", () => {
    it("automatically attaches configured business profile to outgoing emails", async () => {
      let sentPayload: any = null;
      const mockFetcher = (async (url: string, init?: any) => {
        sentPayload = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({ id: "msg_123" }),
        };
      }) as any;

      const service = createTransactionalEmailService({
        apiKey: "re_test_key",
        fromEmail: "DeskAtlas <noreply@deskatlas.com>",
        fetcher: mockFetcher,
        businessSettings: fullProfile,
      });

      const result = await service.sendBookingConfirmationEmail({
        to: "customer@example.com",
        referenceCode: "AUTO-123",
        workspaceDisplayName: "Desk A",
        workspaceTemplateName: "Solo Pod",
        floorName: "1F",
        bookingStartAt: "2026-09-22T08:00:00Z",
        bookingEndAt: "2026-09-22T10:00:00Z",
      });

      assert.equal(result.success, true);
      assert.ok(sentPayload);
      assert.ok(sentPayload.html.includes("Atlas Coworking Hub"));
      assert.ok(sentPayload.html.includes("https://facebook.com/AtlasCoworkPH"));
      assert.ok(sentPayload.text.includes("Atlas Coworking Hub"));
      assert.ok(sentPayload.text.includes("Facebook: https://facebook.com/AtlasCoworkPH"));
    });
  });

  describe("5. Settings Service URL Validation & Persistence", () => {
    it("validates and persists social media & website URLs correctly", async () => {
      const settingsRepo = new InMemorySettingsRepository();
      const service = createAdminSettingsService(settingsRepo);
      const current = await settingsRepo.getBusinessSettings();

      // Valid URLs update successfully
      const updated = await service.updateBusinessSettings({
        ...current,
        businessName: "Atlas Coworking Hub",
        facebookUrl: "https://facebook.com/AtlasCoworkPH",
        instagramUrl: "https://instagram.com/AtlasCoworkPH",
        twitterUrl: "https://x.com/AtlasCoworkPH",
        websiteUrl: "https://atlascowork.ph",
      });

      assert.equal(updated.facebookUrl, "https://facebook.com/AtlasCoworkPH");
      assert.equal(updated.instagramUrl, "https://instagram.com/AtlasCoworkPH");
      assert.equal(updated.twitterUrl, "https://x.com/AtlasCoworkPH");
      assert.equal(updated.websiteUrl, "https://atlascowork.ph");

      // Public business settings include social URLs
      const publicSettings = await service.getPublicBusinessSettings();
      assert.equal(publicSettings.facebookUrl, "https://facebook.com/AtlasCoworkPH");
      assert.equal(publicSettings.instagramUrl, "https://instagram.com/AtlasCoworkPH");
      assert.equal(publicSettings.twitterUrl, "https://x.com/AtlasCoworkPH");
      assert.equal(publicSettings.websiteUrl, "https://atlascowork.ph");

      // Invalid URLs throw validation error
      await assert.rejects(
        () =>
          service.updateBusinessSettings({
            ...current,
            facebookUrl: "invalid-url-without-protocol",
          }),
        /Facebook URL must be a valid URL/i
      );

      await assert.rejects(
        () =>
          service.updateBusinessSettings({
            ...current,
            websiteUrl: "ftp://not-http.com",
          }),
        /Website URL must be a valid URL/i
      );
    });
  });
});
