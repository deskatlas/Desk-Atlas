"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";

export function RentalInstructionsCard() {
  return (
    <div
      id="how-to-rent"
      data-testid="how-to-rent-card"
      className="bg-white rounded-2xl border border-[var(--da-border)] shadow-sm p-6 mb-8 transition-all duration-300"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--da-border-light)]">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
            How to Rent Equipment
          </h2>
          <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
            Equipment rentals are managed on-site at the front desk for verified active bookings.
          </p>
        </div>
        <Link
          href="/reserve"
          data-testid="locate-kiosk-map-button"
          className="da-secondary-button flex items-center gap-2 text-xs font-semibold shrink-0"
        >
          <MapPin className="w-3.5 h-3.5 text-[var(--da-primary)]" />
          Locate Kiosk on Workspace Map
        </Link>
      </div>

      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="rental-steps-list">
        <li
          className="flex flex-col gap-2 rounded-xl p-3.5 bg-[var(--da-canvas)] border border-[var(--da-border-light)]"
          data-testid="rental-step-1"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[var(--da-primary)]/10 text-[var(--da-primary)] font-bold flex items-center justify-center text-sm shrink-0">
              1
            </span>
            <span className="text-sm font-bold text-[var(--da-brand-dark)]">
              Go to staff
            </span>
          </div>
          <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed pl-10">
            Head over to the front desk reception or kiosk terminal. (Can be found in workspace map as kiosk / front desk).
          </p>
        </li>

        <li
          className="flex flex-col gap-2 rounded-xl p-3.5 bg-[var(--da-canvas)] border border-[var(--da-border-light)]"
          data-testid="rental-step-2"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[var(--da-primary)]/10 text-[var(--da-primary)] font-bold flex items-center justify-center text-sm shrink-0">
              2
            </span>
            <span className="text-sm font-bold text-[var(--da-brand-dark)]">
              Prepare your booking details
            </span>
          </div>
          <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed pl-10">
            Have your 6-character booking reference code or booking QR code pass ready on your phone.
          </p>
        </li>

        <li
          className="flex flex-col gap-2 rounded-xl p-3.5 bg-[var(--da-canvas)] border border-[var(--da-border-light)]"
          data-testid="rental-step-3"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[var(--da-primary)]/10 text-[var(--da-primary)] font-bold flex items-center justify-center text-sm shrink-0">
              3
            </span>
            <span className="text-sm font-bold text-[var(--da-brand-dark)]">
              Ask staff for the desired item
            </span>
          </div>
          <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed pl-10">
            Request your desired monitor, keyboard, or peripheral from available inventory.
          </p>
        </li>

        <li
          className="flex flex-col gap-2 rounded-xl p-3.5 bg-[var(--da-canvas)] border border-[var(--da-border-light)]"
          data-testid="rental-step-4"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[var(--da-primary)]/10 text-[var(--da-primary)] font-bold flex items-center justify-center text-sm shrink-0">
              4
            </span>
            <span className="text-sm font-bold text-[var(--da-brand-dark)]">
              Give valid ID to staff and pay
            </span>
          </div>
          <p className="text-xs text-[var(--da-text-secondary)] leading-relaxed pl-10">
            Present a valid government-issued or corporate ID for safe deposit and complete your rental payment (cash or e-wallet).
          </p>
        </li>
      </ol>
    </div>
  );
}

