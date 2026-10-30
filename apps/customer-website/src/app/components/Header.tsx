"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

export function Header({
  defaultMobileMenuOpen = false,
  currentPathname,
}: {
  defaultMobileMenuOpen?: boolean;
  currentPathname?: string;
} = {}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(defaultMobileMenuOpen);
  let hookPathname = "";
  try {
    hookPathname = usePathname() || "";
  } catch {
    hookPathname = "";
  }
  const pathname = currentPathname !== undefined ? currentPathname : hookPathname;

  const isReserveActive = pathname === "/reserve" || pathname.startsWith("/reserve/");
  const isServicesActive = pathname === "/services" || pathname.startsWith("/services/");
  const isTrackActive = pathname === "/track" || pathname.startsWith("/track/");

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
          className="hidden md:flex items-center gap-2 text-sm"
          data-testid="header-desktop-nav"
        >
          {/* Reserve */}
          <Link
            href="/reserve"
            className={`px-4 py-2 rounded-full font-bold transition-all text-xs uppercase tracking-wider ${
              isReserveActive
                ? "bg-[#0C3B27] text-white shadow-sm"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
            data-testid="nav-link-reserve"
          >
            Reserve
          </Link>

          {/* Services */}
          <Link
            href="/services"
            className={`px-4 py-2 rounded-full font-bold transition-all text-xs uppercase tracking-wider ${
              isServicesActive
                ? "bg-[#0C3B27] text-white shadow-sm"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
            data-testid="nav-link-services"
          >
            Services
          </Link>

          {/* Track Reservation (Distinct Status Utility Treatment) */}
          <Link
            href="/track"
            className={`ml-2 px-4 py-2 rounded-full font-bold transition-all text-xs uppercase tracking-wider flex items-center gap-1.5 ${
              isTrackActive
                ? "bg-[#0C3B27] text-[#C8F451] shadow-sm border border-[#0C3B27]"
                : "bg-slate-50 text-slate-800 border border-slate-200 hover:bg-slate-100 hover:border-slate-300"
            }`}
            data-testid="nav-link-track"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
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
          <nav className="flex flex-col gap-2 text-sm font-semibold">
            <Link
              href="/reserve"
              onClick={() => setMobileMenuOpen(false)}
              className={`min-h-[44px] flex items-center px-4 py-2.5 rounded-xl font-bold transition-all text-xs uppercase tracking-wider ${
                isReserveActive
                  ? "bg-[#0C3B27] text-white shadow-sm"
                  : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              }`}
              data-testid="mobile-nav-link-reserve"
            >
              Reserve
            </Link>
            <Link
              href="/services"
              onClick={() => setMobileMenuOpen(false)}
              className={`min-h-[44px] flex items-center px-4 py-2.5 rounded-xl font-bold transition-all text-xs uppercase tracking-wider ${
                isServicesActive
                  ? "bg-[#0C3B27] text-white shadow-sm"
                  : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              }`}
              data-testid="mobile-nav-link-services"
            >
              Services
            </Link>
            <Link
              href="/track"
              onClick={() => setMobileMenuOpen(false)}
              className={`min-h-[44px] flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all text-xs uppercase tracking-wider ${
                isTrackActive
                  ? "bg-[#0C3B27] text-[#C8F451] shadow-sm border border-[#0C3B27]"
                  : "bg-slate-50 text-slate-800 border border-slate-200 hover:bg-slate-100 hover:border-slate-300"
              }`}
              data-testid="mobile-nav-link-track"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Track Reservation
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Header;
