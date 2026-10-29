import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from '../apps/customer-website/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server.node.js';
import {
  InMemoryAdditionalServiceRepository,
  createAdditionalServiceService,
} from '../packages/domain/src';
import {
  setCustomerAdditionalServiceService,
} from '../apps/customer-website/src/app/api/services/_lib/additionalServiceService';
import { GET } from '../apps/customer-website/src/app/api/services/route';
import {
  RentalInstructionsCard,
} from '../apps/customer-website/src/features/services/components/RentalInstructionsCard';
import {
  RentalServiceCard,
  type RentalServiceItem,
} from '../apps/customer-website/src/features/services/components/RentalServiceCard';
import {
  OneTimeServiceCard,
  type OneTimeServiceItem,
} from '../apps/customer-website/src/features/services/components/OneTimeServiceCard';
import {
  CustomerServicesDashboard,
} from '../apps/customer-website/src/features/services/components/CustomerServicesDashboard';
import { Header } from '../apps/customer-website/src/app/components/Header';
import fs from 'node:fs';
import path from 'node:path';

describe('MS-89: Customer Additional Services & Rental Dashboard, Live Availability Counters, and On-Site Rental Guidance', () => {
  let inMemoryRepo: InMemoryAdditionalServiceRepository;

  beforeEach(() => {
    inMemoryRepo = new InMemoryAdditionalServiceRepository();
    setCustomerAdditionalServiceService(createAdditionalServiceService(inMemoryRepo));
  });

  describe('Part 1: Public Services API Contract & Discovery (MS89-TC01 - MS89-TC02)', () => {
    it('MS89-TC01: Public Discovery Without Auth: unauthenticated requests to GET /api/services return 200 OK with active services', async () => {
      await inMemoryRepo.createAdditionalService({
        name: '27-inch 4K External Monitor',
        description: 'Dell UltraSharp USB-C / HDMI with 65W PD',
        serviceType: 'rental',
        hourlyRate: 50.0,
        dailyRate: 250.0,
        totalInventory: 5,
        isActive: true,
      });

      await inMemoryRepo.createAdditionalService({
        name: 'High-Speed Laser Printing',
        description: 'B&W and full-color document printing',
        serviceType: 'one_time',
        details: 'B&W: PHP 2.00 per page\nColor: PHP 10.00 per page',
        isActive: true,
      });

      const response = await GET();
      expect(response.status).toBe(200);

      // Verify edge cache headers
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('stale-while-revalidate=30');

      const body = await response.json();
      expect(body.rentals).toHaveLength(1);
      expect(body.rentals[0].name).toBe('27-inch 4K External Monitor');
      expect(body.rentals[0].hourlyRate).toBe(50.0);
      expect(body.rentals[0].dailyRate).toBe(250.0);
      expect(body.rentals[0].availableInventory).toBe(5);
      expect(body.rentals[0].inStock).toBe(true);

      expect(body.oneTimeServices).toHaveLength(1);
      expect(body.oneTimeServices[0].name).toBe('High-Speed Laser Printing');
      expect(body.oneTimeServices[0].details).toContain('PHP 2.00 per page');
    });

    it('MS89-TC02: Inactive Services Filtered: inactive services (is_active = false) are excluded from customer response', async () => {
      // 1 active rental
      await inMemoryRepo.createAdditionalService({
        name: 'Active Mechanical Keyboard',
        serviceType: 'rental',
        hourlyRate: 30.0,
        totalInventory: 2,
        isActive: true,
      });

      // 1 inactive rental
      await inMemoryRepo.createAdditionalService({
        name: 'Archived Webcam',
        serviceType: 'rental',
        hourlyRate: 20.0,
        totalInventory: 1,
        isActive: false,
      });

      // 1 active one-time service
      await inMemoryRepo.createAdditionalService({
        name: 'Document Scanning',
        serviceType: 'one_time',
        details: 'Free for checked-in members',
        isActive: true,
      });

      // 1 inactive one-time service
      await inMemoryRepo.createAdditionalService({
        name: 'Retired Fax Service',
        serviceType: 'one_time',
        details: 'PHP 50 per transmission',
        isActive: false,
      });

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.rentals).toHaveLength(1);
      expect(body.rentals[0].name).toBe('Active Mechanical Keyboard');
      expect(body.rentals.some((r: { name: string }) => r.name === 'Archived Webcam')).toBe(false);

      expect(body.oneTimeServices).toHaveLength(1);
      expect(body.oneTimeServices[0].name).toBe('Document Scanning');
      expect(body.oneTimeServices.some((s: { name: string }) => s.name === 'Retired Fax Service')).toBe(false);
    });
  });

  describe('Part 2: UI Presentation & Stock Counter Reactivity (MS89-TC03 - MS89-TC05)', () => {
    it('MS89-TC03: Live Stock Indicator Reactivity: displays in-stock vs out-of-stock badges correctly', () => {
      // In stock item
      const inStockItem: RentalServiceItem = {
        id: 'item-1',
        name: '4K Monitor',
        description: 'UltraSharp USB-C display',
        hourlyRate: 50.0,
        dailyRate: 250.0,
        totalInventory: 5,
        availableInventory: 3,
        inStock: true,
      };

      const inStockMarkup = renderToStaticMarkup(
        createElement(RentalServiceCard, { service: inStockItem })
      );

      expect(inStockMarkup).toContain('Available: 3 in stock');
      expect(inStockMarkup).toContain('bg-emerald-50');
      expect(inStockMarkup).not.toContain('Currently Out of Stock');

      // Out of stock item
      const outOfStockItem: RentalServiceItem = {
        id: 'item-2',
        name: 'Mechanical Keyboard',
        description: 'Cherry MX switches',
        hourlyRate: 30.0,
        dailyRate: null,
        totalInventory: 3,
        availableInventory: 0,
        inStock: false,
      };

      const outOfStockMarkup = renderToStaticMarkup(
        createElement(RentalServiceCard, { service: outOfStockItem })
      );

      expect(outOfStockMarkup).toContain('Currently Out of Stock');
      expect(outOfStockMarkup).toContain('bg-rose-50');
      expect(outOfStockMarkup).not.toContain('Available: 0 in stock');
    });

    it('MS89-TC04: Dual Rate Display for Rentals: renders hourly and optional daily pass pills', () => {
      // Both hourly and daily present
      const dualRateItem: RentalServiceItem = {
        id: 'dual-1',
        name: 'Noise Canceling Headset',
        description: 'Over-ear Bluetooth headset with mic',
        hourlyRate: 40.0,
        dailyRate: 180.0,
        totalInventory: 4,
        availableInventory: 2,
      };

      const dualMarkup = renderToStaticMarkup(
        createElement(RentalServiceCard, { service: dualRateItem })
      );

      expect(dualMarkup).toContain('PHP 40.00 / hr');
      expect(dualMarkup).toContain('PHP 180.00 / day (Full Day Pass)');

      // Only hourly present (dailyRate is null)
      const hourlyOnlyItem: RentalServiceItem = {
        id: 'hourly-1',
        name: 'USB-C Fast Charger',
        description: '65W GaN adapter with cable',
        hourlyRate: 15.0,
        dailyRate: null,
        totalInventory: 10,
        availableInventory: 8,
      };

      const hourlyMarkup = renderToStaticMarkup(
        createElement(RentalServiceCard, { service: hourlyOnlyItem })
      );

      expect(hourlyMarkup).toContain('PHP 15.00 / hr');
      expect(hourlyMarkup).not.toContain('(Full Day Pass)');
    });

    it('MS89-TC05: One-Time Details Formatting: parses details and omits hourly/daily rental pills', () => {
      const oneTimeItem: OneTimeServiceItem = {
        id: 'ot-1',
        name: 'Laser Printing & Document Scanning',
        description: 'Document reproduction on-demand',
        details: 'B&W Printing: PHP 2.00 per page (A4)\nFull-Color Printing: PHP 10.00 per page (A4)\nDocument Scanning: PHP 5.00 per batch',
        isActive: true,
      };

      const markup = renderToStaticMarkup(
        createElement(OneTimeServiceCard, { service: oneTimeItem })
      );

      // Verify formatted details rendered
      expect(markup).toContain('B&amp;W Printing: PHP 2.00 per page (A4)');
      expect(markup).toContain('Full-Color Printing: PHP 10.00 per page (A4)');
      expect(markup).toContain('Document Scanning: PHP 5.00 per batch');

      // Verify operational tags
      expect(markup).toContain('Informational Service - Inquire with Front Desk Staff');
      expect(markup).toContain('Payment and processing handled directly at the staff counter.');

      // Verify hourly and daily badges are omitted
      expect(markup).not.toContain('/ hr');
      expect(markup).not.toContain('/ day');
      expect(markup).not.toContain('Full Day Pass');
    });
  });

  describe('Part 3: On-Site Rental Guidance & Map Integration (MS89-TC06 - MS89-TC08)', () => {
    it('MS89-TC06: Four-Step Instructions Rendered: renders all 4 standardized operational steps in sequential order', () => {
      const markup = renderToStaticMarkup(createElement(RentalInstructionsCard));

      // Title & Subtitle
      expect(markup).toContain('How to Rent Equipment');
      expect(markup).toContain('Equipment rentals are managed on-site at the front desk for verified active bookings.');

      // Four steps
      expect(markup).toContain('Go to staff');
      expect(markup).toContain('Prepare your booking details');
      expect(markup).toContain('Ask staff for the desired item');
      expect(markup).toContain('Give valid ID to staff and pay');

      // Step badges 1, 2, 3, 4 present
      expect(markup).toContain('rental-step-1');
      expect(markup).toContain('rental-step-2');
      expect(markup).toContain('rental-step-3');
      expect(markup).toContain('rental-step-4');
    });

    it('MS89-TC07: Map Cross-Reference Action: renders map button linking to /reserve', () => {
      const markup = renderToStaticMarkup(createElement(RentalInstructionsCard));

      expect(markup).toContain('Locate Kiosk on Workspace Map');
      expect(markup).toContain('href="/reserve"');
      expect(markup).toContain('locate-kiosk-map-button');
    });

    it('MS89-TC08: Tracking Page Entry Banner: /track provides visible banner directing users to additional services', () => {
      const trackingFilePath = path.resolve(
        __dirname,
        '../apps/customer-website/src/features/tracking/components/TrackingPage.tsx'
      );
      const content = fs.readFileSync(trackingFilePath, 'utf-8');

      // Check banner link presence and target
      expect(content).toContain('services-guidance-banner');
      expect(content).toContain('href="/services"');
      expect(content).toContain('Need an external monitor, keyboard, or printing?');
      expect(content).toContain('View Additional Services & Equipment Rentals');
    });
  });

  describe('Part 4: Architectural Invariants & Layout (MS89-TC09 - MS89-TC10)', () => {
    it('MS89-TC09: Strict No-Hold Verification: viewing services does not mutate inventory or insert reservations', async () => {
      const created = await inMemoryRepo.createAdditionalService({
        name: 'Ergonomic Mouse',
        serviceType: 'rental',
        hourlyRate: 10.0,
        totalInventory: 4,
        isActive: true,
      });

      // Read via service
      const service = createAdditionalServiceService(inMemoryRepo);
      const listBefore = await service.listServices({ isActive: true });
      expect(listBefore[0].availableInventory).toBe(4);

      // Simulate customer browsing endpoint multiple times
      await GET();
      await GET();
      await GET();

      // Ensure inventory remains completely unchanged (No-Hold Rule)
      const listAfter = await service.listServices({ isActive: true });
      expect(listAfter[0].availableInventory).toBe(4);
      expect(listAfter[0].totalInventory).toBe(4);
    });

    it('MS89-TC10: Responsive Layout & Navigation Validation: services dashboard uses responsive grid and header links to /services', () => {
      const dashboardMarkup = renderToStaticMarkup(
        createElement(CustomerServicesDashboard, {
          initialRentals: [
            {
              id: 'r-1',
              name: 'External Monitor',
              description: 'HDMI cable included',
              hourlyRate: 50,
              dailyRate: 200,
              totalInventory: 3,
              availableInventory: 2,
            },
          ],
          initialOneTimeServices: [],
        })
      );

      // Grid classes: 1 col on mobile, 2 col on tablet, 3 col on desktop
      expect(dashboardMarkup).toContain('grid-cols-1 sm:grid-cols-2 lg:grid-cols-3');
      expect(dashboardMarkup).toContain('Equipment for Rent (1)');
      expect(dashboardMarkup).toContain('Business &amp; Print Services (0)');

      // Header component includes Services link
      const headerMarkup = renderToStaticMarkup(createElement(Header));
      expect(headerMarkup).toContain('href="/services"');
      expect(headerMarkup).toContain('Services');
      expect(headerMarkup).toContain('href="/reserve"');
      expect(headerMarkup).toContain('href="/track"');

      // Verify BAN-PUNCT-01: zero em-dashes across newly created files
      const servicesComponentDir = path.resolve(
        __dirname,
        '../apps/customer-website/src/features/services'
      );
      const files = fs.readdirSync(path.join(servicesComponentDir, 'components'));
      for (const file of files) {
        const fileContent = fs.readFileSync(path.join(servicesComponentDir, 'components', file), 'utf-8');
        expect(fileContent).not.toContain('\u2014'); // Em-dash
        expect(fileContent).not.toContain('\u2013'); // En-dash
      }
    });
  });
});
