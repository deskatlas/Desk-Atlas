# DeskAtlas Automated Test Suites (`t01`–`t12`)

This directory contains the consolidated, domain-aligned automated test suites for DeskAtlas, executed with **Vitest**.

---

## Consolidated Test Suites Catalog

| Suite | File | Domain Scope |
| :--- | :--- | :--- |
| **`t01`** | [`t01-workspace-catalog.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t01-workspace-catalog.test.ts) | Templates, physical instances, operational status transitions, capacity, pricing, photo preview, natural sorting. |
| **`t02`** | [`t02-map-persistence-geometry.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t02-map-persistence-geometry.test.ts) | Drafts, published maps, rectangle geometry, wall structure rules, amenity icons/colors, zoom clamping and fit view parity. |
| **`t03`** | [`t03-availability-business-hours.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t03-availability-business-hours.test.ts) | Business hours, closures & holidays calendar, duration increments, minute precision, real-time availability reader. |
| **`t04`** | [`t04-reservation-validation-candidates.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t04-reservation-validation-candidates.test.ts) | Guest reservation creation, No-Hold rule, Main + Alt 1 + Alt 2 ranking, same-instance different-time options. |
| **`t05`** | [`t05-payment-session-and-review.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t05-payment-session-and-review.test.ts) | 1-hour expiration countdown, payment method options, proof upload, admin review queue, atomic candidate allocation. |
| **`t06`** | [`t06-booking-access-and-qr.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t06-booking-access-and-qr.test.ts) | Opaque booking QR token generation, access window validation, staff QR scanner verification, token extraction. |
| **`t07`** | [`t07-kiosk-reservation-flow.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t07-kiosk-reservation-flow.test.ts) | Kiosk welcome screen, "You Are Here" marker single-instance rule, template-first flow, counter cash/QR payment confirmation. |
| **`t08`** | [`t08-staff-operations.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t08-staff-operations.test.ts) | Staff management, dashboard daily metrics, check-in/out actions, counter payment queue, published map view. |
| **`t09`** | [`t09-guest-tracking-and-emails.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t09-guest-tracking-and-emails.test.ts) | Customer `/track` reference lookup, transactional confirmation emails, tracking link delivery. |
| **`t10`** | [`t10-reports-and-analytics.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t10-reports-and-analytics.test.ts) | Revenue, utilization, occupancy calculations, date filters, and CSV/Excel export generation. |
| **`t11`** | [`t11-auth-and-security.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t11-auth-and-security.test.ts) | Role enforcement (Admin vs Staff vs Guest), security boundaries, RLS checks, actor resolution. |
| **`t12`** | [`t12-customer-reserve-ui-integration.test.ts`](file:///c:/Users/reyna/Desk-Atlas/tests/t12-customer-reserve-ui-integration.test.ts) | Customer template-first browsing, spot modal, backup selection, reservation summary, landing preview photo carousel. |

---

## Running Tests

### Run All Suites
```bash
pnpm test
```

### Run Specific Suite
```bash
pnpm test:t01    # Workspace Catalog
pnpm test:t02    # Map Persistence & Geometry
pnpm test:t03    # Availability & Business Hours
pnpm test:t04    # Reservation Validation & Candidates
pnpm test:t05    # Payment Session & Review
pnpm test:t06    # Booking Access & QR
pnpm test:t07    # Kiosk Reservation Flow
pnpm test:t08    # Staff Operations
pnpm test:t09    # Guest Tracking & Emails
pnpm test:t10    # Reports & Analytics
pnpm test:t11    # Auth & Security
pnpm test:t12    # Customer Reserve & Landing
```

### Interactive Watch Mode & Coverage
```bash
# Watch mode during development
pnpm test:watch

# Generate code coverage report
pnpm test:coverage
```
