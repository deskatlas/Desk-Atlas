/**
 * DeskAtlas Validation Layer
 * Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E15, ERD-E21
 */

export const CUSTOMER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CUSTOMER_CODE_LENGTH = 6;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const CUSTOMER_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/**
 * Normalizes email address according to SPEC-1 Section 2.1:
 * - Trims outer whitespace
 * - Converts to lowercase
 * - Preserves dots and plus suffixes (never infers provider aliases or merges addresses)
 * - Enforces standard email format and maximum length of 254 characters
 */
export function normalizeEmail(email: string): string {
  if (typeof email !== "string") {
    throw new Error("Email must be a string");
  }
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error("Email cannot be empty");
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    throw new Error(`Email exceeds maximum length of ${MAX_EMAIL_LENGTH} characters`);
  }
  const lowercased = trimmed.toLowerCase();
  if (!EMAIL_REGEX.test(lowercased)) {
    throw new Error("Invalid email address format");
  }
  return lowercased;
}

export function isValidEmail(email: string): boolean {
  try {
    normalizeEmail(email);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes customer code by trimming whitespace and converting to uppercase.
 */
export function normalizeCustomerCode(code: string): string {
  if (typeof code !== "string") {
    throw new Error("Customer code must be a string");
  }
  return code.trim().toUpperCase();
}

/**
 * Validates that customer code consists of exactly 6 characters from
 * the 32-character alphabet (ABCDEFGHJKLMNPQRSTUVWXYZ23456789).
 */
export function isValidCustomerCode(code: string): boolean {
  if (typeof code !== "string") return false;
  const normalized = normalizeCustomerCode(code);
  return CUSTOMER_CODE_REGEX.test(normalized);
}

/**
 * Generates an unbiased 6-character Customer ID from the 32-character alphabet
 * using 5-bit selection from crypto random bytes.
 */
export function generateCustomerCode(customBytesProvider?: (count: number) => Uint8Array): string {
  let bytes: Uint8Array;
  if (customBytesProvider) {
    bytes = customBytesProvider(CUSTOMER_CODE_LENGTH);
  } else if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    bytes = new Uint8Array(CUSTOMER_CODE_LENGTH);
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    bytes = nodeCrypto.randomBytes(CUSTOMER_CODE_LENGTH);
  }

  let result = "";
  for (let i = 0; i < CUSTOMER_CODE_LENGTH; i++) {
    // 256 is an exact multiple of 32 (32 * 8 = 256), so (byte & 31) has zero modulo bias.
    const index = bytes[i] & 31;
    result += CUSTOMER_CODE_ALPHABET[index];
  }
  return result;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CustomerValidationInput {
  customerCode: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  firstConfirmedReservationId: string;
}

export function validateCustomer(input: unknown): ValidationResult<CustomerValidationInput> {
  if (!input || typeof input !== "object") {
    return { success: false, error: "Input must be an object" };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.customerCode !== "string" || !isValidCustomerCode(obj.customerCode)) {
    return { success: false, error: "Invalid customer code: must be 6 characters from alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789" };
  }

  let normalizedEmailAddress: string;
  try {
    if (typeof obj.email !== "string") {
      return { success: false, error: "Email must be a string" };
    }
    normalizedEmailAddress = normalizeEmail(obj.email);
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid email" };
  }

  if (typeof obj.firstName !== "string" || !obj.firstName.trim()) {
    return { success: false, error: "First name must be a non-blank string" };
  }

  if (typeof obj.lastName !== "string" || !obj.lastName.trim()) {
    return { success: false, error: "Last name must be a non-blank string" };
  }

  if (typeof obj.firstConfirmedReservationId !== "string" || !obj.firstConfirmedReservationId.trim()) {
    return { success: false, error: "firstConfirmedReservationId is required" };
  }

  return {
    success: true,
    data: {
      customerCode: normalizeCustomerCode(obj.customerCode),
      email: normalizedEmailAddress,
      firstName: obj.firstName.trim(),
      lastName: obj.lastName.trim(),
      phone: typeof obj.phone === "string" ? obj.phone.trim() : null,
      firstConfirmedReservationId: obj.firstConfirmedReservationId.trim(),
    },
  };
}

export type OutboxKind = "BOOKING_CONFIRMED" | "SAVE_CUSTOMER_ID" | "VOUCHER_EMAIL";
export type OutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "RETRY" | "FAILED";

export interface OutboxJobValidationInput {
  dedupeKey: string;
  kind: OutboxKind;
  customerId?: string | null;
  reservationId?: string | null;
  voucherId?: string | null;
  recipientEmail: string;
  payload: Record<string, unknown>;
  dependsOnId?: string | null;
  status?: OutboxStatus;
}

export function validateOutboxJob(input: unknown): ValidationResult<OutboxJobValidationInput> {
  if (!input || typeof input !== "object") {
    return { success: false, error: "Input must be an object" };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.dedupeKey !== "string" || !obj.dedupeKey.trim()) {
    return { success: false, error: "dedupeKey must be a non-blank string" };
  }

  const validKinds: OutboxKind[] = ["BOOKING_CONFIRMED", "SAVE_CUSTOMER_ID", "VOUCHER_EMAIL"];
  if (typeof obj.kind !== "string" || !validKinds.includes(obj.kind as OutboxKind)) {
    return { success: false, error: `Invalid outbox kind: ${obj.kind}` };
  }

  let normalizedEmailAddress: string;
  try {
    if (typeof obj.recipientEmail !== "string") {
      return { success: false, error: "recipientEmail must be a string" };
    }
    normalizedEmailAddress = normalizeEmail(obj.recipientEmail);
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid recipient email" };
  }

  if (!obj.payload || typeof obj.payload !== "object" || Array.isArray(obj.payload)) {
    return { success: false, error: "payload must be a valid object" };
  }

  // Kind-specific checks
  if (obj.kind === "BOOKING_CONFIRMED" && (!obj.reservationId || typeof obj.reservationId !== "string")) {
    return { success: false, error: "BOOKING_CONFIRMED requires reservationId" };
  }

  if (obj.kind === "SAVE_CUSTOMER_ID") {
    if (!obj.customerId || typeof obj.customerId !== "string") {
      return { success: false, error: "SAVE_CUSTOMER_ID requires customerId" };
    }
    if (!obj.dependsOnId || typeof obj.dependsOnId !== "string") {
      return { success: false, error: "SAVE_CUSTOMER_ID requires dependsOnId" };
    }
  }

  return {
    success: true,
    data: {
      dedupeKey: obj.dedupeKey.trim(),
      kind: obj.kind as OutboxKind,
      customerId: typeof obj.customerId === "string" ? obj.customerId.trim() : null,
      reservationId: typeof obj.reservationId === "string" ? obj.reservationId.trim() : null,
      voucherId: typeof obj.voucherId === "string" ? obj.voucherId.trim() : null,
      recipientEmail: normalizedEmailAddress,
      payload: obj.payload as Record<string, unknown>,
      dependsOnId: typeof obj.dependsOnId === "string" ? obj.dependsOnId.trim() : null,
      status: (obj.status as OutboxStatus) || "PENDING",
    },
  };
}

/**
 * Lightweight schema wrapper with parse and safeParse for backwards compatibility with Zod consumers.
 */
export const customerSchema = {
  parse(input: unknown): CustomerValidationInput {
    const result = validateCustomer(input);
    if (!result.success || !result.data) {
      throw new Error(result.error || "Customer validation failed");
    }
    return result.data;
  },
  safeParse(input: unknown): { success: boolean; data?: CustomerValidationInput; error?: { message: string } } {
    const result = validateCustomer(input);
    if (!result.success) {
      return { success: false, error: { message: result.error || "Validation error" } };
    }
    return { success: true, data: result.data };
  },
};

export const outboxJobSchema = {
  parse(input: unknown): OutboxJobValidationInput {
    const result = validateOutboxJob(input);
    if (!result.success || !result.data) {
      throw new Error(result.error || "Outbox job validation failed");
    }
    return result.data;
  },
  safeParse(input: unknown): { success: boolean; data?: OutboxJobValidationInput; error?: { message: string } } {
    const result = validateOutboxJob(input);
    if (!result.success) {
      return { success: false, error: { message: result.error || "Validation error" } };
    }
    return { success: true, data: result.data };
  },
};

export * from './campaignSchema';
export * from './spec3Schema';
