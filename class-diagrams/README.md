# DeskAtlas UML Class Diagrams

This directory contains standalone, copy-paste ready Markdown files for generating comprehensive UML Class Diagrams in **Mermaid**.

## Diagram Index

| File | Module / Bounded Context | Description |
|---|---|---|
| [`00-master-architecture.md`](./00-master-architecture.md) | **Master Architecture** | High-level system packages, aggregate roots, and cross-boundary coupling |
| [`01-reservation-and-allocation.md`](./01-reservation-and-allocation.md) | **Reservation & Allocation** | Booking aggregates, 3-tier candidate ranking, state transitions, repository drivers |
| [`02-workspace-and-floor-inventory.md`](./02-workspace-and-floor-inventory.md) | **Workspace & Inventory** | Floor hierarchy, workspace template pass pricing, desk instance states |
| [`03-interactive-map-and-geometry.md`](./03-interactive-map-and-geometry.md) | **Interactive Map & Geometry** | Floorplan vector elements, rotated coordinate bounds, collision detection |
| [`04-availability-and-scheduling.md`](./04-availability-and-scheduling.md) | **Availability & Scheduling** | Weekly operating hours, maintenance schedule blocks, real-time unbooked slots |
| [`05-pricing-and-promotions.md`](./05-pricing-and-promotions.md) | **Pricing & Promotions** | Pass pricing windows (Day, Night, Whole-Day), PHT clock drift sync, promotional discounts |
| [`06-payment-and-verification.md`](./06-payment-and-verification.md) | **Payment & Verification** | 60-minute payment countdowns, private S3 proof uploads, admin review workflow |
| [`07-staff-and-access-control.md`](./07-staff-and-access-control.md) | **Staff & Access Control** | Front-desk operations, WebRTC QR scanning, check-in/out, kiosk inactivity reset |
| [`08-business-settings-and-policy.md`](./08-business-settings-and-policy.md) | **Settings & Venue Governance** | Venue timezone, slot granularity, reschedule advance limit, password security policy |
| [`09-audit-reporting-and-analytics.md`](./09-audit-reporting-and-analytics.md) | **Audit & Analytics** | Immutable change logs, revenue aggregations, utilization metrics, Excel reporting |
| [`10-notifications-and-communications.md`](./10-notifications-and-communications.md) | **Notifications & Delivery** | Transactional HTML email generation via Resend API and urgent operational alerts |

## How to Render

1. Open any `.md` file in this directory.
2. Copy the ```mermaid ... ``` code block.
3. Paste directly into:
   - [Mermaid Live Editor](https://mermaid.live/)
   - GitHub Markdown viewer (renders natively)
   - VS Code Mermaid Preview extension
