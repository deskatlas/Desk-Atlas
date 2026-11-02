import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createStaffOperationsService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  renderReservationRelocatedEmail,
  renderReservationRelocationRequestedEmail,
  renderReservationRelocationDeclinedEmail,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';

describe('MS-100: Customer Reservation Reallocation Transactional Email Notifications', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: Array<{ url: string; body: any }> = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-11-02T06:00:00.000Z'); // 2:00 PM Manila
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: '2nd Floor Coworking' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Hot Desk',
      capacity: 1,
      rateAmount: 180,
      pricingUnit: 'HOURLY',
    });

    for (let i = 1; i <= 6; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: deskTemplate.id,
        instanceCode: `desk-${i}`,
        displayName: `Desk 0${i}`,
        operationalStatus: 'ACTIVE',
      });
    }

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url: String(url), body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(options: {
    refCodeSuffix: string;
    spotIndexOrId?: number | string;
    startHour?: number;
    duration?: number;
    checkIn?: boolean;
    customerEmail?: string;
  }) {
    const catalog = await workspaceRepo.listCatalog();
    const instance =
      typeof options.spotIndexOrId === 'number'
        ? catalog.instances[options.spotIndexOrId - 1]
        : catalog.instances.find((i) => i.id === options.spotIndexOrId) ||
          catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startHour = options.startHour ?? 14;
    const duration = options.duration ?? 4;

    const startAt = zonedDateTimeToUtc(
      '2026-11-02',
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      '2026-11-02',
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Samantha',
        customerLastName: 'Cruz',
        customerEmail: options.customerEmail !== undefined ? options.customerEmail : `samantha.${options.refCodeSuffix}@example.com`,
        candidates: [
          {
            rank: 0,
            workspaceInstanceId: instance.id,
            startAt,
            endAt,
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

    await paymentReviewService.reviewPayment({
      paymentAttemptId: res.paymentSession!.paymentAttemptId,
      actor: {
        userId: 'admin-1',
        role: 'ADMIN',
      },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      'https://deskatlas.test/access'
    );

    if (options.checkIn) {
      now = new Date(startAt);
      const staffService = createStaffOperationsService(repo, nowProvider);
      await staffService.checkInReservation({
        reservationId: res.id,
        actor: {
          userId: 'staff-1',
          role: 'STAFF',
        },
      });
    }

    const confirmed = await repo.getAdminReservationDetail(res.id);
    return confirmed!;
  }

  // MS100-TC01: Admin Relocate Email Dispatch
  it('MS100-TC01: Admin relocate dispatches email with customer email, reference code, old spot, and new spot', async () => {
    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc01',
      spotIndexOrId: 1, // Desk 01
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 02')!;

    const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
    const result = await adminService.relocateReservation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk2.id,
      reason: 'Physical Desk Maintenance',
      notes: 'Power outlet repair needed at Desk 01',
      actorRole: 'ADMIN',
      actorUserId: 'admin-1',
    });

    expect(result.success).toBe(true);
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.to).toContain(res.customerEmail);
    expect(sent.subject).toContain(res.referenceCode);
    expect(sent.subject).toContain('Administration');
    expect(sent.html).toContain('Desk 01');
    expect(sent.html).toContain('Desk 02');
    expect(sent.html).toContain('Physical Desk Maintenance');
  });

  // MS100-TC02: Staff Relocate Email Integration
  it('MS100-TC02: Staff relocate receives email service and dispatches front-desk notification', async () => {
    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc02',
      spotIndexOrId: 2, // Desk 02
      checkIn: true,
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk3 = catalog.instances.find((i) => i.displayName === 'Desk 03')!;

    const staffService = createStaffOperationsService(repo, nowProvider, mockEmailService);
    const result = await staffService.relocateReservation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk3.id,
      reason: 'Customer In-Person Request',
      notes: 'Requested quieter corner spot',
      actorRole: 'STAFF',
      actorUserId: 'staff-1',
    });

    expect(result.success).toBe(true);
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.to).toContain(res.customerEmail);
    expect(sent.subject).toContain(res.referenceCode);
    expect(sent.subject).toContain('Front-Desk Staff');
    expect(sent.html).toContain('Desk 02');
    expect(sent.html).toContain('Desk 03');
    expect(sent.html).toContain('Customer In-Person Request');
  });

  // MS100-TC03: Customer Relocation Request Acknowledgment
  it('MS100-TC03: sendReservationRelocationRequestedEmail sends acknowledgment with comparison table and secured status', async () => {
    const result = await mockEmailService.sendReservationRelocationRequestedEmail({
      to: 'customer@example.com',
      customerFirstName: 'Samantha',
      customerLastName: 'Cruz',
      referenceCode: 'DA-2026-TC03',
      currentWorkspaceDisplayName: 'Desk 01',
      requestedWorkspaceDisplayName: 'Desk 05',
      requestedFloorName: '2nd Floor Coworking',
      relocationReason: 'Too close to doorway',
      relocationNotes: 'Seeking quieter study zone',
      trackingUrl: 'https://deskatlas.test/track/DA-2026-TC03',
    });

    expect(result.success).toBe(true);
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.to).toContain('customer@example.com');
    expect(sent.subject).toContain('Spot Relocation Request Received');
    expect(sent.subject).toContain('DA-2026-TC03');
    expect(sent.html).toContain('Desk 01');
    expect(sent.html).toContain('Desk 05');
    expect(sent.html).toContain('Pending Review by Staff');
    expect(sent.html).toContain('Your current spot assignment (Desk 01) remains confirmed and secured');
    expect(sent.html).toContain('https://deskatlas.test/track/DA-2026-TC03');
  });

  // MS100-TC04: Admin Decision Approve Email Dispatch
  it('MS100-TC04: Admin approve decision dispatches email with accurate previous spot and customer attribution', async () => {
    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc04',
      spotIndexOrId: 1, // Desk 01
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk4 = catalog.instances.find((i) => i.displayName === 'Desk 04')!;

    // Customer requests relocation
    await repo.requestCustomerRelocation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk4.id,
      reason: 'Glare on monitor screen',
      notes: 'Moved away from window',
    });

    const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
    const decisionResult = await adminService.decideCustomerRelocation({
      reservationId: res.id,
      decision: 'APPROVE',
      notes: 'Approved by desk manager',
      actorRole: 'ADMIN',
      actorUserId: 'admin-1',
    });

    expect(decisionResult.success).toBe(true);
    expect(decisionResult.decision).toBe('APPROVE');
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.to).toContain(res.customerEmail);
    expect(sent.subject).toContain('Relocation is Confirmed');
    expect(sent.html).toContain('Spot Relocation Confirmed');
    expect(sent.html).toContain('Desk 01'); // Original spot, NOT "Previous Spot"
    expect(sent.html).toContain('Desk 04'); // Target new spot
    expect(sent.html).toContain('Digital QR Pass Continuity');
  });

  // MS100-TC05: Admin Decision Decline Email Dispatch
  it('MS100-TC05: Admin decline decision dispatches email with reason note and original spot reassurance', async () => {
    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc05',
      spotIndexOrId: 2, // Desk 02
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk5 = catalog.instances.find((i) => i.displayName === 'Desk 05')!;

    // Customer requests relocation
    await repo.requestCustomerRelocation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk5.id,
      reason: 'Want spot next to colleague',
    });

    const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
    const decisionResult = await adminService.decideCustomerRelocation({
      reservationId: res.id,
      decision: 'DECLINE',
      notes: 'Target desk is currently reserved for a team booking',
      actorRole: 'ADMIN',
      actorUserId: 'admin-1',
    });

    expect(decisionResult.success).toBe(true);
    expect(decisionResult.decision).toBe('DECLINE');
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.to).toContain(res.customerEmail);
    expect(sent.subject).toContain('Spot Relocation Request');
    expect(sent.html).toContain('Spot Relocation Request Update');
    expect(sent.html).toContain('Desk 05');
    expect(sent.html).toContain('Target desk is currently reserved for a team booking');
    expect(sent.html).toContain('Desk 02');
    expect(sent.html).toContain('remains fully confirmed and active');
  });

  // MS100-TC06: Initiator Attribution in Email Body
  it('MS100-TC06: Dynamic subjects and titles reflect initiator roles correctly', () => {
    const baseInput = {
      to: 'customer@example.com',
      referenceCode: 'DA-REF-ATTR',
      oldWorkspaceDisplayName: 'Desk 01',
      newWorkspaceDisplayName: 'Desk 02',
      schedule: 'Nov 02, 2026, 14:00 - 18:00',
      relocationReason: 'Operational Need',
    };

    // Customer initiated
    const custRendered = renderReservationRelocatedEmail({
      ...baseInput,
      initiatedBy: 'CUSTOMER',
    });
    expect(custRendered.subject).toContain('Relocation is Confirmed');
    expect(custRendered.html).toContain('Spot Relocation Confirmed');
    expect(custRendered.html).toContain('You have successfully relocated your workspace reservation');

    // Admin initiated
    const adminRendered = renderReservationRelocatedEmail({
      ...baseInput,
      initiatedBy: 'ADMIN',
    });
    expect(adminRendered.subject).toContain('Relocated by Administration');
    expect(adminRendered.html).toContain('relocated to a new conflict-free spot by DeskAtlas Administration');

    // Staff initiated
    const staffRendered = renderReservationRelocatedEmail({
      ...baseInput,
      initiatedBy: 'STAFF',
    });
    expect(staffRendered.subject).toContain('Relocated by Front-Desk Staff');
    expect(staffRendered.html).toContain('Front-Desk Spot Relocation Notice');
    expect(staffRendered.html).toContain('relocated to a new spot by our front-desk team');

    // Default fallback (when actor is omitted)
    const defaultRendered = renderReservationRelocatedEmail(baseInput);
    expect(defaultRendered.subject).toBe('Your DeskAtlas Reservation Spot Has Been Relocated [DA-REF-ATTR]');
    expect(defaultRendered.html).toContain('Workspace Spot Relocation Notice');
  });

  // MS100-TC07: Digital QR Pass Continuity Guarantee
  it('MS100-TC07: Rendered email HTML contains explicit Digital QR Pass Continuity banner', () => {
    const rendered = renderReservationRelocatedEmail({
      to: 'customer@example.com',
      referenceCode: 'DA-QR-PASS',
      oldWorkspaceDisplayName: 'Desk 01',
      newWorkspaceDisplayName: 'Desk 02',
      schedule: 'Nov 02, 2026, 14:00 - 18:00',
      relocationReason: 'Routine Maintenance',
    });

    expect(rendered.html).toContain('Digital QR Pass Continuity:');
    expect(rendered.html).toContain(
      'Your existing digital QR pass and check-in link remain active and valid for your newly relocated spot. No new pass is required.'
    );
    expect(rendered.text).toContain('Digital QR Pass Continuity:');
    expect(rendered.text).toContain('Your existing digital QR pass remains active and valid');
  });

  // MS100-TC08: Non-Blocking Email Error Resilience
  it('MS100-TC08: Relocation succeeds even if email dispatch fails', async () => {
    const failingEmailService = new TransactionalEmailService({
      apiKey: 'test-key',
      fetcher: async () => {
        throw new Error('Resend network timeout error');
      },
    });

    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc08',
      spotIndexOrId: 1,
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk2 = catalog.instances.find((i) => i.displayName === 'Desk 02')!;

    const adminService = createAdminReservationService(repo, nowProvider, failingEmailService);
    const result = await adminService.relocateReservation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk2.id,
      reason: 'Spot Inactive',
      actorRole: 'ADMIN',
    });

    expect(result.success).toBe(true);
    expect(result.newWorkspaceDisplayName).toBe('Desk 02');
  });

  // MS100-TC09: Accurate Spot Name Resolution
  it('MS100-TC09: oldWorkspaceDisplayName is never sent as "Previous Spot" when original spot facts exist', async () => {
    const res = await createConfirmedReservation({
      refCodeSuffix: 'tc09',
      spotIndexOrId: 3, // Desk 03
    });

    const catalog = await workspaceRepo.listCatalog();
    const desk6 = catalog.instances.find((i) => i.displayName === 'Desk 06')!;

    await repo.requestCustomerRelocation({
      reservationId: res.id,
      targetWorkspaceInstanceId: desk6.id,
      reason: 'Closer to power outlet',
    });

    const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
    const result = await adminService.decideCustomerRelocation({
      reservationId: res.id,
      decision: 'APPROVE',
      actorRole: 'ADMIN',
    });

    expect(result.success).toBe(true);
    expect(sentEmails.length).toBe(1);

    const sent = sentEmails[0].body;
    expect(sent.html).toContain('Desk 03');
    expect(sent.html).toContain('Desk 06');
    expect(sent.html).not.toContain('Previous Spot: Previous Spot');
    expect(sent.html).not.toContain('<strong>Previous Spot:</strong> Previous Spot');
  });

  // MS100-TC10: Zero Em-Dash Formatting Invariant
  it('MS100-TC10: Zero em-dashes exist across all rendered relocation email templates', () => {
    const relocateEmail = renderReservationRelocatedEmail({
      to: 'customer@example.com',
      referenceCode: 'DA-CHECK-DASH',
      oldWorkspaceDisplayName: 'Desk 01',
      newWorkspaceDisplayName: 'Desk 02',
      schedule: 'Nov 02, 2026, 14:00 - 18:00',
      relocationReason: 'Routine Maintenance',
      relocationNotes: 'Air filter cleaning',
      initiatedBy: 'ADMIN',
    });

    const requestEmail = renderReservationRelocationRequestedEmail({
      to: 'customer@example.com',
      referenceCode: 'DA-CHECK-DASH',
      currentWorkspaceDisplayName: 'Desk 01',
      requestedWorkspaceDisplayName: 'Desk 02',
      relocationReason: 'Air condition too cold',
      relocationNotes: 'Prefer warmer zone',
      trackingUrl: 'https://deskatlas.test/track/DA-CHECK-DASH',
    });

    const declineEmail = renderReservationRelocationDeclinedEmail({
      to: 'customer@example.com',
      referenceCode: 'DA-CHECK-DASH',
      currentWorkspaceDisplayName: 'Desk 01',
      requestedWorkspaceDisplayName: 'Desk 02',
      declineReason: 'Desk is reserved for event',
      trackingUrl: 'https://deskatlas.test/track/DA-CHECK-DASH',
    });

    const allContent = [
      relocateEmail.subject,
      relocateEmail.html,
      relocateEmail.text,
      requestEmail.subject,
      requestEmail.html,
      requestEmail.text,
      declineEmail.subject,
      declineEmail.html,
      declineEmail.text,
    ].join('\n');

    const emDashRegex = /[\u2014\u2013]/g;
    const matches = allContent.match(emDashRegex);
    expect(matches).toBeNull();
  });
});
