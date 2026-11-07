/**
 * Script to trigger MS-103 transactional emails to Resend.
 *
 * Traceability: MS-103 (Transactional Email Template Accuracy and Canonical Deployment Links), PRD-F4, PRD-F15
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createTransactionalEmailService,
  CANONICAL_PRODUCTION_CUSTOMER_URL,
} from '../packages/domain/src';

function loadEnv(): void {
  const envFiles = [
    '.env.local',
    '.env',
    'apps/admin-portal/.env.local',
    'apps/customer-website/.env.local',
  ];

  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

async function main(): Promise<void> {
  loadEnv();

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'DeskAtlas <bookings@thedeskatlas.com>';

  if (!apiKey) {
    console.error('Error: RESEND_API_KEY is not defined in environment or .env.local');
    process.exit(1);
  }

  console.log('Using Resend sender identity:', fromEmail);

  const emailService = createTransactionalEmailService({
    apiKey,
    fromEmail,
  });

  // Target recipient provided by the user
  const primaryRecipient = 'reynard.john.rabanaml@gmail.com';
  // Include possible typo variation so the user definitely receives it
  const secondaryRecipient = 'reynard.john.rabanal@gmail.com';

  const recipients = [primaryRecipient];
  if (primaryRecipient !== secondaryRecipient) {
    recipients.push(secondaryRecipient);
  }

  console.log(`Sending MS-103 verification emails to: ${recipients.join(', ')}\n`);

  for (const to of recipients) {
    console.log(`=== Processing recipient: ${to} ===`);

    // 1. MS-103 Email 1: Voucher Email (Item 2 fix: Canonical Deployed Reserve CTA URL)
    console.log('1. Dispatching Voucher Email (MS-103 Item 2: Deployed CTA URL)...');
    const voucherResult = await emailService.sendVoucherEmail({
      to,
      customerFirstName: 'Reynard',
      customerLastName: 'Rabanal',
      promoCode: 'DA-MS103-PROMO',
      discountDescription: '100 PHP Off',
      campaignName: 'MS-103 Email Accuracy Verification',
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      customerAppUrl: CANONICAL_PRODUCTION_CUSTOMER_URL,
      instructions: 'Enter this promo code during booking on the customer website or kiosk.',
    });

    if (voucherResult.success) {
      console.log(`[SUCCESS] Voucher Email dispatched! Resend ID: ${voucherResult.id}`);
    } else {
      console.error(`[FAILURE] Voucher Email failed:`, voucherResult.error);
    }

    // 2. MS-103 Email 2: Voucher Awarded Email (MS-103 Loyalty Voucher Deployed CTA URL)
    console.log('\n2. Dispatching Voucher Awarded Email (MS-103 Loyalty Rewards URL)...');
    const voucherAwardedResult = await emailService.sendVoucherAwardedEmail({
      to,
      customerFirstName: 'Reynard',
      customerLastName: 'Rabanal',
      promoCode: 'DA-REWARD-103',
      discountDescription: '50 PHP Off Next Session',
      discountText: '50 PHP Off',
      campaignName: 'DeskAtlas Loyalty Rewards Tier',
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      customerAppUrl: CANONICAL_PRODUCTION_CUSTOMER_URL,
    });

    if (voucherAwardedResult.success) {
      console.log(`[SUCCESS] Voucher Awarded Email dispatched! Resend ID: ${voucherAwardedResult.id}`);
    } else {
      console.error(`[FAILURE] Voucher Awarded Email failed:`, voucherAwardedResult.error);
    }

    // 3. MS-103 Email 3: Reservation Status Email (Item 8 fix: Workspace Spot Names vs Spot #1)
    console.log('\n3. Dispatching Reservation Status Email (MS-103 Item 8: Accurate Spot Names)...');
    const trackingResult = await emailService.sendReservationTrackingEmail({
      to,
      customerFirstName: 'Reynard',
      customerLastName: 'Rabanal',
      referenceCode: 'DA-20261107-MS103',
      trackingUrl: `${CANONICAL_PRODUCTION_CUSTOMER_URL}/track?code=DA-20261107-MS103`,
      status: 'PENDING_PAYMENT',
      candidates: [
        {
          rank: 0,
          workspaceDisplayName: 'Power Bar 04',
          workspaceTemplateName: 'Dedicated Desk',
          floorName: '2nd Floor',
          startAt: '2026-11-10T01:00:00.000Z', // 9:00 AM Manila
          endAt: '2026-11-10T09:00:00.000Z',   // 5:00 PM Manila
        },
        {
          rank: 1,
          workspaceDisplayName: 'Focus Pod 02',
          workspaceTemplateName: 'Focus Pod',
          floorName: '2nd Floor',
          startAt: '2026-11-10T01:00:00.000Z',
          endAt: '2026-11-10T09:00:00.000Z',
        },
        {
          rank: 2,
          workspaceDisplayName: 'Hot Desk 12',
          workspaceTemplateName: 'Flexible Desk',
          floorName: 'Ground Floor',
          startAt: '2026-11-10T01:00:00.000Z',
          endAt: '2026-11-10T09:00:00.000Z',
        },
      ],
    });

    if (trackingResult.success) {
      console.log(`[SUCCESS] Reservation Status Email dispatched! Resend ID: ${trackingResult.id}`);
    } else {
      console.error(`[FAILURE] Reservation Status Email failed:`, trackingResult.error);
    }

    console.log('');
  }

  console.log('All MS-103 verification emails processed.');
}

main().catch((err: unknown) => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});
