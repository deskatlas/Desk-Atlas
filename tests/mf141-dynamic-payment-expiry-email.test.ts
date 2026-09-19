import { describe, it, expect, vi } from "vitest";
import {
  formatSessionExpiryDuration,
  renderPaymentLinkEmail,
  renderPaymentProofRequestEmail,
  TransactionalEmailService,
  createPaymentSessionService,
  ReservationMemoryRepository,
} from "@deskatlas/domain";

describe("MF-141: Dynamic Online Payment Session Expiry Minutes in Transactional Emails", () => {
  describe("1. Helper: formatSessionExpiryDuration", () => {
    it("formats sub-hour durations accurately", () => {
      expect(formatSessionExpiryDuration(1)).toEqual({
        label: "1 minute",
        sessionTitle: "1-Minute Session",
      });
      expect(formatSessionExpiryDuration(15)).toEqual({
        label: "15 minutes",
        sessionTitle: "15-Minute Session",
      });
      expect(formatSessionExpiryDuration(20)).toEqual({
        label: "20 minutes",
        sessionTitle: "20-Minute Session",
      });
      expect(formatSessionExpiryDuration(30)).toEqual({
        label: "30 minutes",
        sessionTitle: "30-Minute Session",
      });
      expect(formatSessionExpiryDuration(45)).toEqual({
        label: "45 minutes",
        sessionTitle: "45-Minute Session",
      });
    });

    it("formats exact hour multiples accurately", () => {
      expect(formatSessionExpiryDuration(60)).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
      expect(formatSessionExpiryDuration(120)).toEqual({
        label: "2 hours",
        sessionTitle: "2-Hour Session",
      });
      expect(formatSessionExpiryDuration(180)).toEqual({
        label: "3 hours",
        sessionTitle: "3-Hour Session",
      });
    });

    it("formats compound hour and minute durations accurately", () => {
      expect(formatSessionExpiryDuration(90)).toEqual({
        label: "1 hour 30 minutes",
        sessionTitle: "90-Minute Session",
      });
      expect(formatSessionExpiryDuration(75)).toEqual({
        label: "1 hour 15 minutes",
        sessionTitle: "75-Minute Session",
      });
      expect(formatSessionExpiryDuration(150)).toEqual({
        label: "2 hours 30 minutes",
        sessionTitle: "150-Minute Session",
      });
    });

    it("falls back safely to 1 hour for invalid, negative, zero, or missing values", () => {
      expect(formatSessionExpiryDuration()).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
      expect(formatSessionExpiryDuration(null)).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
      expect(formatSessionExpiryDuration(0)).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
      expect(formatSessionExpiryDuration(-20)).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
      expect(formatSessionExpiryDuration(NaN)).toEqual({
        label: "1 hour",
        sessionTitle: "1-Hour Session",
      });
    });
  });

  describe("2. Template Rendering: HTML and Plaintext Parity", () => {
    const baseInput = {
      to: "juan@example.com",
      customerFirstName: "Juan",
      customerLastName: "Dela Cruz",
      referenceCode: "DA-2026-TEST",
      amountDue: 500,
      currency: "PHP",
      paymentUrl: "https://deskatlas.test/pay/test-token",
      expiresAt: "2026-09-19T14:00:00.000Z",
    };

    it("renders configured 20-minute session duration in both HTML and text", () => {
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiryMinutes: 20,
      });

      // HTML checks
      expect(email.html).toContain("20-Minute Session");
      expect(email.html).toContain("(20 minutes)");
      expect(email.html).not.toContain("1-Hour Session");

      // Plaintext checks
      expect(email.text).toContain("Session Expiry:");
      expect(email.text).toContain("(20 minutes)");
      expect(email.text).not.toContain("(1 hour)");
    });

    it("renders configured 30-minute session duration in both HTML and text", () => {
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiryMinutes: 30,
      });

      expect(email.html).toContain("30-Minute Session");
      expect(email.html).toContain("(30 minutes)");
      expect(email.text).toContain("(30 minutes)");
    });

    it("renders standard 1-hour session when expiryMinutes = 60", () => {
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiryMinutes: 60,
      });

      expect(email.html).toContain("1-Hour Session");
      expect(email.html).toContain("(1 hour)");
      expect(email.text).toContain("Session Expiry:");
      expect(email.text).toContain("(1 hour)");
    });

    it("renders multi-hour session when expiryMinutes = 120", () => {
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiryMinutes: 120,
      });

      expect(email.html).toContain("2-Hour Session");
      expect(email.html).toContain("(2 hours)");
      expect(email.text).toContain("(2 hours)");
    });

    it("supports renderPaymentProofRequestEmail alias identically", () => {
      const email = renderPaymentProofRequestEmail({
        ...baseInput,
        expiryMinutes: 45,
      });

      expect(email.html).toContain("45-Minute Session");
      expect(email.html).toContain("(45 minutes)");
      expect(email.text).toContain("(45 minutes)");
    });

    it("handles backward compatibility when expiryMinutes is undefined (past or default timestamp)", () => {
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiresAt: "2026-09-11T13:00:00.000Z", // Past date without expiryMinutes defaults safely to 60 minutes
      });

      expect(email.html).toContain("1-Hour Session");
      expect(email.html).toContain("(1 hour)");
      expect(email.text).toContain("(1 hour)");
    });

    it("infers standard 1-hour session from expiresAt 60 minutes in the future", () => {
      const oneHourFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiresAt: oneHourFuture,
      });

      expect(email.html).toContain("1-Hour Session");
      expect(email.html).toContain("(1 hour)");
      expect(email.text).toContain("(1 hour)");
    });

    it("dynamically infers expiry minutes from future expiresAt if expiryMinutes is undefined", () => {
      // Set expiresAt exactly 25 minutes into the future
      const futureDate = new Date(Date.now() + 25 * 60 * 1000).toISOString();
      const email = renderPaymentLinkEmail({
        ...baseInput,
        expiresAt: futureDate,
      });

      expect(email.html).toContain("25-Minute Session");
      expect(email.html).toContain("(25 minutes)");
      expect(email.text).toContain("(25 minutes)");
    });
  });

  describe("3. TransactionalEmailService Method Alias", () => {
    it("successfully sends via sendPaymentProofRequestEmail", async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_141_mock" }),
      });

      const emailService = new TransactionalEmailService({
        apiKey: "re_test_key_141",
        fromEmail: "DeskAtlas <noreply@deskatlas.com>",
        fetcher: mockFetcher as any,
      });

      const result = await emailService.sendPaymentProofRequestEmail({
        to: "customer@example.com",
        customerFirstName: "Maria",
        customerLastName: "Santos",
        referenceCode: "DA-2026-REF141",
        amountDue: 350,
        currency: "PHP",
        paymentUrl: "https://deskatlas.test/pay/tok-141",
        expiresAt: "2026-09-19T14:00:00.000Z",
        expiryMinutes: 20,
      });

      expect(result.success).toBe(true);
      expect(mockFetcher).toHaveBeenCalledTimes(1);
      const callArgs = mockFetcher.mock.calls[0];
      const requestPayload = JSON.parse(callArgs[1].body);
      expect(requestPayload.html).toContain("20-Minute Session");
      expect(requestPayload.html).toContain("(20 minutes)");
      expect(requestPayload.text).toContain("(20 minutes)");
    });
  });

  describe("4. End-to-End Payment Session Expiry Duration Integration", () => {
    it("propagates configured 20-minute expiry from repository to payment session and email", async () => {
      const repo = new ReservationMemoryRepository();
      // Configure 20 minutes in repo
      vi.spyOn(repo, "getPaymentExpiryMinutes").mockResolvedValue(20);

      const paymentSessionService = createPaymentSessionService(repo);
      const session = await paymentSessionService.createReservationPaymentSession(
        "att-141",
        "https://deskatlas.test/pay"
      );

      expect(session.expiryMinutes).toBe(20);

      const email = renderPaymentLinkEmail({
        to: "test@example.com",
        referenceCode: "DA-141",
        amountDue: 150,
        currency: "PHP",
        paymentUrl: session.paymentUrl,
        expiresAt: session.expiresAt,
        expiryMinutes: session.expiryMinutes,
      });

      expect(email.html).toContain("20-Minute Session");
      expect(email.html).toContain("(20 minutes)");
      expect(email.text).toContain("(20 minutes)");
    });
  });
});
