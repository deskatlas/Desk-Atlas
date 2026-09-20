import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ALLOWED_PAYMENT_PROOF_EXTENSIONS,
  ALLOWED_PAYMENT_PROOF_MIME_TYPES,
  isAllowedPaymentProofExtension,
  isAllowedPaymentProofFileSize,
  isAllowedPaymentProofMimeType,
  MAX_PAYMENT_PROOF_SIZE_BYTES,
  validatePaymentProofFile,
} from "@deskatlas/domain";

describe("MF-158: Payment Proof Upload File Type and Size Restriction", () => {
  describe("Domain validation helpers", () => {
    it("exports maximum file size of 10 MB (10,485,760 bytes)", () => {
      assert.equal(MAX_PAYMENT_PROOF_SIZE_BYTES, 10 * 1024 * 1024);
      assert.equal(MAX_PAYMENT_PROOF_SIZE_BYTES, 10485760);
    });

    it("accepts valid MIME types (image/png, image/jpeg, image/webp, image/jpg)", () => {
      assert.ok(isAllowedPaymentProofMimeType("image/png"));
      assert.ok(isAllowedPaymentProofMimeType("image/jpeg"));
      assert.ok(isAllowedPaymentProofMimeType("image/jpg"));
      assert.ok(isAllowedPaymentProofMimeType("image/webp"));
      assert.ok(isAllowedPaymentProofMimeType("IMAGE/PNG"));
      assert.ok(isAllowedPaymentProofMimeType(" image/jpeg "));
    });

    it("rejects invalid MIME types (application/pdf, image/heic, image/bmp, image/gif)", () => {
      assert.equal(isAllowedPaymentProofMimeType("application/pdf"), false);
      assert.equal(isAllowedPaymentProofMimeType("image/heic"), false);
      assert.equal(isAllowedPaymentProofMimeType("image/bmp"), false);
      assert.equal(isAllowedPaymentProofMimeType("image/gif"), false);
      assert.equal(isAllowedPaymentProofMimeType("text/plain"), false);
      assert.equal(isAllowedPaymentProofMimeType(""), false);
    });

    it("accepts valid file extensions (.png, .jpg, .jpeg, .webp)", () => {
      assert.ok(isAllowedPaymentProofExtension("receipt.png"));
      assert.ok(isAllowedPaymentProofExtension("payment_proof.jpg"));
      assert.ok(isAllowedPaymentProofExtension("photo.jpeg"));
      assert.ok(isAllowedPaymentProofExtension("screenshot.webp"));
      assert.ok(isAllowedPaymentProofExtension("DOCUMENT.PNG"));
    });

    it("rejects invalid file extensions (.pdf, .heic, .bmp, .gif, .exe, .svg)", () => {
      assert.equal(isAllowedPaymentProofExtension("proof.pdf"), false);
      assert.equal(isAllowedPaymentProofExtension("image.heic"), false);
      assert.equal(isAllowedPaymentProofExtension("bitmap.bmp"), false);
      assert.equal(isAllowedPaymentProofExtension("animated.gif"), false);
      assert.equal(isAllowedPaymentProofExtension("vector.svg"), false);
      assert.equal(isAllowedPaymentProofExtension("malicious.exe"), false);
      assert.equal(isAllowedPaymentProofExtension("no_extension"), false);
    });

    it("verifies file size limits (<= 10MB is valid, > 10MB or 0 is invalid)", () => {
      assert.equal(isAllowedPaymentProofFileSize(0), false);
      assert.equal(isAllowedPaymentProofFileSize(100), true);
      assert.equal(isAllowedPaymentProofFileSize(5 * 1024 * 1024), true);
      assert.equal(isAllowedPaymentProofFileSize(10 * 1024 * 1024), true); // Boundary: exact 10 MB
      assert.equal(isAllowedPaymentProofFileSize(10 * 1024 * 1024 + 1), false); // Over 10 MB
      assert.equal(isAllowedPaymentProofFileSize(15 * 1024 * 1024), false);
    });
  });

  describe("File candidate validator (validatePaymentProofFile)", () => {
    it("accepts valid PNG, JPG, and WebP files under 10 MB", () => {
      const validPng = validatePaymentProofFile({
        name: "gcash-receipt.png",
        size: 2 * 1024 * 1024,
        type: "image/png",
      });
      assert.equal(validPng.valid, true);
      assert.equal(validPng.error, undefined);

      const validJpg = validatePaymentProofFile({
        name: "maya-proof.jpg",
        size: 1.5 * 1024 * 1024,
        type: "image/jpeg",
      });
      assert.equal(validJpg.valid, true);

      const validWebp = validatePaymentProofFile({
        name: "bank-transfer.webp",
        size: 500 * 1024,
        type: "image/webp",
      });
      assert.equal(validWebp.valid, true);
    });

    it("accepts a file of exactly 10 MB (boundary test)", () => {
      const boundaryFile = validatePaymentProofFile({
        name: "large-proof.png",
        size: 10 * 1024 * 1024,
        type: "image/png",
      });
      assert.equal(boundaryFile.valid, true);
    });

    it("rejects file exceeding 10 MB (boundary + 1 byte)", () => {
      const oversizedFile = validatePaymentProofFile({
        name: "large-proof.png",
        size: 10 * 1024 * 1024 + 1,
        type: "image/png",
      });
      assert.equal(oversizedFile.valid, false);
      assert.equal(oversizedFile.error, "File size must not exceed 10 MB.");
    });

    it("rejects 0-byte empty file", () => {
      const emptyFile = validatePaymentProofFile({
        name: "empty.png",
        size: 0,
        type: "image/png",
      });
      assert.equal(emptyFile.valid, false);
      assert.equal(emptyFile.error, "Payment proof file is empty.");
    });

    it("rejects missing / null file", () => {
      const nullFile = validatePaymentProofFile(null);
      assert.equal(nullFile.valid, false);
      assert.equal(nullFile.error, "Payment proof file is required.");
    });

    it("rejects unsupported file formats (PDF, GIF, HEIC, BMP)", () => {
      const pdfFile = validatePaymentProofFile({
        name: "statement.pdf",
        size: 1024 * 1024,
        type: "application/pdf",
      });
      assert.equal(pdfFile.valid, false);
      assert.equal(pdfFile.error, "Only PNG, JPG, and WebP images are accepted.");

      const gifFile = validatePaymentProofFile({
        name: "receipt.gif",
        size: 1024 * 1024,
        type: "image/gif",
      });
      assert.equal(gifFile.valid, false);
      assert.equal(gifFile.error, "Only PNG, JPG, and WebP images are accepted.");

      const heicFile = validatePaymentProofFile({
        name: "ios_photo.heic",
        size: 1024 * 1024,
        type: "image/heic",
      });
      assert.equal(heicFile.valid, false);
      assert.equal(heicFile.error, "Only PNG, JPG, and WebP images are accepted.");

      const bmpFile = validatePaymentProofFile({
        name: "image.bmp",
        size: 1024 * 1024,
        type: "image/bmp",
      });
      assert.equal(bmpFile.valid, false);
      assert.equal(bmpFile.error, "Only PNG, JPG, and WebP images are accepted.");
    });

    it("rejects file with valid extension but mismatched/disallowed MIME type", () => {
      const spoofedFile = validatePaymentProofFile({
        name: "receipt.png",
        size: 1024,
        type: "application/x-msdownload",
      });
      assert.equal(spoofedFile.valid, false);
      assert.equal(spoofedFile.error, "Only PNG, JPG, and WebP images are accepted.");
    });
  });

  describe("Server-side upload validation logic", () => {
    function simulateServerProofValidation(file: { name: string; size: number; type: string } | null, paymentMethodId: string | null) {
      if (!paymentMethodId) {
        return { status: 400, error: "Payment method is required." };
      }
      if (!file) {
        return { status: 400, error: "Payment proof file is required." };
      }
      if (file.size === 0) {
        return { status: 400, error: "Payment proof file is empty." };
      }
      if (file.size > 10 * 1024 * 1024) {
        return { status: 400, error: "File too large. Maximum allowed size is 10 MB." };
      }
      const validation = validatePaymentProofFile(file);
      if (!validation.valid) {
        const errorMsg =
          validation.error === "File size must not exceed 10 MB."
            ? "File too large. Maximum allowed size is 10 MB."
            : validation.error === "Only PNG, JPG, and WebP images are accepted."
              ? "Invalid file type. Only PNG, JPG, and WebP are accepted."
              : validation.error ?? "Invalid payment proof file.";
        return { status: 400, error: errorMsg };
      }
      return { status: 201, success: true };
    }

    it("returns HTTP 400 when file exceeds 10 MB", () => {
      const result = simulateServerProofValidation(
        { name: "huge-proof.jpg", size: 12 * 1024 * 1024, type: "image/jpeg" },
        "pm-gcash"
      );
      assert.equal(result.status, 400);
      assert.equal(result.error, "File too large. Maximum allowed size is 10 MB.");
    });

    it("returns HTTP 400 when file is PDF or non-image format", () => {
      const result = simulateServerProofValidation(
        { name: "bank-slip.pdf", size: 500 * 1024, type: "application/pdf" },
        "pm-gcash"
      );
      assert.equal(result.status, 400);
      assert.equal(result.error, "Invalid file type. Only PNG, JPG, and WebP are accepted.");
    });

    it("returns HTTP 201 when valid PNG/JPG/WebP <= 10 MB is submitted", () => {
      const pngResult = simulateServerProofValidation(
        { name: "proof.png", size: 1024 * 1024, type: "image/png" },
        "pm-gcash"
      );
      assert.equal(pngResult.status, 201);
      assert.equal(pngResult.success, true);

      const webpResult = simulateServerProofValidation(
        { name: "proof.webp", size: 2 * 1024 * 1024, type: "image/webp" },
        "pm-gcash"
      );
      assert.equal(webpResult.status, 201);
      assert.equal(webpResult.success, true);
    });
  });
});
