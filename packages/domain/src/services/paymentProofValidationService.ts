export const MAX_PAYMENT_PROOF_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_PAYMENT_PROOF_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

export const ALLOWED_PAYMENT_PROOF_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
] as const;

export function isAllowedPaymentProofMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().trim();
  return ALLOWED_PAYMENT_PROOF_MIME_TYPES.includes(
    normalized as (typeof ALLOWED_PAYMENT_PROOF_MIME_TYPES)[number]
  );
}

export function isAllowedPaymentProofExtension(filename: string): boolean {
  if (!filename) return false;
  const extMatch = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!extMatch) return false;
  const ext = extMatch[1];
  return ALLOWED_PAYMENT_PROOF_EXTENSIONS.includes(
    ext as (typeof ALLOWED_PAYMENT_PROOF_EXTENSIONS)[number]
  );
}

export function isAllowedPaymentProofFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_PAYMENT_PROOF_SIZE_BYTES;
}

export interface PaymentProofFileCandidate {
  name: string;
  size: number;
  type?: string;
}

export interface PaymentProofValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePaymentProofFile(
  file?: PaymentProofFileCandidate | null
): PaymentProofValidationResult {
  if (!file) {
    return {
      valid: false,
      error: 'Payment proof file is required.',
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: 'Payment proof file is empty.',
    };
  }

  if (file.size > MAX_PAYMENT_PROOF_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File size must not exceed 10 MB.',
    };
  }

  const hasValidMime = file.type ? isAllowedPaymentProofMimeType(file.type) : false;
  const hasValidExt = isAllowedPaymentProofExtension(file.name);

  // If MIME is provided, it must be valid. If not provided (or generic octet-stream), check extension.
  if (file.type && !hasValidMime && file.type !== 'application/octet-stream') {
    return {
      valid: false,
      error: 'Only PNG, JPG, and WebP images are accepted.',
    };
  }

  if (!hasValidExt && !hasValidMime) {
    return {
      valid: false,
      error: 'Only PNG, JPG, and WebP images are accepted.',
    };
  }

  return { valid: true };
}
