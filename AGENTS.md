<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant Next.js documentation before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Agent Playbook (AGENTS.md)

**Project:** DeskAtlas (Smart Coworking Space Management, On-Site Kiosk, Interactive Map-Builder, and Reservation Platform)  
**Document Function:** Master Autonomous Agent Instruction & Architectural Contract  
**Version:** 1.0.0 (Production Release)  
**Date:** September 23, 2026  
**Owner:** Reynard John B. Rabanal (Lead Product / Systems Architect) & DeskAtlas Team  
**Status:** Active  
**Enforcement:** Mandatory for all AI and LLM code-generation agents  

---

## 1. Primary Operating Directives

You are an autonomous senior software engineering agent working within the DeskAtlas codebase. Your mission is to build, refactor, and maintain production-grade systems while preventing architectural drift, undocumented interface mutations, and regressions across the Next.js frontend applications (`apps/customer-website`, `apps/kiosk`, `apps/staff-dashboard`, `apps/admin-portal`), pure TypeScript domain services (`packages/domain`), validation schemas (`packages/validation`), shared UI primitives (`packages/ui`), and the Supabase PostgreSQL persistence layer.

Every code change must be treated as an immutable transaction against project specifications:
1. Specification Precedence: Do not write code without an upstream requirement. Features map to PRD-F#, business metrics map to BRD-M#, system components map to SDD-C#, UI components map to DSD-UI#, database entities map to ERD-E#, and tests map to QAD-TC#. Upstream specifications reside in `docs/index.md`.
2. Deterministic Outputs and Core Invariants:
   - Strict No-Hold Rule: Selecting a spot, submitting a reservation, receiving a payment link, or awaiting payment review never holds inventory. Inventory is reserved strictly upon authorized payment confirmation or admin approval paired with atomic candidate allocation.
   - Allocation Priority Sequence: Candidate allocation must strictly follow the priority sequence (Main -> Alt 1 -> Alt 2 -> Manual Resolution). Never automatically assign a fourth unapproved option.
   - Guest-First Lifecycle: Customer accounts are never required for bookings. Reservations strictly require first name, last name, and email.
   - Decoupled Booking and Payment QRs: Payment QR and booking QR are strictly separate. Booking QRs encode opaque non-PII tokens and remain active exclusively during the confirmed booking window.
3. Zero Hallucinated Dependencies: Never introduce new third-party libraries or external dependencies unless explicitly specified in `docs/sdd-deskatlas.md` or root `package.json`, or approved by human maintainers.
4. UI Component and Style Consistency: When touching the UI (adding new screens or editing existing components), you must strictly reuse and adhere to the current UI components, layouts, design tokens, and visual styling established in this repository (such as Tailwind CSS tokens, shared components in `packages/ui/`, and existing patterns in `apps/*/src/features/`). Never introduce arbitrary ad-hoc styles, conflicting color palettes, or unapproved external UI libraries.

---

## 2. Hard Bans & Quality Constraints

| Ban Identifier | Restricted Pattern | Enforcement Rationale | Mandated Alternative |
|---|---|---|---|
| BAN-PUNCT-01 | Em-dashes in documentation | Breaks consistency with voice guidelines and text formatting | Use standard hyphens, colons, or parentheses |
| BAN-SPEC-02 | Writing code with no spec link | Causes requirement leakage and zombie components | Trace commit back to PRD-F#, SDD-C#, ERD-E#, or QAD-TC# ID |
| BAN-DIAG-03 | Box diagrams or trees in code blocks | Unparseable for agent automated diffs | Use standard Markdown tables and ordered prose |
| BAN-AUTH-04 | Hardcoded API tokens or secrets | Security risk; credential leakage | Inject via environment variables (`.env`, `.env.example`) |
| BAN-TYPE-05 | Using any in TypeScript files | Degrades type safety across API contracts | Use explicit schemas, generics, interfaces, or unknown |
| BAN-MIGR-06 | Manual DB mutations or raw DDL in code | Breaks local vs production state parity | Write reversible migration files in `supabase/` |
| BAN-RLS-07 | Bypassing Supabase RLS on client calls | Violates tenant isolation and user data privacy | Use authenticated client for user operations; restrict service role key to server actions / route handlers |
| BAN-HOLD-08 | Violating the No-Hold rule or allocation sequence | Corrupts coworking capacity and allows ghost reservations | Enforce atomic payment confirmation and allocation priority (Main -> Alt 1 -> Alt 2 -> Manual) |
| BAN-UI-09 | Introducing foreign UI styles or ad-hoc styling | Fragments the user interface and breaks design consistency | Strictly reuse existing repository components and established UI styling patterns |

---

## 3. System Architecture Boundaries

| Directory Path | Architectural Layer | Permitted Operations | Restricted Operations |
|---|---|---|---|
| `docs/` | Specification & Governance | Editing markdown specs (`docs/index.md`, PRD, BRD, SDD, DSD, ERD, QAD, BUILD), referencing `docs/archive/` | Adding executable application code |
| `apps/customer-website/` | Next.js Customer Web Application | Guest reservations, interactive floorplan viewer, reservation tracking, self-service reschedule modal | Direct raw SQL queries; bypassing domain services; exposing service role secrets |
| `apps/kiosk/` | Next.js On-Site Kiosk Terminal | Touchscreen walk-in booking, on-screen QR/counter payment, staff/admin counter verification | Persisting customer-held payment links; emailing 1-hour payment links |
| `apps/staff-dashboard/` | Next.js Staff Operations Portal | Real-time active ops, QR check-in/out scanner, manual reference code verification, time extension | Modifying system business settings; approving online payment proofs (admin only) |
| `apps/admin-portal/` | Next.js Admin Management Suite | Workspace/template CRUD, interactive 2D map builder, payment review, closure dates, staff invitations, analytics | Bypassing audit logs; arbitrary direct schema alterations |
| `packages/domain/` | Pure TypeScript Domain Layer | Business logic, allocation engine, pricing, reschedule rules, notification services, repository interfaces | React UI components; direct DOM manipulation; framework-specific couplings |
| `packages/ui/` | Shared Presentation Primitives | Reusable button, modal, input, and layout components | Domain business logic; server-only secrets; database access |
| `packages/validation/` | Shared Validation Layer | Zod schemas for reservation input, payment proofs, settings, and API request contracts | Direct database access; presentation styling |
| `packages/config/` | Shared Monorepo Config | Shared tsconfig, tailwind presets, and environment helpers | Runtime business logic |
| `supabase/` | Relational Persistence & Schema | PostgreSQL 15/16 DDL migrations, RLS policies, trigger functions, seed data | Runtime application code; unversioned schema modifications |
| `tests/` | Automated Test Suite | Vitest integration, unit, and feature test specifications | Committing mock credentials or mutating production tables |
| `scripts/` | Bootstrap & Automation | Admin / staff user initialization and bootstrapping | Executing unverified destructive SQL scripts |

---

## 4. Agent Lifecycle Protocols

1. Planning: Read `docs/index.md` and upstream specification documents (`docs/brd-deskatlas.md`, `docs/prd-deskatlas.md`, `docs/sdd-deskatlas.md`, `docs/dsd-deskatlas.md`, `docs/erd-deskatlas.md`, `docs/qad-deskatlas.md`, `docs/build-deskatlas.md`). Ensure scope boundaries and traceability mapping (PRD-F#, SDD-C#, ERD-E#, QAD-TC#) are respected.
2. Implementation: Keep diffs focused, maintain domain separation across apps and packages. Enforce schema validation (TypeScript interfaces and Zod schemas). Never use em-dashes in code comments or documentation.
3. Verification:
   - Static Typecheck: Execute `pnpm typecheck`
   - Linter: Execute `pnpm lint`
   - Quality Assurance: Validate changes against traceable test suites via `pnpm test`
   - Production Build: Execute `pnpm build`

---

## Self-Check

- [x] Document metadata aligns with DeskAtlas master documentation index (`docs/index.md`)
- [x] Primary operating directives map to all core specifications (BRD, PRD, SDD, DSD, ERD, QAD, BUILD)
- [x] Hard bans enforce zero em-dashes, spec traceability, type safety, No-Hold rule, and security policies
- [x] System architecture boundaries reflect actual DeskAtlas monorepo directory structure (`apps/`, `packages/`, `supabase/`, `tests/`)
- [x] Agent lifecycle protocols define concrete build, lint, typecheck, and test commands
