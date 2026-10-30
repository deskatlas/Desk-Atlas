import fs from 'node:fs';
import path from 'node:path';
import React, { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server.node.js';
import { Header } from '../apps/customer-website/src/app/components/Header';
import { LandingPage } from '../apps/customer-website/src/features/landing/components/LandingPage';

// MS-96 / PRD-F4 / PRD-F14 / PRD-F26 / SDD-C1 / DSD-UI4 / DSD-UI6 / DSD-UI12 / QAD-TC22
// Customer portal navigation header visual contrast, active route indicators, and reservation status prominence.

function hexToRgb(hex: string): [number, number, number] {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function computeContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const [r1, g1, b1] = hexToRgb(foregroundHex);
  const [r2, g2, b2] = hexToRgb(backgroundHex);
  const l1 = getRelativeLuminance(r1, g1, b1);
  const l2 = getRelativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('MS-96: Customer Navigation Visual Contrast, Active Route Indicators, and Status Prominence', () => {
  it('MS96-TC01: Active Route Highlighting on /reserve', () => {
    const markup = renderToStaticMarkup(createElement(Header, { currentPathname: '/reserve' }));

    // Reserve link should possess active styling: dark emerald fill and white text
    const reserveMatch = markup.match(/<a[^>]*data-testid="nav-link-reserve"[^>]*>/);
    expect(reserveMatch).not.toBeNull();
    const reserveTag = reserveMatch![0];
    expect(reserveTag).toContain('bg-[#0C3B27]');
    expect(reserveTag).toContain('text-white');
    expect(reserveTag).toContain('shadow-sm');
    expect(reserveTag).toContain('rounded-full');

    // Inactive links (services) should have neutral slate styling
    const servicesMatch = markup.match(/<a[^>]*data-testid="nav-link-services"[^>]*>/);
    expect(servicesMatch).not.toBeNull();
    expect(servicesMatch![0]).toContain('text-slate-700');
    expect(servicesMatch![0]).not.toContain('bg-[#0C3B27]');

    // Sub-path prefix matching (/reserve/step-2)
    const subPathMarkup = renderToStaticMarkup(createElement(Header, { currentPathname: '/reserve/step-2' }));
    const subReserveMatch = subPathMarkup.match(/<a[^>]*data-testid="nav-link-reserve"[^>]*>/);
    expect(subReserveMatch![0]).toContain('bg-[#0C3B27]');
    expect(subReserveMatch![0]).toContain('text-white');
  });

  it('MS96-TC02: Active Route Highlighting on /services', () => {
    const markup = renderToStaticMarkup(createElement(Header, { currentPathname: '/services' }));

    // Services link should possess active styling
    const servicesMatch = markup.match(/<a[^>]*data-testid="nav-link-services"[^>]*>/);
    expect(servicesMatch).not.toBeNull();
    const servicesTag = servicesMatch![0];
    expect(servicesTag).toContain('bg-[#0C3B27]');
    expect(servicesTag).toContain('text-white');
    expect(servicesTag).toContain('shadow-sm');

    // Inactive links (reserve) should have neutral slate styling
    const reserveMatch = markup.match(/<a[^>]*data-testid="nav-link-reserve"[^>]*>/);
    expect(reserveMatch).not.toBeNull();
    expect(reserveMatch![0]).toContain('text-slate-700');
    expect(reserveMatch![0]).not.toContain('bg-[#0C3B27]');
  });

  it('MS96-TC03: Active Route Highlighting on /track', () => {
    const markup = renderToStaticMarkup(createElement(Header, { currentPathname: '/track' }));

    // Track Reservation link should possess active status styling with lime accent
    const trackMatch = markup.match(/<a[^>]*data-testid="nav-link-track"[^>]*>/);
    expect(trackMatch).not.toBeNull();
    const trackTag = trackMatch![0];
    expect(trackTag).toContain('bg-[#0C3B27]');
    expect(trackTag).toContain('text-[#C8F451]');
    expect(trackTag).toContain('border-[#0C3B27]');

    // Inactive links should have slate-700 styling
    const reserveMatch = markup.match(/<a[^>]*data-testid="nav-link-reserve"[^>]*>/);
    expect(reserveMatch![0]).toContain('text-slate-700');
  });

  it('MS96-TC04: Inactive Link Contrast meets WCAG 2.1 AA Standards', () => {
    const markup = renderToStaticMarkup(createElement(Header, { currentPathname: '/' }));

    // Inactive links use text-slate-700 (#334155)
    expect(markup).toContain('text-slate-700');

    // Calculate contrast of slate-700 (#334155) against white background (#ffffff)
    const contrastRatio = computeContrastRatio('#334155', '#ffffff');
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
    // Expected contrast ratio for #334155 on #ffffff is ~10:1, well above 4.5:1
    expect(contrastRatio).toBeGreaterThan(9.0);
  });

  it('MS96-TC05: Track Reservation Status Badge and Radar Indicator', () => {
    const markup = renderToStaticMarkup(createElement(Header, { currentPathname: '/' }));

    // Track Reservation button should have distinct status treatment
    expect(markup).toContain('data-testid="nav-link-track"');
    expect(markup).toContain('Track Reservation');

    // Contains radar pulse indicator
    expect(markup).toContain('animate-pulse');
    expect(markup).toContain('bg-emerald-500');

    // Bordered pill treatment for status utility button
    const trackMatch = markup.match(/<a[^>]*data-testid="nav-link-track"[^>]*>/);
    expect(trackMatch).not.toBeNull();
    const trackTag = trackMatch![0];
    expect(trackTag).toContain('border');
    expect(trackTag).toContain('rounded-full');
  });

  it('MS96-TC06: Mobile Drawer Active State and Responsive Navigation', () => {
    const markup = renderToStaticMarkup(
      createElement(Header, { defaultMobileMenuOpen: true, currentPathname: '/services' })
    );

    // Mobile nav drawer should be rendered
    expect(markup).toContain('data-testid="mobile-nav-drawer"');

    // Mobile services link should have active background fill and white text
    const mobileServicesMatch = markup.match(/<a[^>]*data-testid="mobile-nav-link-services"[^>]*>/);
    expect(mobileServicesMatch).not.toBeNull();
    const mobileServicesTag = mobileServicesMatch![0];
    expect(mobileServicesTag).toContain('bg-[#0C3B27]');
    expect(mobileServicesTag).toContain('text-white');
    expect(mobileServicesTag).toContain('min-h-[44px]');

    // Mobile reserve link should be inactive
    const mobileReserveMatch = markup.match(/<a[^>]*data-testid="mobile-nav-link-reserve"[^>]*>/);
    expect(mobileReserveMatch).not.toBeNull();
    expect(mobileReserveMatch![0]).toContain('text-slate-700');
    expect(mobileReserveMatch![0]).toContain('min-h-[44px]');

    // Mobile track link should have pulse indicator
    expect(markup).toContain('data-testid="mobile-nav-link-track"');
  });

  it('MS96-TC07: Post-Submission Tracking CTA Prominence in ReservationPage', () => {
    const reservationPagePath = path.resolve(
      __dirname,
      '../apps/customer-website/src/features/reservation/components/ReservationPage.tsx'
    );
    const content = fs.readFileSync(reservationPagePath, 'utf8');

    // Assert track submitted status button exists with high-visibility primary styling
    expect(content).toContain('data-testid="track-submitted-status-btn"');
    expect(content).toContain('da-primary-button');
    expect(content).toContain('Track Reservation Status');

    // Assert reference code callout badge is included in the CTA
    expect(content).toContain('submittedReservation.referenceCode');

    // Assert return to home is styled as secondary button
    expect(content).toContain('data-testid="return-home-btn"');
    expect(content).toContain('da-secondary-button');

    // Assert CTA navigates to /track with reference code parameter
    expect(content).toContain('/track?code=');
  });

  it('MS96-TC08: Landing Page Header Unification', () => {
    const landingMarkup = renderToStaticMarkup(createElement(LandingPage));

    // Landing page should render canonical Header navigation elements
    expect(landingMarkup).toContain('data-testid="header-desktop-nav"');
    expect(landingMarkup).toContain('data-testid="nav-link-reserve"');
    expect(landingMarkup).toContain('data-testid="nav-link-services"');
    expect(landingMarkup).toContain('data-testid="nav-link-track"');
    expect(landingMarkup).toContain('data-testid="header-logo-link"');
  });

  it('MS96-TC09: Zero Em-Dash Compliance (BAN-PUNCT-01)', () => {
    const filesToCheck = [
      path.resolve(__dirname, '../apps/customer-website/src/app/components/Header.tsx'),
      path.resolve(__dirname, '../apps/customer-website/src/features/landing/components/LandingPage.tsx'),
      path.resolve(__dirname, '../apps/customer-website/src/features/reservation/components/ReservationPage.tsx'),
      path.resolve(__dirname, '../docs/milestone/ms96.md'),
      __filename,
    ];

    for (const filePath of filesToCheck) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const hasEmDash = fileContent.includes('\u2014');
      expect(hasEmDash, `File ${filePath} contains forbidden em-dash`).toBe(false);
    }
  });
});
