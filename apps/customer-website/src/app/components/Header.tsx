"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--da-border)] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5" data-testid="header-logo-link">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--da-brand-accent)] flex-shrink-0">
            <div className="h-3 w-3 rounded-[3px] bg-[var(--da-brand-dark)]" />
          </div>
          <span className="text-xl font-extrabold tracking-[-0.02em] text-[var(--da-brand-dark)]">
            DeskAtlas
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav
          className="hidden md:flex items-center gap-6 text-sm font-semibold text-[var(--da-text-secondary)]"
          data-testid="header-desktop-nav"
        >
          <Link
            href="/reserve"
            className="hover:text-[var(--da-brand-dark)] transition-colors"
            data-testid="nav-link-reserve"
          >
            Reserve
          </Link>
          <Link
            href="/services"
            className="hover:text-[var(--da-brand-dark)] transition-colors"
            data-testid="nav-link-services"
          >
            Services
          </Link>
          <Link
            href="/track"
            className="hover:text-[var(--da-brand-dark)] transition-colors"
            data-testid="nav-link-track"
          >
            Track Reservation
          </Link>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          aria-label="Toggle navigation menu"
          data-testid="mobile-menu-toggle"
          className="md:hidden p-2 rounded-lg hover:bg-gray-100 text-[var(--da-brand-dark)]"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div
          className="md:hidden border-t border-[var(--da-border)] bg-white px-6 py-4 shadow-lg"
          data-testid="mobile-nav-drawer"
        >
          <nav className="flex flex-col gap-3 text-sm font-semibold text-[var(--da-text-secondary)]">
            <Link
              href="/reserve"
              onClick={() => setMobileMenuOpen(false)}
              className="py-1 hover:text-[var(--da-brand-dark)]"
              data-testid="mobile-nav-link-reserve"
            >
              Reserve
            </Link>
            <Link
              href="/services"
              onClick={() => setMobileMenuOpen(false)}
              className="py-1 hover:text-[var(--da-brand-dark)]"
              data-testid="mobile-nav-link-services"
            >
              Services
            </Link>
            <Link
              href="/track"
              onClick={() => setMobileMenuOpen(false)}
              className="py-1 hover:text-[var(--da-brand-dark)]"
              data-testid="mobile-nav-link-track"
            >
              Track Reservation
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Header;

