import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReservationMemoryRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  renderReservationRelocatedEmail,
  zonedDateTimeToUtc,
  ReservationSupabaseRepository,
} from '@deskatlas/domain';

describe('MF-124: Admin Reservation Relocation for Sudden Maintenance or Spot Inactivity', () => {
  let repo: ReservationMemoryRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let sentEmails: any[] = [];
  let mockEmailService: TransactionalEmailService;
  let now: Date;

  const nowProvider = () => now;

  beforeEach(async () => {
    now = new Date('2026-09-18T08:00:00+08:00');
    sentEmails = [];
    repo = new ReservationMemoryRepository(nowProvider);
    workspaceRepo = new InMemoryWorkspaceRepository();
    repo.setWorkspaceRepository(workspaceRepo);

    const floor = await workspaceRepo.createFloor({ name: 'Ground Floor' });
    const deskTemplate = await workspaceRepo.createTemplate({
      name: 'Dedicated Desk',
      capacity: 1,
      rateAmount: 150,
      pricingUnit: 'HOURLY',
    });
    const officeTemplate = await workspaceRepo.createTemplate({
      name: 'Private Office',
      capacity: 4,
      rateAmount: 500,
      pricingUnit: 'HOURLY',
    });

    // Create 4 Dedicated Desk instances
    for (let i = 1; i <= 4; i++) {
      await workspaceRepo.createInstance({
        floorId: floor.id,
        templateId: deskTemplate.id,
        instanceCode: `desk-${i}`,
        displayName: `Desk ${i}`,
        operationalStatus: 'ACTIVE',
      });
    }

    // Create 1 Private Office instance
    await workspaceRepo.createInstance({
      floorId: floor.id,
      templateId: officeTemplate.id,
      instanceCode: `office-1`,
      displayName: `Private Office 1`,
      operationalStatus: 'ACTIVE',
    });

    mockEmailService = new TransactionalEmailService({
      apiKey: 'test-resend-api-key',
      fetcher: async (url, init) => {
        const body = JSON.parse((init?.body as string) || '{}');
        sentEmails.push({ url, body });
        return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
      },
    });
  });

  async function createConfirmedReservation(
    refCodeSuffix: string,
    spotCode = 'desk-1',
    startHour = 14,
    duration = 4
  ) {
    const catalog = await workspaceRepo.listCatalog();
    const instance = catalog.instances.find(
      (i) => i.instanceCode === spotCode || i.id === spotCode
    ) || catalog.instances[0];

    const paymentSessionService = createPaymentSessionService(repo, nowProvider);
    const reservationService = createReservationService(repo, workspaceRepo, repo, paymentSessionService);
    const paymentReviewService = createPaymentReviewService(repo, nowProvider);

    const startAt = zonedDateTimeToUtc(
      '2026-09-18',
      `${String(startHour).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();
    const endAt = zonedDateTimeToUtc(
      '2026-09-18',
      `${String(startHour + duration).padStart(2, '0')}:00`,
      'Asia/Manila'
    ).toISOString();

    const res = await reservationService.createReservation(
      {
        source: 'WEB',
        customerFirstName: 'Alex',
        customerLastName: 'Rivera',
        customerEmail: `alex.rivera.${refCodeSuffix}@example.com`,
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
      actor: { role: 'ADMIN', userId: 'admin-user-1' },
      decision: 'APPROVE',
    });

    const bookingAccessService = createBookingAccessService(repo, nowProvider);
    await bookingAccessService.issueBookingAccess(
      res.id,
      res.referenceCode,
      'https://deskatlas.test/access'
    );

    return res;
  }

  describe('Listing Available Relocation Spots', () => {
    it('returns only conflict-free sibling spots of the exact same template tier', async () => {
      // Reservation on desk-1 for 2:00 PM - 6:00 PM (14:00 - 18:00)
      const res1 = await createConfirmedReservation('reloc-avail-1', 'desk-1', 14, 4);
      // Reservation on desk-2 for 3:00 PM - 5:00 PM (15:00 - 17:00) -> overlaps!
      await createConfirmedReservation('reloc-avail-2', 'desk-2', 15, 2);

      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.instanceCode === 'desk-3')!;
      const desk4 = catalog.instances.find((i) => i.instanceCode === 'desk-4')!;

      // Mark desk-4 as MAINTENANCE
      await workspaceRepo.updateInstance(desk4.id, { operationalStatus: 'MAINTENANCE' });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const spots = await adminService.listAvailableRelocationSpots(res1.id);

      // Sibling spots should only be desk-3 (desk-1 is current, desk-2 has overlapping booking, desk-4 is MAINTENANCE, office-1 is different template)
      expect(spots.length).toBe(1);
      expect(spots[0].id).toBe(desk3.id);
      expect(spots[0].displayName).toBe('Desk 3');
      expect(spots[0].floorName).toBe('Ground Floor');
    });

    it('returns an empty list when all sibling spots are occupied or in maintenance', async () => {
      // Reservation on desk-1 for 2:00 PM - 6:00 PM
      const res1 = await createConfirmedReservation('no-avail-1', 'desk-1', 14, 4);

      // Book desk-2 and desk-3 for overlapping times
      await createConfirmedReservation('no-avail-2', 'desk-2', 14, 4);
      await createConfirmedReservation('no-avail-3', 'desk-3', 14, 4);

      // Set desk-4 to INACTIVE
      const catalog = await workspaceRepo.listCatalog();
      const desk4 = catalog.instances.find((i) => i.instanceCode === 'desk-4')!;
      await workspaceRepo.updateInstance(desk4.id, { operationalStatus: 'INACTIVE' });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      const spots = await adminService.listAvailableRelocationSpots(res1.id);

      expect(spots).toEqual([]);
    });
  });

  describe('Relocate Reservation Execution', () => {
    it('relocates confirmed reservation, preserves schedule & duration, updates candidate, logs timeline & audit, and dispatches email', async () => {
      // res on desk-1 (2:00 PM - 6:00 PM)
      const res = await createConfirmedReservation('reloc-exec-1', 'desk-1', 14, 4);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      const result = await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Spot Maintenance / Repairs',
        notes: 'AC leak above desk 1',
        actorRole: 'ADMIN',
        actorUserId: 'admin-001',
      });

      expect(result.success).toBe(true);
      expect(result.previousSpotName).toBe('Desk 1');
      expect(result.newSpotName).toBe('Desk 2');
      expect(result.reservation.assignedCandidate?.workspaceInstanceId).toBe(desk2.id);
      expect(result.reservation.assignedCandidate?.workspaceDisplayName).toBe('Desk 2');
      expect(result.reservation.schedule).toContain('2:00 PM - 6:00 PM');

      // Timeline entry
      const detail = await adminService.getReservationDetail(res.id);
      expect(detail).not.toBeNull();
      expect(
        detail!.timeline.some((t) =>
          t.includes('Relocated by Admin from Desk 1 to Desk 2') &&
          t.includes('Spot Maintenance / Repairs')
        )
      ).toBe(true);

      // Confirmation email dispatched
      expect(sentEmails.length).toBeGreaterThan(0);
      const relocEmail = sentEmails.find((e) =>
        e.body.subject.includes('Relocated') || e.body.subject.includes('Spot Updated')
      );
      expect(relocEmail).toBeDefined();
      expect(relocEmail.body.to).toContain('alex.rivera.reloc-exec-1@example.com');
      expect(relocEmail.body.html).toContain('Desk 2');
      expect(relocEmail.body.html).toContain('Floor 1');
      expect(relocEmail.body.html).toContain('Spot Maintenance / Repairs');
    });

    it('frees up the old spot and occupies the target spot for future conflict checks', async () => {
      const catalog = await workspaceRepo.listCatalog();
      const desk1 = catalog.instances.find((i) => i.instanceCode === 'desk-1')!;
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      // res on desk-1 (2:00 PM - 6:00 PM)
      const res = await createConfirmedReservation('reloc-free-1', desk1.id, 14, 4);
      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      // Relocate to desk-2
      await adminService.relocateReservation({
        reservationId: res.id,
        targetWorkspaceInstanceId: desk2.id,
        reason: 'Facility Issue',
        actorRole: 'ADMIN',
      });

      // Now desk-1 should be available for a new booking at 2:00 PM - 6:00 PM
      const availDesk1 = await adminService.checkRescheduleAvailability({
        reservationId: 'some-other-res',
        startAt: zonedDateTimeToUtc('2026-09-18', '14:00', 'Asia/Manila').toISOString(),
        endAt: zonedDateTimeToUtc('2026-09-18', '18:00', 'Asia/Manila').toISOString(),
        workspaceInstanceId: desk1.id,
      });
      expect(availDesk1.available).toBe(true);

      // desk-2 should now be occupied
      const availDesk2 = await adminService.checkRescheduleAvailability({
        reservationId: 'some-other-res',
        startAt: zonedDateTimeToUtc('2026-09-18', '14:00', 'Asia/Manila').toISOString(),
        endAt: zonedDateTimeToUtc('2026-09-18', '18:00', 'Asia/Manila').toISOString(),
        workspaceInstanceId: desk2.id,
      });
      expect(availDesk2.available).toBe(false);
    });

    it('rejects relocation if target spot belongs to a different template tier', async () => {
      const res = await createConfirmedReservation('diff-template-1', 'desk-1', 14, 4);
      const catalog = await workspaceRepo.listCatalog();
      const office1 = catalog.instances.find((i) => i.instanceCode === 'office-1')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: office1.id,
          reason: 'Customer Request / Operational Adjustment',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('exact same workspace template');
    });

    it('rejects relocation if target spot is currently under MAINTENANCE or INACTIVE', async () => {
      const res = await createConfirmedReservation('maint-target-1', 'desk-1', 14, 4);
      const catalog = await workspaceRepo.listCatalog();
      const desk3 = catalog.instances.find((i) => i.instanceCode === 'desk-3')!;

      await workspaceRepo.updateInstance(desk3.id, { operationalStatus: 'MAINTENANCE' });

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk3.id,
          reason: 'Spot Maintenance / Repairs',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('maintenance');
    });

    it('rejects relocation if target spot has an overlapping booking', async () => {
      // res1 on desk-1 (14:00 - 18:00)
      const res1 = await createConfirmedReservation('overlap-target-1', 'desk-1', 14, 4);
      // res2 on desk-2 (15:00 - 17:00)
      await createConfirmedReservation('overlap-target-2', 'desk-2', 15, 2);

      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);

      await expect(
        adminService.relocateReservation({
          reservationId: res1.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Spot Inactive / Out of Order',
          actorRole: 'ADMIN',
        })
      ).rejects.toThrow('already booked');
    });

    it('rejects relocation on cancelled or expired reservation', async () => {
      const res = await createConfirmedReservation('cancel-then-reloc', 'desk-1', 14, 4);
      const catalog = await workspaceRepo.listCatalog();
      const desk2 = catalog.instances.find((i) => i.instanceCode === 'desk-2')!;

      const adminService = createAdminReservationService(repo, nowProvider, mockEmailService);
      await adminService.cancelReservation({
        reservationId: res.id,
        reason: 'Customer Request',
      });

      await expect(
        adminService.relocateReservation({
          reservationId: res.id,
          targetWorkspaceInstanceId: desk2.id,
          reason: 'Facility Issue',
        })
      ).rejects.toThrow('Only confirmed or checked-in reservations can be relocated');
    });
  });

  describe('Transactional Email Template Rendering', () => {
    it('renders reservation relocated email with old/new spot names, schedule, and QR pass', () => {
      const rendered = renderReservationRelocatedEmail({
        to: 'customer@example.com',
        customerFirstName: 'Alex',
        customerLastName: 'Rivera',
        referenceCode: 'DA-RELOC-9988',
        oldWorkspaceDisplayName: 'Desk 01',
        newWorkspaceDisplayName: 'Desk 04',
        floorName: '2nd Floor',
        workspaceTemplateName: 'Dedicated Desk',
        schedule: 'Sep 18, 2026, 2:00 PM – 6:00 PM',
        duration: '4 hours',
        relocationReason: 'Electrical maintenance at previous desk',
        bookingAccessUrl: 'https://deskatlas.test/booking/tok-9988',
        trackingUrl: 'https://deskatlas.test/track?code=DA-RELOC-9988',
      });

      expect(rendered.subject).toContain('DA-RELOC-9988');
      expect(rendered.html).toContain('Alex Rivera');
      expect(rendered.html).toContain('Desk 04');
      expect(rendered.html).toContain('Desk 01');
      expect(rendered.html).toContain('2nd Floor');
      expect(rendered.html).toContain('Dedicated Desk');
      expect(rendered.html).toContain('Electrical maintenance at previous desk');
      expect(rendered.html).toContain('Digital Access QR Pass');
      expect(rendered.html).toContain('https://deskatlas.test/track?code=DA-RELOC-9988');
      expect(rendered.text).toContain('DA-RELOC-9988');
      expect(rendered.text).toContain('Desk 04');
    });
  });

  describe('ReservationSupabaseRepository relocateReservation', () => {
    it('calls /rpc/relocate_reservation with proper parameters and returns relocated result', async () => {
      const supabaseRepo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      const calledEndpoints: { endpoint: string; options?: any }[] = [];

      (supabaseRepo as any).request = async (endpoint: string, options?: any) => {
        calledEndpoints.push({ endpoint, options });
        if (endpoint === '/rpc/relocate_reservation') {
          return [
            {
              reservation_id: 'res-uuid-1',
              reference_code: 'DA-123456',
              previous_spot_name: 'Desk 01',
              new_spot_name: 'Desk 02',
              floor_name: 'Ground Floor',
              workspace_template_name: 'Dedicated Desk',
              start_at: '2026-09-18T06:00:00.000Z',
              end_at: '2026-09-18T10:00:00.000Z',
              customer_first_name: 'Alex',
              customer_last_name: 'Rivera',
              customer_email: 'alex@example.com',
              booking_token: 'tok-abc',
            },
          ];
        }
        if (endpoint.includes('/reservations?select=*')) {
          return [
            {
              id: 'res-uuid-1',
              reference_code: 'DA-123456',
              status: 'CONFIRMED',
              customer_first_name: 'Alex',
              customer_last_name: 'Rivera',
              customer_email: 'alex@example.com',
            },
          ];
        }
        return [];
      };

      const result = await supabaseRepo.relocateReservation({
        reservationId: 'res-uuid-1',
        targetWorkspaceInstanceId: 'inst-uuid-2',
        reason: 'Spot Maintenance',
        notes: 'Desk leg broken',
        actorUserId: 'admin-uuid-9',
        actorRole: 'ADMIN',
      });

      expect(result.success).toBe(true);
      expect(result.previousSpotName).toBe('Desk 01');
      expect(result.newSpotName).toBe('Desk 02');

      const rpcCall = calledEndpoints.find((c) => c.endpoint === '/rpc/relocate_reservation');
      expect(rpcCall).toBeDefined();
      const body = JSON.parse(rpcCall!.options.body);
      expect(body.p_reservation_id).toBe('res-uuid-1');
      expect(body.p_target_instance_id).toBe('inst-uuid-2');
      expect(body.p_relocation_reason).toBe('Spot Maintenance - Desk leg broken');
      expect(body.p_actor_user_id).toBe('admin-uuid-9');
      expect(body.p_actor_role).toBe('ADMIN');
    });

    it('throws actionable error message if public.relocate_reservation RPC is missing in Supabase', async () => {
      const supabaseRepo = new ReservationSupabaseRepository({
        supabaseUrl: 'https://mock.supabase.co',
        serviceRoleKey: 'mock-key',
      });

      (supabaseRepo as any).request = async (endpoint: string) => {
        if (endpoint.includes('/reservations?select=*')) {
          return [{ id: 'res-1', reference_code: 'REF1', status: 'CONFIRMED' }];
        }
        if (endpoint === '/rpc/relocate_reservation') {
          throw new Error(
            'Supabase request failed (404): {"code":"PGRST202","message":"Could not find the function public.relocate_reservation"}'
          );
        }
        return [];
      };

      await expect(
        supabaseRepo.relocateReservation({
          reservationId: 'res-1',
          targetWorkspaceInstanceId: 'inst-2',
          reason: 'Spot Maintenance',
        })
      ).rejects.toThrow('Database function public.relocate_reservation is missing in Supabase');
    });
  });
});
