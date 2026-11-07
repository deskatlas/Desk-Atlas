import { describe, it, expect } from 'vitest';
import {
  renderVoucherEmail,
  renderVoucherAwardedEmail,
  renderReservationTrackingEmail,
  resolveCustomerAppBaseUrl,
  ReservationMemoryRepository,
  ReservationSupabaseRepository,
  InMemoryWorkspaceRepository,
  CANONICAL_PRODUCTION_CUSTOMER_URL,
} from '@deskatlas/domain';

describe('MS-103: Transactional Email Template Accuracy and Canonical Deployment Links', () => {
  describe('MS103-TC01: Voucher Email Deployed URL Resolution and Localhost Sanitization', () => {
    it('sanitizes localhost in production environment and falls back to canonical production URL', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const profileWithLocalhost = {
          appUrl: 'http://localhost:3000',
          businessName: 'DeskAtlas Test',
        };

        const resolvedBase = resolveCustomerAppBaseUrl(profileWithLocalhost);
        expect(resolvedBase).toBe(CANONICAL_PRODUCTION_CUSTOMER_URL);

        const email = renderVoucherEmail({
          to: 'customer@example.com',
          promoCode: 'TEST100',
          discountDescription: '100 PHP Off',
          campaignName: 'Summer Launch',
          expiresAt: '2026-12-31T23:59:59.000Z',
          businessSettings: profileWithLocalhost,
        });

        expect(email.html).toContain(`href="${CANONICAL_PRODUCTION_CUSTOMER_URL}/reserve"`);
        expect(email.text).toContain(`${CANONICAL_PRODUCTION_CUSTOMER_URL}/reserve`);
        expect(email.html).not.toContain('localhost');
        expect(email.text).not.toContain('localhost');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('sanitizes localhost for voucher awarded email in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const email = renderVoucherAwardedEmail({
          to: 'customer@example.com',
          promoCode: 'REWARD50',
          discountDescription: '50 PHP Off',
          campaignName: 'Loyalty Rewards',
          expiresAt: '2026-12-31T23:59:59.000Z',
          businessSettings: { appUrl: 'http://localhost:3001' },
        });

        expect(email.html).toContain(`href="${CANONICAL_PRODUCTION_CUSTOMER_URL}/reserve"`);
        expect(email.html).toContain(`href="${CANONICAL_PRODUCTION_CUSTOMER_URL}/track/rewards"`);
        expect(email.html).not.toContain('localhost');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('MS103-TC02: Voucher Email Honors Explicit Custom App URL and Reserve URL', () => {
    it('uses explicit customerAppUrl when provided in VoucherEmailInput', () => {
      const customOrigin = 'https://staging.thedeskatlas.com';
      const email = renderVoucherEmail({
        to: 'customer@example.com',
        promoCode: 'STAGING20',
        discountDescription: '20% Off',
        campaignName: 'Staging Test',
        expiresAt: '2026-12-31T23:59:59.000Z',
        customerAppUrl: customOrigin,
      });

      expect(email.html).toContain(`href="${customOrigin}/reserve"`);
      expect(email.text).toContain(`${customOrigin}/reserve`);
    });

    it('uses explicit reserveUrl when provided in VoucherEmailInput', () => {
      const customReserveUrl = 'https://custom.deskatlas.com/special-booking';
      const email = renderVoucherEmail({
        to: 'customer@example.com',
        promoCode: 'DIRECT50',
        discountDescription: '50 PHP Off',
        campaignName: 'Direct Booking',
        expiresAt: '2026-12-31T23:59:59.000Z',
        reserveUrl: customReserveUrl,
      });

      expect(email.html).toContain(`href="${customReserveUrl}"`);
      expect(email.text).toContain(customReserveUrl);
    });
  });

  describe('MS103-TC03: Reservation Creation Hydrates Candidate Display Details', () => {
    it('populates workspaceDisplayName, workspaceTemplateName, and floorName in ReservationSupabaseRepository', async () => {
      const repo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://synthetic.deskatlas.test',
        serviceRoleKey: 'test-service-key',
      });

      const reservationId = 'res-uuid-103';
      const instanceId1 = 'inst-01';
      const instanceId2 = 'inst-02';

      (repo as unknown as { request: (path: string, options?: unknown) => Promise<unknown> }).request = async (path: string) => {
        if (path.includes('/rpc/create_web_reservation_with_payment_session')) {
          return [{ id: reservationId }];
        }
        if (path.startsWith('/reservations?id=eq.')) {
          return [];
        }
        if (path.startsWith('/reservation_candidates?select=*&reservation_id=eq.')) {
          return [
            {
              id: 'cand-1',
              reservation_id: reservationId,
              rank: 0,
              workspace_instance_id: instanceId1,
              start_at: '2026-11-10T09:00:00.000Z',
              end_at: '2026-11-10T17:00:00.000Z',
              is_assigned: false,
            },
            {
              id: 'cand-2',
              reservation_id: reservationId,
              rank: 1,
              workspace_instance_id: instanceId2,
              start_at: '2026-11-10T09:00:00.000Z',
              end_at: '2026-11-10T17:00:00.000Z',
              is_assigned: false,
            },
          ];
        }
        if (path.startsWith('/workspace_instances?select=*&id=in.')) {
          return [
            {
              id: instanceId1,
              template_id: 'tmpl-bar',
              floor_id: 'floor-2',
              display_name: 'Power Bar 04',
              instance_code: 'PB-04',
            },
            {
              id: instanceId2,
              template_id: 'tmpl-desk',
              floor_id: 'floor-2',
              display_name: 'Focus Pod 02',
              instance_code: 'FP-02',
            },
          ];
        }
        if (path.startsWith('/workspace_templates?select=*')) {
          return [
            { id: 'tmpl-bar', name: 'Dedicated Desk' },
            { id: 'tmpl-desk', name: 'Focus Pod' },
          ];
        }
        if (path.startsWith('/floors?select=*')) {
          return [
            { id: 'floor-2', name: '2nd Floor' },
          ];
        }
        if (path.startsWith('/reservations?select=*&id=eq.')) {
          return [
            {
              id: reservationId,
              reference_code: 'DA-20261110-MS103',
              source: 'WEB',
              customer_first_name: 'Juan',
              customer_last_name: 'Dela Cruz',
              customer_email: 'juan@example.com',
              status: 'PENDING_PAYMENT',
              rate_snapshot: 150,
              gross_amount_due: 300,
              discount_amount: 0,
              amount_due: 300,
              currency: 'PHP',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];
        }
        return [];
      };

      const result = await repo.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Juan',
          customerLastName: 'Dela Cruz',
          customerEmail: 'juan@example.com',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: instanceId1,
              startAt: '2026-11-10T09:00:00.000Z',
              endAt: '2026-11-10T17:00:00.000Z',
            },
            {
              rank: 1,
              workspaceInstanceId: instanceId2,
              startAt: '2026-11-10T09:00:00.000Z',
              endAt: '2026-11-10T17:00:00.000Z',
            },
          ],
        },
        150,
        300,
        {
          tokenHash: 'sample-token-hash',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }
      );

      expect(result.candidates).toBeDefined();
      expect(result.candidates?.length).toBe(2);

      const mainSpot = result.candidates![0];
      expect(mainSpot.rank).toBe(0);
      expect(mainSpot.workspaceDisplayName).toBe('Power Bar 04');
      expect(mainSpot.workspaceTemplateName).toBe('Dedicated Desk');
      expect(mainSpot.floorName).toBe('2nd Floor');

      const altSpot = result.candidates![1];
      expect(altSpot.rank).toBe(1);
      expect(altSpot.workspaceDisplayName).toBe('Focus Pod 02');
      expect(altSpot.workspaceTemplateName).toBe('Focus Pod');
      expect(altSpot.floorName).toBe('2nd Floor');
    });

    it('populates candidate details in ReservationMemoryRepository when workspaceRepo is attached', async () => {
      const memoryRepo = new ReservationMemoryRepository();
      const workspaceRepo = new InMemoryWorkspaceRepository();
      memoryRepo.setWorkspaceRepository(workspaceRepo);

      const floor = await workspaceRepo.createFloor({ name: 'Mezzanine Level' });
      const tmpl = await workspaceRepo.createTemplate({
        name: 'Private Suite',
        capacity: 1,
        rateAmount: 250,
        pricingUnit: 'HOURLY',
      });
      const inst = await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: tmpl.id,
        instanceCode: 'PS-10',
        displayName: 'Private Suite 10',
      });

      const res = await memoryRepo.createReservation(
        {
          source: 'WEB',
          customerFirstName: 'Maria',
          customerLastName: 'Clara',
          customerEmail: 'maria@example.com',
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: inst.id,
              startAt: '2026-11-10T10:00:00.000Z',
              endAt: '2026-11-10T12:00:00.000Z',
            },
          ],
        },
        250,
        500
      );

      expect(res.candidates).toBeDefined();
      expect(res.candidates?.length).toBe(1);
      expect(res.candidates![0].workspaceDisplayName).toBe('Private Suite 10');
      expect(res.candidates![0].workspaceTemplateName).toBe('Private Suite');
      expect(res.candidates![0].floorName).toBe('Mezzanine Level');
    });
  });

  describe('MS103-TC04: Reservation Status Email Displays Main Spot Name', () => {
    it('displays the actual workspace name and template in Main Spot row instead of Spot #1', () => {
      const email = renderReservationTrackingEmail({
        referenceCode: 'DA-20261110-STAT1',
        trackingUrl: 'https://deskatlas.com/track?code=DA-20261110-STAT1',
        customerFirstName: 'Reynard',
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: 'Power Bar 04',
            workspaceTemplateName: 'Dedicated Desk',
            floorName: '2nd Floor',
            startAt: '2026-11-10T01:00:00.000Z', // 09:00 AM Manila
            endAt: '2026-11-10T09:00:00.000Z',   // 05:00 PM Manila
          },
        ],
      });

      expect(email.html).toContain('Main Spot');
      expect(email.html).toContain('Power Bar 04');
      expect(email.html).toContain('(Dedicated Desk)');
      expect(email.html).toContain('2nd Floor');
      expect(email.html).not.toContain('Spot #1');
    });
  });

  describe('MS103-TC05: Multi-Candidate Tier Formatting in Reservation Status Email', () => {
    it('renders Main Spot and Backup Choices with accurate names and formatting', () => {
      const email = renderReservationTrackingEmail({
        referenceCode: 'DA-20261110-TIERS',
        trackingUrl: 'https://deskatlas.com/track?code=DA-20261110-TIERS',
        customerFirstName: 'Clara',
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: 'Power Bar 04',
            workspaceTemplateName: 'Dedicated Desk',
            floorName: '2nd Floor',
            startAt: '09:00',
            endAt: '17:00',
          },
          {
            rank: 1,
            workspaceDisplayName: 'Focus Pod 02',
            workspaceTemplateName: 'Focus Pod',
            floorName: '2nd Floor',
            startAt: '09:00',
            endAt: '17:00',
          },
          {
            rank: 2,
            workspaceDisplayName: 'Hot Desk 12',
            workspaceTemplateName: 'Flexible Desk',
            floorName: '1st Floor',
            startAt: '09:00',
            endAt: '17:00',
          },
        ],
      });

      // Assert ranks
      expect(email.html).toContain('Main Spot');
      expect(email.html).toContain('Backup Choice 1');
      expect(email.html).toContain('Backup Choice 2');

      // Assert spot names
      expect(email.html).toContain('Power Bar 04');
      expect(email.html).toContain('Focus Pod 02');
      expect(email.html).toContain('Hot Desk 12');

      // Assert no redundant duplicate template name when displayName equals templateName
      expect(email.html).not.toContain('Focus Pod 02 (Focus Pod 02)');
      expect(email.html).not.toContain('Spot #1');
      expect(email.html).not.toContain('Spot #2');
      expect(email.html).not.toContain('Spot #3');
    });
  });

  describe('MS103-TC06: Plain Text Fallback Consistency', () => {
    it('renders human-readable spot names in plain-text email matching HTML table', () => {
      const email = renderReservationTrackingEmail({
        referenceCode: 'DA-20261110-TEXT1',
        trackingUrl: 'https://deskatlas.com/track?code=DA-20261110-TEXT1',
        customerFirstName: 'Juan',
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: 'Power Bar 04',
            workspaceTemplateName: 'Dedicated Desk',
            floorName: '2nd Floor',
            startAt: '2026-11-10T01:00:00.000Z', // 09:00 AM Manila
            endAt: '2026-11-10T09:00:00.000Z',   // 05:00 PM Manila
          },
          {
            rank: 1,
            workspaceDisplayName: 'Flex Desk 08',
            workspaceTemplateName: 'Hot Desk',
            floorName: 'Ground Floor',
            startAt: '2026-11-10T01:00:00.000Z',
            endAt: '2026-11-10T09:00:00.000Z',
          },
        ],
      });

      expect(email.text).toContain('- Main Spot: Power Bar 04 (Dedicated Desk) - 2nd Floor (9:00 AM to 5:00 PM)');
      expect(email.text).toContain('- Backup Choice 1: Flex Desk 08 (Hot Desk) - Ground Floor (9:00 AM to 5:00 PM)');
      expect(email.text).not.toContain('Spot #1');
      expect(email.text).not.toContain('Option 1');
    });
  });

  describe('MS103-TC07: Zero Em-Dash Documentation and Email Copy Invariant (BAN-PUNCT-01)', () => {
    it('verifies absence of em-dash and en-dash in all rendered templates', () => {
      const voucherEmail = renderVoucherEmail({
        to: 'customer@example.com',
        promoCode: 'CLEANPUNCT',
        discountDescription: '15% Off Any Desk',
        campaignName: 'Punctuation Audit',
        expiresAt: '2026-12-31T23:59:59.000Z',
      });

      const trackingEmail = renderReservationTrackingEmail({
        referenceCode: 'DA-20261110-PUNCT',
        trackingUrl: 'https://deskatlas.com/track?code=DA-20261110-PUNCT',
        customerFirstName: 'Audit',
        candidates: [
          {
            rank: 0,
            workspaceDisplayName: 'Desk A',
            workspaceTemplateName: 'Dedicated Desk',
            floorName: 'Floor 1',
            startAt: '09:00',
            endAt: '17:00',
          },
        ],
      });

      const dashRegex = /[\u2014\u2013]/; // Unicode em-dash and en-dash characters
      expect(voucherEmail.subject).not.toMatch(dashRegex);
      expect(voucherEmail.html).not.toMatch(dashRegex);
      expect(voucherEmail.text).not.toMatch(dashRegex);

      expect(trackingEmail.subject).not.toMatch(dashRegex);
      expect(trackingEmail.html).not.toMatch(dashRegex);
      expect(trackingEmail.text).not.toMatch(dashRegex);
    });
  });
});

