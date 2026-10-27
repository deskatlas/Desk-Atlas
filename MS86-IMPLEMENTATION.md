# Milestone 86: Customer ID Recovery and "Forgot Customer ID" Flow in Reservation Tracking (MS-86)

**Implementation Status:** Completed and Fully Verified  
**Date:** October 28, 2026  
**Traceability Code:** MS-86  
**Upstream Specifications:** [BRD-M1, BRD-M2, BRD-M4, BRD-M6], [PRD-F4, PRD-F14, PRD-F22], [SDD-C1, SDD-C2, SDD-C13, SDD-C15], [DSD-UI4, DSD-UI6, DSD-UI12], [ERD-E15, ERD-E21, ERD-E23], [QAD-TC22, QAD-TC37], MS86-TC01 through MS86-TC10  
**Governance:** Strict compliance with BAN-PUNCT-01 (zero em-dashes), BAN-HOLD-08 (No-Hold rule), BAN-TYPE-05 (type safety), and BAN-UI-09 (design consistency).

---

## 1. Architectural Summary & Objectives

Milestone 86 delivers a self-service Customer ID recovery mechanism and abuse-resistant rate limiting architecture for the DeskAtlas tracking portal (`/track`):

1. **Self-Service Customer ID Recovery Trigger (`RewardsAccessCard.tsx`):**
   - Renders a clean "Forgot your Customer ID?" link/button adjacent to the Customer ID input field in the "My Bookings & Rewards" card.
   - Remains interactive even when the form is locked due to brute-force verification lockout (`isLocked === true`), enabling legitimate users to recover their identifier.
   - Automatically passes the user-typed email as initial value to the recovery modal to avoid redundant typing.

2. **Accessible Recovery Modal Dialog (`ForgotCustomerIdModal.tsx`):**
   - Full keyboard navigation and escape key dismissal support.
   - Displays clear notice that recovery is limited to 2 requests per day for security.
   - Displays real-time loading feedback ("Sending Customer ID...").
   - Provides clear success confirmation ("Check Your Inbox") emphasizing that Customer IDs are permanent and immutable.
   - Features a "Return to Log In" button that closes the modal and auto-focuses the Customer ID input.
   - Renders localized rate limit error banner (HTTP 429) informing the user of the 2-per-day limit with countdown context.

3. **Public Recovery Endpoint (`POST /api/customer/forgot-customer-id`):**
   - HTTP method enforcement (POST only, rejects GET/PUT/DELETE with 405 Method Not Allowed).
   - Origin check against request host/URL origin (rejects cross-origin requests with 403 Forbidden).
   - Content-Type enforcement (`application/json` required, rejects invalid types with 415 Unsupported Media Type).
   - Payload size limit (2,048 bytes max, rejects oversized bodies with 413 Payload Too Large).
   - Input format validation via shared Zod schema `forgotCustomerIdSchema`.
   - Returns `'Cache-Control': 'no-store, private'` on all responses.

4. **Permanent Customer ID Immutability (Zero Mutation Invariant):**
   - Customer IDs are never rotated, regenerated, or updated.
   - The lookup reads the existing `customers.customer_code` as an immutable attribute.

5. **Anti-Enumeration Privacy Protection:**
   - Returns uniform HTTP 200 OK success response whether the email is registered or not.
   - Unregistered email addresses do not trigger outbound email dispatch and do not leak account existence.

6. **Strict 2-Per-Day Rolling Rate Limiting:**
   - Defined `CUSTOMER_ID_RECOVERY` scope in domain models (`{ limit: 2, windowSeconds: 86400 }`).
   - Normalizes email casing to ensure identical hashed subjects across variations.
   - Reversible database migration 044 extends `rate_limit_events_scope_check` and `consume_customer_access_limits` window to 86,400 seconds.
   - Rejects the 3rd attempt within 24 hours with HTTP 429 Too Many Requests and `Retry-After` header.

7. **Transactional Email Reminder Dispatch:**
   - Dedicated `sendCustomerIdReminderEmail` in `TransactionalEmailService`.
   - Prominently displays the permanent 6-character Customer ID in a monospace code box.
   - Includes direct CTA link returning to `/track`.
   - Security advisory clarifying that no action is needed if the user did not request the reminder.
   - Strict zero em-dash compliance across HTML and text templates.

---

## 2. File Touch Register

| Area | File Path | Scope of Changes |
|---|---|---|
| Database Migrations | `supabase/migrations/044_customer_id_recovery_rate_limit.sql` | Added `CUSTOMER_ID_RECOVERY` to `rate_limit_events_scope_check` constraint and allowed up to 86,400 seconds window in `consume_customer_access_limits`. |
| Database Migrations | `supabase/migrations/044_customer_id_recovery_rate_limit_down.sql` | Rollback migration reverting constraint and function back to 3,600 seconds window limit. |
| Domain Models | `packages/domain/src/models/customer.ts` | Added `CUSTOMER_ID_RECOVERY` to `RateLimitScope` type union. |
| Domain Services | `packages/domain/src/services/rateLimiterService.ts` | Added `CUSTOMER_ID_RECOVERY: { limit: 2, windowSeconds: 24 * 60 * 60 }` to `RATE_LIMIT_RULES`. |
| Domain Services | `packages/domain/src/services/transactionalEmailService.ts` | Added `CustomerIdReminderEmailInput` interface, `renderCustomerIdReminderEmail` template renderer, and `sendCustomerIdReminderEmail` method. |
| Validation Layer | `packages/validation/src/customerSchemas.ts` | Defined `forgotCustomerIdSchema` and `ForgotCustomerIdInput` type. |
| Validation Layer | `packages/validation/src/index.ts` | Re-exported `customerSchemas.ts`. |
| Route Handler | `apps/customer-website/src/app/api/customer/forgot-customer-id/route.ts` | Implemented POST route handler with origin check, content-type check, payload limit, rate limiting, immutable lookup, email dispatch, and anti-enumeration. |
| UI Component | `apps/customer-website/src/features/tracking/components/ForgotCustomerIdModal.tsx` | Created accessible modal dialog with loading, rate limit warning, and success states. |
| UI Component | `apps/customer-website/src/features/tracking/components/RewardsAccessCard.tsx` | Added "Forgot your Customer ID?" button, modal state management, and input focus restoration. |
| Verification Test Suite | `tests/ms86-forgot-customer-id.test.ts` | Authored 15 tests covering MS86-TC01 through MS86-TC10 and HTTP security checks. |
| Monorepo Config | `package.json` | Registered `"test:ms86": "vitest run tests/ms86-forgot-customer-id.test.ts"`. |
| Documentation | `docs/milestone/ms86.md` | Reconciled milestone specification, marked status as Completed, and checked all checklist items. |

---

## 3. Verification & Quality Assurance Results

### 3.1 Targeted Test Suite (`pnpm test:ms86`)

Executed `vitest run tests/ms86-forgot-customer-id.test.ts`:

```
 ✓ tests/ms86-forgot-customer-id.test.ts (15 tests) 38ms
   ✓ MS86-TC01: verifies UI trigger contracts and placement for Forgot Customer ID
   ✓ MS86-TC02: verifies accessibility and dialog attributes of ForgotCustomerIdModal
   ✓ MS86-TC03: validates email formats with forgotCustomerIdSchema
   ✓ MS86-TC04: dispatches reminder email with immutable Customer ID for registered customer
   ✓ MS86-TC05: verifies that Customer ID is strictly immutable and never regenerated
   ✓ MS86-TC06: returns identical 200 OK success without dispatching email for unregistered address
   ✓ MS86-TC07: allows exactly 2 requests in 24 hours and rejects 3rd with HTTP 429
   ✓ MS86-TC08: replenishes quota after 24 hours (86,400 seconds) pass
   ✓ MS86-TC09: normalizes email casing to ensure shared quota and proper lookup
   ✓ MS86-TC10: renders email template with immutable code, portal link, and zero em-dashes
   ✓ rejects unsupported HTTP methods with 405 Method Not Allowed
   ✓ rejects cross-origin requests with 403 Forbidden
   ✓ rejects non-JSON content types with 415 Unsupported Media Type
   ✓ rejects oversized payloads with 413 Payload Too Large
   ✓ rejects malformed JSON payloads with 400 Bad Request

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  4.12s
```

### 3.2 Monorepo Quality Gates

1. **Static Typecheck (`pnpm typecheck`):**
   - Passed with 0 errors across all 9 workspaces (`@deskatlas/validation`, `@deskatlas/domain`, `@deskatlas/ui`, `@deskatlas/server`, `@deskatlas/admin-portal`, `@deskatlas/customer-website`, `@deskatlas/kiosk`, `@deskatlas/staff-dashboard`).

2. **Linter Check (`pnpm lint`):**
   - RAG boundary lint: 36 Python files, 0 failures.
   - RAG boundary lint: 56 TypeScript files, 0 failures.

3. **Related Test Regressions:**
   - `pnpm vitest run tests/spec3-customer-booking-rewards-portal.test.ts`: 16 passed (16).
   - `pnpm vitest run tests/ms42-customer-verify-lockout-timer.test.ts`: 11 passed (11).
   - `pnpm test:ms85`: 12 passed (12).

4. **Production Build (`pnpm --filter @deskatlas/customer-website build`):**
   - Production Next.js build compiled successfully with Turbopack.
   - Route `ƒ /api/customer/forgot-customer-id` generated cleanly.

5. **Punctuation Governance (BAN-PUNCT-01):**
   - Verified zero em-dash (`\u2014`) or en-dash (`\u2013`) occurrences across all touched files.

