import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from '../apps/kiosk/node_modules/react-dom/server.node.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  createBookingAccessService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  InMemoryWorkspaceRepository,
  ReservationMemoryRepository,
  type BookingScanResult,
} from '@deskatlas/domain';
import { KioskScanner } from '../apps/kiosk/src/app/features/qr-scanner/KioskScanner';
import { KioskReferenceEntry } from '../apps/kiosk/src/app/features/qr-scanner/KioskReferenceEntry';
import { QRScanFlow } from '../apps/kiosk/src/app/components/QRScanFlow';
import { ReferenceCodeFlow } from '../apps/kiosk/src/app/components/ReferenceCodeFlow';

function createMockBooking(overrides: Partial<BookingScanResult> = {}): BookingScanResult {
  return {
    reservationId: 'res-ms92-001',
    referenceCode: 'DA-MS9201',
    reservationStatus: 'CONFIRMED',
    accessState: 'ACTIVE',
    checkInState: 'CHECKED_IN',
    customerName: 'Juan Dela Cruz',
    customerEmail: 'juan@example.com',
    workspaceInstanceId: 'inst-team-1',
    workspaceDisplayName: 'Team Suite Alpha',
    workspaceInstanceCode: 'TS-01',
    workspaceTemplateName: 'Team Suite',
    floorName: 'Level 2',
    bookingStartAt: '2026-10-30T09:00:00.000Z',
    bookingEndAt: '2026-10-30T17:00:00.000Z',
    checkedInAt: '2026-10-30T09:05:00.000Z',
    checkedOutAt: null,
    qrIssuedAt: '2026-10-30T08:50:00.000Z',
    timeRemainingSeconds: 28800,
    reentry: false,
    companionNames: [],
    ...overrides,
  };
}

describe('MS-92: Kiosk Multi-Capacity Reservation Check-In Companion Display and Group Verification', () => {
  // MS92-TC01: QR Scan Single Booker (Zero Companions)
  it('MS92-TC01: QR Scan Single Booker (Zero Companions) omits companion roster container', () => {
    const booking = createMockBooking({ companionNames: [] });
    const html = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(html).toContain('Juan Dela Cruz');
    expect(html).toContain('Team Suite Alpha');
    expect(html).not.toContain('data-testid="kiosk-companion-roster"');
    expect(html).not.toContain('Companions');
    expect(html).not.toContain('Group Check-In');
  });

  // MS92-TC02: QR Scan Multi-Capacity (1 Companion)
  it('MS92-TC02: QR Scan Multi-Capacity (1 Companion) renders single badge and counter', () => {
    const booking = createMockBooking({ companionNames: ['Maria Clara'] });
    const html = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(html).toContain('Juan Dela Cruz');
    expect(html).toContain('data-testid="kiosk-companion-roster"');
    expect(html).toContain('Companions (1)');
    expect(html).toContain('Group Check-In');
    expect(html).toContain('data-testid="kiosk-companion-badge-0"');
    expect(html).toContain('Maria Clara');
  });

  // MS92-TC03: QR Scan Multi-Capacity (Multiple Companions)
  it('MS92-TC03: QR Scan Multi-Capacity (Multiple Companions) renders all badges accurately', () => {
    const companions = ['Alice', 'Bob', 'Charlie', 'David', 'Eve'];
    const booking = createMockBooking({ companionNames: companions });
    const html = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(html).toContain('Companions (5)');
    expect(html).toContain('data-testid="kiosk-companion-roster"');
    companions.forEach((name, idx) => {
      expect(html).toContain(`data-testid="kiosk-companion-badge-${idx}"`);
      expect(html).toContain(name);
    });
  });

  // MS92-TC04: Reference Code Check-In Companion Display
  it('MS92-TC04: Reference Code Check-In renders companion names matching the reservation record', async () => {
    const booking = createMockBooking({
      referenceCode: 'DA-REF789',
      companionNames: ['Crisostomo Ibarra', 'Elias'],
    });

    const html = renderToStaticMarkup(
      React.createElement(KioskReferenceEntry, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(html).toContain('DA-REF789');
    expect(html).toContain('data-testid="kiosk-companion-roster"');
    expect(html).toContain('Companions (2)');
    expect(html).toContain('data-testid="kiosk-companion-badge-0"');
    expect(html).toContain('Crisostomo Ibarra');
    expect(html).toContain('data-testid="kiosk-companion-badge-1"');
    expect(html).toContain('Elias');

    // Integration check: verify bookingAccessService returns companionNames for reference lookup
    const reservationRepo = new ReservationMemoryRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const now = new Date('2026-10-30T10:00:00.000Z');
    const paymentSessionService = createPaymentSessionService(reservationRepo, () => now);
    const reservationService = createReservationService(
      reservationRepo,
      workspaceRepo,
      reservationRepo,
      paymentSessionService
    );
    const paymentReviewService = createPaymentReviewService(reservationRepo, () => now);
    const bookingAccessService = createBookingAccessService(reservationRepo, () => now);

    const floor = await workspaceRepo.createFloor({ name: 'Floor 1' });
    const template = await workspaceRepo.createTemplate({
      name: 'Meeting Room',
      capacity: 3,
      rateAmount: 500,
      pricingUnit: 'HOURLY',
      defaultShape: 'rectangle',
      defaultColor: '#0C3B27',
      isActive: true,
    });
    const instance = await workspaceRepo.createInstance({
      templateId: template.id,
      floorId: floor.id,
      instanceCode: 'MR-01',
      displayName: 'Boardroom',
    });

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Andres',
        customerLastName: 'Bonifacio',
        customerEmail: 'andres@example.com',
        companionNames: ['Emilio Jacinto', 'Gregoria de Jesus'],
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt: '2026-10-30T09:00:00.000Z',
            endAt: '2026-10-30T13:00:00.000Z',
          },
        ],
      },
      { paymentLinkBaseUrl: 'https://deskatlas.test/pay' }
    );

    await paymentSessionService.submitPaymentProof({
      token: res.paymentSession!.token,
      paymentMethodId: 'pm-gcash',
      proofStoragePath: 'proofs/test.png',
    });
    const session = await paymentSessionService.getPaymentSession(res.paymentSession!.token);
    await paymentReviewService.reviewPayment({
      paymentAttemptId: session.paymentAttemptId,
      actor: { userId: 'admin-1', role: 'ADMIN' },
      decision: 'APPROVE',
    });

    // Lookup by 6-char reference code via booking access service
    const lookupResult = await bookingAccessService.getBookingAccess(res.referenceCode);
    expect(lookupResult.companionNames).toEqual(['Emilio Jacinto', 'Gregoria de Jesus']);
    expect(lookupResult.customerName).toBe('Andres Bonifacio');
  });

  // MS92-TC05: Empty String & Whitespace Companion Sanitization
  it('MS92-TC05: Empty String and Whitespace Companion Sanitization filters invalid names', () => {
    const bookingWithWhitespace = createMockBooking({
      companionNames: ['  Alice  ', '   ', '', '\t\n', 'Bob'],
    });

    const scannerHtml = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: bookingWithWhitespace,
      })
    );

    expect(scannerHtml).toContain('Companions (2)');
    expect(scannerHtml).toContain('Alice');
    expect(scannerHtml).toContain('Bob');
    expect(scannerHtml).toContain('data-testid="kiosk-companion-badge-0"');
    expect(scannerHtml).toContain('data-testid="kiosk-companion-badge-1"');
    expect(scannerHtml).not.toContain('data-testid="kiosk-companion-badge-2"');

    // Entirely whitespace companion list collapses gracefully
    const bookingAllWhitespace = createMockBooking({
      companionNames: ['   ', '', '  \t  '],
    });
    const emptyScannerHtml = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: bookingAllWhitespace,
      })
    );
    expect(emptyScannerHtml).not.toContain('data-testid="kiosk-companion-roster"');
    expect(emptyScannerHtml).not.toContain('Companions');
  });

  // MS92-TC06: Visual Wrapping on Kiosk Screen
  it('MS92-TC06: Visual Wrapping on Kiosk Screen adheres to flex-wrap and badge design tokens', () => {
    const eightCompanions = [
      'Comp 1', 'Comp 2', 'Comp 3', 'Comp 4',
      'Comp 5', 'Comp 6', 'Comp 7', 'Comp 8',
    ];
    const booking = createMockBooking({ companionNames: eightCompanions });

    const html = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    // Verify roster wrapper uses flex and flex-wrap with gap
    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('gap:8px');
    expect(html).toContain('Companions (8)');

    // Verify badge tokens match established styles
    expect(html).toContain('border-radius:9999px');
    expect(html).toContain('background:#FFFFFF');
    expect(html).toContain('color:#1E293B');
    expect(html).toContain('border:1px solid #CBD5E1');
  });

  // MS92-TC07: Re-entry Access State Parity
  it('MS92-TC07: Re-entry Access State Parity displays companion roster alongside re-entry alert', () => {
    const booking = createMockBooking({
      accessState: 'ACTIVE',
      reentry: true,
      checkInState: 'CHECKED_IN',
      companionNames: ['Re-entry Companion A', 'Re-entry Companion B'],
    });

    const scannerHtml = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(scannerHtml).toContain('Active Guest (Re-entry)');
    expect(scannerHtml).toContain('Re-entry authorized during active window');
    expect(scannerHtml).toContain('data-testid="kiosk-companion-roster"');
    expect(scannerHtml).toContain('Companions (2)');
    expect(scannerHtml).toContain('Re-entry Companion A');
    expect(scannerHtml).toContain('Re-entry Companion B');

    const refHtml = renderToStaticMarkup(
      React.createElement(KioskReferenceEntry, {
        onCancel: () => {},
        initialBookingData: booking,
      })
    );

    expect(refHtml).toContain('Active Guest (Re-entry)');
    expect(refHtml).toContain('data-testid="kiosk-companion-roster"');
    expect(refHtml).toContain('Companions (2)');
  });

  // MS92-TC08: Reset and Next Guest Isolation
  it('MS92-TC08: Reset and Next Guest Isolation ensures clean state without companion residue', () => {
    // When no booking data is set, neither scanner nor reference entry renders companion roster
    const cleanScannerHtml = renderToStaticMarkup(
      React.createElement(KioskScanner, {
        onCancel: () => {},
        initialBookingData: null,
      })
    );
    expect(cleanScannerHtml).not.toContain('data-testid="kiosk-companion-roster"');
    expect(cleanScannerHtml).not.toContain('Companions');

    const cleanRefHtml = renderToStaticMarkup(
      React.createElement(KioskReferenceEntry, {
        onCancel: () => {},
        initialBookingData: null,
      })
    );
    expect(cleanRefHtml).not.toContain('data-testid="kiosk-companion-roster"');
    expect(cleanRefHtml).not.toContain('Companions');
    expect(cleanRefHtml).toContain('Reference Code or Reservation ID');

    // Code analysis to verify reset handlers wipe bookingData
    const scannerSrc = fs.readFileSync(
      path.resolve(__dirname, '../apps/kiosk/src/app/features/qr-scanner/KioskScanner.tsx'),
      'utf-8'
    );
    expect(scannerSrc).toContain('setBookingData(null)');

    const refSrc = fs.readFileSync(
      path.resolve(__dirname, '../apps/kiosk/src/app/features/qr-scanner/KioskReferenceEntry.tsx'),
      'utf-8'
    );
    expect(refSrc).toContain('setBookingData(null)');
    expect(refSrc).toContain('setReferenceInput("")');
  });

  // MS92-R03: Legacy Flow Parity
  it('MS92-R03: Legacy flow components support companion roster rendering', () => {
    const qrFlowSrc = fs.readFileSync(
      path.resolve(__dirname, '../apps/kiosk/src/app/components/QRScanFlow.tsx'),
      'utf-8'
    );
    expect(qrFlowSrc).toContain('companionNames?: string[]');
    expect(qrFlowSrc).toContain('data-testid="kiosk-legacy-companion-roster"');
    expect(qrFlowSrc).toContain('Group Check-In');

    const refFlowSrc = fs.readFileSync(
      path.resolve(__dirname, '../apps/kiosk/src/app/components/ReferenceCodeFlow.tsx'),
      'utf-8'
    );
    expect(refFlowSrc).toContain('companionNames?: string[]');
    expect(refFlowSrc).toContain('data-testid="kiosk-legacy-companion-roster"');
    expect(refFlowSrc).toContain('Group Check-In');
  });

  // BAN-PUNCT-01 & Architectural Compliance
  it('BAN-PUNCT-01: Verifies zero em-dashes across all modified files', () => {
    const files = [
      '../apps/kiosk/src/app/features/qr-scanner/KioskScanner.tsx',
      '../apps/kiosk/src/app/features/qr-scanner/KioskReferenceEntry.tsx',
      '../apps/kiosk/src/app/components/QRScanFlow.tsx',
      '../apps/kiosk/src/app/components/ReferenceCodeFlow.tsx',
    ];

    for (const relPath of files) {
      const fullPath = path.resolve(__dirname, relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const emDashMatches = content.match(/[\u2014\u2013]/g);
      expect(
        emDashMatches,
        `File ${relPath} must not contain em-dash or en-dash characters (BAN-PUNCT-01)`
      ).toBeNull();
    }
  });
});
