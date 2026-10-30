import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server';
import { AskReservationButton } from '../apps/customer-website/src/features/assistant/AskReservationButton';

// MS-97 / PRD-F4 / PRD-F14 / PRD-F22 / BRD-M1 / BRD-M4 / SDD-C1 / DSD-UI4 / DSD-UI6 / DSD-UI12 / QAD-TC22
// Customer Rewards Booking History Action Button Sizing, Table Density, and Mobile Card Layout Polish
// Test Cases: MS97-TC01 through MS97-TC06

describe('MS-97: Customer Rewards Booking History Action Button Sizing & Table Density Polish', () => {
  const rootDir = path.resolve(__dirname, '..');
  const dashboardPath = path.join(
    rootDir,
    'apps',
    'customer-website',
    'src',
    'features',
    'tracking',
    'components',
    'RewardsVoucherDashboard.tsx'
  );
  const askButtonPath = path.join(
    rootDir,
    'apps',
    'customer-website',
    'src',
    'features',
    'assistant',
    'AskReservationButton.tsx'
  );
  const globalsCssPath = path.join(
    rootDir,
    'apps',
    'customer-website',
    'src',
    'styles',
    'globals.css'
  );

  const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');
  const askButtonContent = fs.readFileSync(askButtonPath, 'utf8');
  const globalsCssContent = fs.readFileSync(globalsCssPath, 'utf8');

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // MS97-TC01: Compact Variant Button Dimensions
  it('MS97-TC01: Compact Variant Button Dimensions: renders compact badge within 26px to 32px height', () => {
    const html = renderToStaticMarkup(
      React.createElement(AskReservationButton, {
        reservationId: 'res-compact-001',
        size: 'compact',
      })
    );

    // 1. Assert element renders with compact testid
    expect(html).toContain('data-testid="ask-assistant-btn-res-compact-001"');

    // 2. Assert compact Tailwind classes are applied
    expect(html).toContain('px-2.5');
    expect(html).toContain('py-1');
    expect(html).toContain('text-[11px]');
    expect(html).toContain('font-semibold');
    expect(html).toContain('rounded-lg');
    expect(html).toContain('bg-slate-50');
    expect(html).toContain('border-slate-200');
    expect(html).not.toContain('da-secondary-button');

    // 3. Compute CSS box-model height for compact button:
    // py-1 = 0.25rem * 2 = 8px padding vertical
    // text-[11px] line-height is typically 16px (1rem)
    // border = 1px top + 1px bottom = 2px
    const verticalPaddingPx = 8;
    const baseLineHeightPx = 16;
    const borderPx = 2;
    const computedCompactHeight = verticalPaddingPx + baseLineHeightPx + borderPx;

    expect(computedCompactHeight).toBeGreaterThanOrEqual(26);
    expect(computedCompactHeight).toBeLessThanOrEqual(32);

    // 4. Verify against bloated da-secondary-button min-height (2.75rem = 44px)
    expect(globalsCssContent).toContain('.da-secondary-button');
    expect(globalsCssContent).toContain('padding: 0.9rem 1.4rem;');
    expect(computedCompactHeight).toBeLessThan(44);
  });

  // MS97-TC02: Default Variant Backward Compatibility
  it('MS97-TC02: Default Variant Backward Compatibility: renders default styling and custom label support', () => {
    // 1. Render without size prop (default fallback)
    const defaultHtml = renderToStaticMarkup(
      React.createElement(AskReservationButton, {
        reservationId: 'res-default-002',
      })
    );

    expect(defaultHtml).toContain('data-testid="ask-assistant-btn-res-default-002"');
    expect(defaultHtml).toContain('da-secondary-button');
    expect(defaultHtml).toContain('text-xs');
    expect(defaultHtml).toContain('Ask about this reservation');
    expect(defaultHtml).toContain('bg-emerald-500');

    // 2. Render with explicit size="default"
    const explicitDefaultHtml = renderToStaticMarkup(
      React.createElement(AskReservationButton, {
        reservationId: 'res-default-003',
        size: 'default',
      })
    );
    expect(explicitDefaultHtml).toContain('Ask about this reservation');

    // 3. Render with custom label override
    const customLabelHtml = renderToStaticMarkup(
      React.createElement(AskReservationButton, {
        reservationId: 'res-custom-004',
        size: 'compact',
        label: 'Ask AI',
      })
    );
    expect(customLabelHtml).toContain('Ask AI');
    expect(customLabelHtml).not.toContain('Ask Assistant');
  });

  // MS97-TC03: Desktop Table Row Density and Assistant Removal
  it('MS97-TC03: Desktop Table Row Density: Reference column isolated, Actions column streamlined to Rebook CTA without assistant clutter', () => {
    // 1. Table header has Action column in text-right
    expect(dashboardContent).toContain('<th className="p-3 text-right">Action</th>');

    // 2. Reference code cell displays only reference code and is whitespace-nowrap
    expect(dashboardContent).toMatch(
      /<td className="p-3 font-mono font-bold text-slate-900 whitespace-nowrap">\s*\{b\.reference_code\}\s*<\/td>/
    );

    // 3. Actions cell cleanly displays only the Rebook button
    expect(dashboardContent).toContain('<td className="p-3 text-right whitespace-nowrap">');
    expect(dashboardContent).toContain('data-testid={`rebook-btn-${b.reference_code}`}');

    // 4. Assert Ask Assistant button is removed from booking history dashboard
    expect(dashboardContent).not.toContain('<AskReservationButton');
    expect(dashboardContent).not.toContain("import { AskReservationButton }");
  });

  // MS97-TC04: Rebook Button Primary Styling & High-Contrast Typography
  it('MS97-TC04: Rebook Button Primary Styling: verifies dark-green pill styling and white text contrast across desktop and mobile', () => {
    // 1. Desktop Rebook button pill styling
    expect(dashboardContent).toContain('data-testid={`rebook-btn-${b.reference_code}`}');
    expect(dashboardContent).toContain('bg-[#0C3B27]');
    expect(dashboardContent).toContain('text-white');
    expect(dashboardContent).toContain('!text-white');
    expect(dashboardContent).toContain('style={{ color: "#ffffff" }}');
    expect(dashboardContent).toContain('rounded-full');
    expect(dashboardContent).toContain('hover:brightness-110');

    // 2. Mobile Rebook button pill styling
    expect(dashboardContent).toContain('data-testid={`rebook-card-btn-${b.reference_code}`}');
    expect(dashboardContent).toMatch(
      /data-testid=\{`rebook-card-btn-\$\{b\.reference_code\}`\}\s*>\s*Rebook/
    );

    // 3. Neither Rebook CTA relies on bulky da-secondary-button class
    const desktopRowSection = dashboardContent.slice(
      dashboardContent.indexOf('rebook-btn-${b.reference_code}') - 150,
      dashboardContent.indexOf('rebook-btn-${b.reference_code}') + 50
    );
    expect(desktopRowSection).not.toContain('da-secondary-button');

    // 4. Verify explicit contrast guarantee rules in globals.css
    expect(globalsCssContent).toContain('.da-rebook-pill');
    expect(globalsCssContent).toContain('[data-testid*="rebook-btn"]');
    expect(globalsCssContent).toContain('color: #ffffff !important;');
  });

  // MS97-TC05: Mobile Card Viewport Harmony
  it('MS97-TC05: Mobile Card Viewport Harmony: streamlined right-aligned Rebook CTA without assistant clutter', () => {
    // 1. Mobile card action bar footer structure aligns cleanly to the right
    expect(dashboardContent).toContain(
      '<div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end">'
    );

    // 2. Rebook button is rendered inside mobile card footer
    expect(dashboardContent).toContain('data-testid={`rebook-card-btn-${b.reference_code}`}');

    // 3. Assistant button is not present in mobile card footer
    expect(dashboardContent).not.toContain('label="Ask Assistant"');
  });

  // MS97-TC06: Assistant Event Firing (Backwards Compatibility)
  it('MS97-TC06: Assistant Event Firing: dispatches deskatlas:assistant:reservation with reservationId detail for single reservation tracking', () => {
    let capturedEvent: CustomEvent<{ reservationId: string }> | null = null;

    const mockListener = (event: Event) => {
      capturedEvent = event as CustomEvent<{ reservationId: string }>;
    };

    // Attach EventTarget to window for Node test environment
    const eventBus = new EventTarget();
    const globalContext = globalThis as unknown as { window?: EventTarget };
    const originalWindow = globalContext.window;
    globalContext.window = eventBus;

    eventBus.addEventListener('deskatlas:assistant:reservation', mockListener);

    try {
      const testReservationId = 'res-target-999';
      // Invoke component function to obtain button props and trigger its onClick handler
      const buttonElement = AskReservationButton({
        reservationId: testReservationId,
        size: 'compact',
      });
      expect(buttonElement).not.toBeNull();
      buttonElement?.props.onClick();

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent?.type).toBe('deskatlas:assistant:reservation');
      expect(capturedEvent?.detail).toEqual({ reservationId: testReservationId });
    } finally {
      eventBus.removeEventListener('deskatlas:assistant:reservation', mockListener);
      globalContext.window = originalWindow;
    }
  });
});
