# Milestone 85: Customer Booking History Rebook Flow and Multi-Capacity Companion Registration (MS-85)

**Implementation Status:** Completed and Fully Verified  
**Date:** October 27, 2026  
**Traceability Code:** MS-85  
**Upstream Specifications:** [BRD-M1, BRD-M6], [PRD-F1, PRD-F2, PRD-F13], [SDD-C3, SDD-C11], [DSD-UI2, DSD-UI3, DSD-UI6], [ERD-E10], [QAD-TC1, QAD-TC2, QAD-TC22]  
**Governance:** Strict compliance with BAN-PUNCT-01 (zero em-dashes), BAN-HOLD-08 (No-Hold rule), BAN-TYPE-05 (type safety), and BAN-UI-09 (design consistency).

---

## 1. Architectural Summary & Objectives

Milestone 85 addresses two core customer and operational requirements across DeskAtlas:

1. **Customer Booking History "Rebook" Flow:**
   - Adds an actionable "Rebook" CTA to historical booking entries in the customer portal ("My Bookings & Rewards" / `RewardsVoucherDashboard.tsx`).
   - Deep-links to the reservation page (`/reserve?rebookFrom=[ref]&workspaceId=[id]&templateId=[id]&floorId=[id]`).
   - Automatically pre-selects the customer's previous workspace and floor, pre-fills verified customer identity from `rewardsSession`, and directly advances to date/time scheduling (`ScheduleCalendarStep`).
   - Displays a non-blocking fallback warning banner if the spot was retired, set to maintenance, broken, or made inactive, defaulting gracefully to the floorplan map.
   - Enforces real-time availability checks, slot filtering, and backup candidate selection while preserving the strict No-Hold rule (inventory is never locked until payment is confirmed).

2. **Multi-Capacity Companion Registration:**
   - Workspaces accommodating two or more guests (`WorkspaceTemplate.capacity >= 2`) dynamically render up to `capacity - 1` companion name fields on the reservation form (Customer Web and On-Site Kiosk).
   - Companion registration is optional: guests may submit zero, partial, or all companion fields.
   - Strict privacy and isolation: companions are record-only names for front-desk visitor verification. They are never registered in the `customers` table, receive no transactional emails, and receive no booking QR passes.
   - Front-desk operations scanner (`ScannerPage.tsx`), staff operations (`ReservationDetail.tsx`), and admin management (`ReservationDetail.tsx`) prominently surface expected companion names.

---

## 2. File Touch Register

| Area | File Path | Scope of Changes |
|---|---|---|
| Database Migrations | `supabase/migrations/043_add_reservation_companion_names.sql` | Forward migration adding `companion_names text[] NOT NULL DEFAULT '{}'::text[];`. |
| Database Migrations | `supabase/migrations/043_add_reservation_companion_names_down.sql` | Rollback migration dropping `companion_names`. |
| Validation Layer | `packages/validation/src/companionNamesSchema.ts` | Companion name sanitization, regex matching, character checks, and Zod schemas. |
| Validation Layer | `packages/validation/src/index.ts` | Exported `validateCompanionName`, `validateCompanionNames`, and Zod schemas. |
| Domain Models | `packages/domain/src/models/reservation.ts` | Added `companionNames?: string[];` to `Reservation`, `CreateReservationRequest`, `BookingScanResult`, `StaffOperationalReservation`, `GuestReservationTrackingResult`, `AdminReservationDetail`, `PaymentSessionRecord`, `PaymentSessionView`, `CounterPaymentRecord`, `PaymentReviewQueueItem`. |
| Domain Services | `packages/domain/src/services/reservationService.ts` | Validation of companion names count (`<= capacity - 1`) and name validity during reservation creation. |
| Domain Services | `packages/domain/src/services/reservationSupabaseRepository.ts` | Mapped `companion_names` in `createReservation`, `mapReservation`, `findGuestReservationTrackingRecord`, `listOperationalReservations`, `getAdminReservationDetail`, `findPaymentSessionByTokenHash`, `getCounterPaymentRecord`, `loadPaymentReview`, and booking access queries. |
| Domain Services | `packages/domain/src/services/reservationMemoryRepository.ts` | Persistence and mapping of companion names for in-memory repositories across booking access, payment sessions, counter records, review queues, and operational views. |
| Domain Services | `packages/domain/src/services/voucherRepository.ts` | Added `workspace_instance_id`, `workspace_template_id`, `floor_id` to `findCustomerReservations` return type. |
| Domain Services | `packages/domain/src/services/voucherSupabaseRepository.ts` | Resolved instance display name, template, and floor ID in customer booking history. |
| Domain Services | `packages/domain/src/services/bookingAccessService.ts` | Surfaced `companionNames` in `getBookingAccess` and `resolveBookingAccess`. |
| Customer Website API | `apps/customer-website/src/app/api/customer/bookings/route.ts` | Returned `workspace_instance_id`, `workspace_template_id`, and `floor_id` in response payload. |
| Customer Website API | `apps/customer-website/src/app/api/reservations/route.ts` | Accepted and validated `companionNames` in reservation submission payload. |
| Customer Website UI | `apps/customer-website/src/features/tracking/components/RewardsVoucherDashboard.tsx` | Added "Action" column with "Rebook" CTA in desktop table and mobile card views. |
| Customer Website UI | `apps/customer-website/src/app/reserve/page.tsx` | Wrapped `ReservationPage` in `Suspense` boundary for safe URL query hydration. |
| Customer Website UI | `apps/customer-website/src/features/reservation/components/ReservationPage.tsx` | Hydration of rebook parameters, session prefill, fallback banner, dynamic companion inputs, and submit validation. |
| Customer Website UI | `apps/customer-website/src/features/tracking/components/TrackingPage.tsx` | Rendered registered companions badge list for confirmed bookings. |
| Customer Website UI | `apps/customer-website/src/features/booking/components/BookingConfirmationPage.tsx` | Rendered registered companions badge list on booking confirmation screen. |
| Customer Website UI | `apps/customer-website/src/features/payment/components/PaymentSessionPage.tsx` | Displayed registered companions card/badge list on payment pending and under-review confirmation screens. |
| Kiosk Terminal API | `apps/kiosk/src/app/api/reservations/route.ts` | Forwarded `companionNames` in single-candidate and multi-candidate creation requests. |
| Kiosk Terminal UI | `apps/kiosk/src/app/kiosk/reserve/page.tsx` | Dynamic companion name inputs for `capacity >= 2`, touchscreen validation, and submission payload. |
| Staff Dashboard UI | `apps/staff-dashboard/src/features/reservations/components/ReservationList.tsx` | Displayed companion count badge in Guest column for multi-capacity reservations. |
| Staff Dashboard UI | `apps/staff-dashboard/src/features/reservations/components/ReservationDetail.tsx` | Displayed expected companions in reservation detail modal. |
| Staff Dashboard UI | `apps/staff-dashboard/src/features/qr-scanner/components/ScannerPage.tsx` | Displayed expected companions list on QR scanner check-in panel. |
| Staff Dashboard UI | `apps/staff-dashboard/src/features/check-in/components/EarlyCheckInModal.tsx` | Displayed expected companions list when early check-in is attempted. |
| Staff Dashboard UI | `apps/staff-dashboard/src/features/kiosk-confirm/components/KioskConfirmPage.tsx` | Displayed expected companions in Booking Summary during counter payment lookup. |
| Admin Portal UI | `apps/admin-portal/src/features/reservations/components/ReservationList.tsx` | Displayed companion count badge in Customer column for multi-capacity reservations. |
| Admin Portal UI | `apps/admin-portal/src/features/reservations/components/ReservationDetail.tsx` | Displayed expected companions in reservation key-value metadata. |
| Admin Portal UI | `apps/admin-portal/src/features/payments/components/PaymentReview.tsx` | Displayed `Expected Companions (N)` in payment review details panel. |
| Admin Portal UI | `apps/admin-portal/src/features/payments/components/PaymentQueue.tsx` | Displayed companion count and names across Active Review, Overdue, Refunded, and Rejected queue rows. |
| Admin Portal UI | `apps/admin-portal/src/features/kiosk-confirm/components/KioskConfirmPage.tsx` | Displayed expected companions in Booking Summary during counter payment lookup. |
| Admin Portal UI | `apps/admin-portal/src/features/check-in/components/EarlyCheckInModal.tsx` | Displayed expected companions list when early check-in is attempted. |
| Verification Test Suite | `tests/ms85-rebook-companion-names.test.ts` | Test suite covering MS85-TC01 through MS85-TC12. |
| Monorepo Config | `package.json` | Registered `"test:ms85": "vitest run tests/ms85-rebook-companion-names.test.ts"`. |

---

## 3. Verification & Quality Assurance Results

### 3.1 Targeted Test Suite (`pnpm test:ms85`)

Executed `vitest run tests/ms85-rebook-companion-names.test.ts`:

```
 ✓ tests/ms85-rebook-companion-names.test.ts (12 tests) 50ms
   ✓ MS85-TC01: formats rebook link URL with workspace, template, and floor references
   ✓ MS85-TC02: hydrates pre-selected workspace, floor, and guest session details
   ✓ MS85-TC03: handles retired or maintenance workspace by falling back to map with notice
   ✓ MS85-TC04: rejects overlapping bookings during rebooking window selection
   ✓ MS85-TC05: creates rebooked reservation with candidates without holding inventory prior to payment
   ✓ MS85-TC06: calculates maxCompanions = capacity - 1 accurately across spot types
   ✓ MS85-TC07: permits empty, partial, and full companion name inputs, trimming whitespace
   ✓ MS85-TC08: rejects HTML markup, control characters, overly long strings, and non-letters
   ✓ MS85-TC09: companions are not assigned customer IDs and receive no QR codes or emails
   ✓ MS85-TC10: surfaces companion names in front-desk scan results and admin reservation details
   ✓ MS85-TC11: surfaces companion names in payment session view and admin payment review queue
   ✓ MS85-TC12: surfaces companion names in counter payment record and staff operational reservations

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  4.20s
```

### 3.2 Monorepo Quality Gates

1. **Static Typecheck (`pnpm typecheck`):**
   - Passed with 0 errors across all 9 workspaces (`@deskatlas/validation`, `@deskatlas/domain`, `@deskatlas/ui`, `@deskatlas/server`, `@deskatlas/admin-portal`, `@deskatlas/customer-website`, `@deskatlas/kiosk`, `@deskatlas/staff-dashboard`).
2. **Linter Gate (`pnpm lint`):**
   - Passed with 0 errors. RAG Python boundary lint: 36 files, 0 failures. RAG TypeScript boundary lint: 56 files, 0 failures.
3. **Punctuation & Voice Standards (BAN-PUNCT-01):**
   - Checked all modified and untracked files for em-dashes (`\u2014`). Zero em-dashes found.
4. **Production Build (`pnpm build`):**
   - All monorepo projects built successfully: Next.js Turbopack production compilation succeeded for `apps/customer-website`, `apps/kiosk`, `apps/staff-dashboard`, and `apps/admin-portal`.

