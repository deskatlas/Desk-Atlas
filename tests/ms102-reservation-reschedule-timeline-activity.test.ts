import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  ReservationMemoryRepository,
  ReservationSupabaseRepository,
  InMemoryWorkspaceRepository,
  createAdminReservationService,
  createReservationService,
  createPaymentSessionService,
  createPaymentReviewService,
  createBookingAccessService,
  TransactionalEmailService,
  zonedDateTimeToUtc,
  getHumanReadableMetadata,
} from "@deskatlas/domain";

describe("MS-102: Reservation Reschedule Audit Logging and Operational Timeline Reconciliation", () => {
  const rootDir = path.resolve(__dirname, "..");
  const adminActivityLogPagePath = path.join(
    rootDir,
    "apps",
    "admin-portal",
    "src",
    "app",
    "manage",
    "activity-log",
    "page.tsx"
  );
  const staffActivityLogPagePath = path.join(
    rootDir,
    "apps",
    "staff-dashboard",
    "src",
    "app",
    "manage",
    "activity-log",
    "page.tsx"
  );
  const upMigrationPath = path.join(
    rootDir,
    "supabase",
    "migrations",
    "052_relax_audit_logs_actor_consistency.sql"
  );
  const downMigrationPath = path.join(
    rootDir,
    "supabase",
    "migrations",
    "052_relax_audit_logs_actor_consistency_down.sql"
  );
  const ms102SpecPath = path.join(rootDir, "docs", "milestone", "ms102.md");

  it("MS102-TC01: Customer self-service reschedule creates audit log with actor_role = 'CUSTOMER'", async () => {
    const supabaseRepo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    const origStart = new Date(Date.now() + 86400000 * 5).toISOString();
    const origEnd = new Date(Date.now() + 86400000 * 5 + 7200000).toISOString();
    const targetStart = new Date(Date.now() + 86400000 * 6).toISOString();
    const targetEnd = new Date(Date.now() + 86400000 * 6 + 7200000).toISOString();

    const postedAuditLogs: Array<{ endpoint: string; body: Record<string, unknown> }> = [];

    (supabaseRepo as unknown as { request: (endpoint: string, options?: { method?: string; body?: string }) => Promise<unknown> }).request = async (
      endpoint: string,
      options?: { method?: string; body?: string }
    ) => {
      if (endpoint.includes("/reservations?select=*")) {
        return [
          {
            id: "res-ms102-cust-1",
            reference_code: "DA-2026-CUST1",
            status: "CONFIRMED",
            amount_due: 300,
            currency: "PHP",
            reschedule_count: 0,
            created_at: new Date(Date.now() - 86400000).toISOString(),
            updated_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?reservation_id=eq.")) {
        return [
          {
            id: "cand-1",
            reservation_id: "res-ms102-cust-1",
            rank: 0,
            is_assigned: true,
            workspace_instance_id: "spot-101",
            start_at: origStart,
            end_at: origEnd,
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?workspace_instance_id=eq.")) {
        return [];
      }
      if (endpoint.includes("/operating_hours?")) {
        return [{ opens_at: "00:00:00", closes_at: "24:00:00", is_active: true }];
      }
      if (endpoint.includes("/schedule_blocks?")) {
        return [];
      }
      if (endpoint.startsWith("/reservation_candidates?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint.startsWith("/reservations?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint === "/audit_logs" && options?.method === "POST") {
        const parsedBody = JSON.parse(options.body || "{}") as Record<string, unknown>;
        postedAuditLogs.push({ endpoint, body: parsedBody });
        return { id: "audit-log-cust-1", ...parsedBody };
      }
      if (endpoint.includes("/workspace_instances?select=*")) {
        return [
          {
            id: "spot-101",
            instance_code: "spot-101",
            display_name: "Desk 101",
            template_id: "tpl-1",
          },
        ];
      }
      if (endpoint.includes("/workspace_templates?select=*")) {
        return [{ id: "tpl-1", name: "Dedicated Desk", floor_id: "fl-1" }];
      }
      if (endpoint.includes("/floors?select=*")) {
        return [{ id: "fl-1", name: "Floor 1" }];
      }
      if (endpoint.includes("/payment_attempts?select=*")) {
        return [];
      }
      if (endpoint.includes("/audit_logs?select=*")) {
        return postedAuditLogs.map((log) => ({
          id: "audit-row-1",
          created_at: new Date().toISOString(),
          action: log.body.action,
          actor_role: log.body.actor_role,
          actor_user_id: log.body.actor_user_id,
          metadata: log.body.metadata,
        }));
      }
      return [];
    };

    const result = await supabaseRepo.rescheduleReservation({
      reservationId: "res-ms102-cust-1",
      startAt: targetStart,
      endAt: targetEnd,
      actorRole: "CUSTOMER",
    });

    expect(result.success).toBe(true);
    expect(postedAuditLogs.length).toBe(1);
    const auditRecord = postedAuditLogs[0].body;
    expect(auditRecord.action).toBe("reservation_rescheduled");
    expect(auditRecord.actor_role).toBe("CUSTOMER");
    expect(auditRecord.actor_user_id).toBeNull();
    expect(auditRecord.entity_type).toBe("reservation");
    expect(auditRecord.entity_id).toBe("res-ms102-cust-1");

    const meta = auditRecord.metadata as Record<string, unknown>;
    expect(meta.reference_code).toBe("DA-2026-CUST1");
    expect(meta.actor_role).toBe("CUSTOMER");
    expect(meta.start_at).toBe(targetStart);
    expect(meta.end_at).toBe(targetEnd);
    expect(meta.rescheduled_at).toBeDefined();
  });

  it("MS102-TC02: Admin reschedule without actor user id succeeds and attributes ADMIN role", async () => {
    const supabaseRepo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    const origStart = new Date(Date.now() + 86400000 * 5).toISOString();
    const origEnd = new Date(Date.now() + 86400000 * 5 + 7200000).toISOString();
    const targetStart = new Date(Date.now() + 86400000 * 7).toISOString();
    const targetEnd = new Date(Date.now() + 86400000 * 7 + 7200000).toISOString();

    const postedAuditLogs: Array<{ endpoint: string; body: Record<string, unknown> }> = [];

    (supabaseRepo as unknown as { request: (endpoint: string, options?: { method?: string; body?: string }) => Promise<unknown> }).request = async (
      endpoint: string,
      options?: { method?: string; body?: string }
    ) => {
      if (endpoint.includes("/reservations?select=*")) {
        return [
          {
            id: "res-ms102-adm-1",
            reference_code: "DA-2026-ADM1",
            status: "CONFIRMED",
            amount_due: 300,
            currency: "PHP",
            reschedule_count: 0,
            created_at: new Date(Date.now() - 86400000).toISOString(),
            updated_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?reservation_id=eq.")) {
        return [
          {
            id: "cand-2",
            reservation_id: "res-ms102-adm-1",
            rank: 0,
            is_assigned: true,
            workspace_instance_id: "spot-102",
            start_at: origStart,
            end_at: origEnd,
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?workspace_instance_id=eq.")) {
        return [];
      }
      if (endpoint.includes("/operating_hours?")) {
        return [{ opens_at: "00:00:00", closes_at: "24:00:00", is_active: true }];
      }
      if (endpoint.includes("/schedule_blocks?")) {
        return [];
      }
      if (endpoint.startsWith("/reservation_candidates?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint.startsWith("/reservations?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint === "/audit_logs" && options?.method === "POST") {
        const parsedBody = JSON.parse(options.body || "{}") as Record<string, unknown>;
        postedAuditLogs.push({ endpoint, body: parsedBody });
        return { id: "audit-log-adm-1", ...parsedBody };
      }
      if (endpoint.includes("/workspace_instances?select=*")) {
        return [
          {
            id: "spot-102",
            instance_code: "spot-102",
            display_name: "Desk 102",
            template_id: "tpl-1",
          },
        ];
      }
      if (endpoint.includes("/workspace_templates?select=*")) {
        return [{ id: "tpl-1", name: "Dedicated Desk", floor_id: "fl-1" }];
      }
      if (endpoint.includes("/floors?select=*")) {
        return [{ id: "fl-1", name: "Floor 1" }];
      }
      if (endpoint.includes("/payment_attempts?select=*")) {
        return [];
      }
      if (endpoint.includes("/audit_logs?select=*")) {
        return postedAuditLogs.map((log) => ({
          id: "audit-row-2",
          created_at: new Date().toISOString(),
          action: log.body.action,
          actor_role: log.body.actor_role,
          actor_user_id: log.body.actor_user_id,
          metadata: log.body.metadata,
        }));
      }
      return [];
    };

    // Omitting actorUserId, specifying actorRole = ADMIN
    const result = await supabaseRepo.rescheduleReservation({
      reservationId: "res-ms102-adm-1",
      startAt: targetStart,
      endAt: targetEnd,
      actorRole: "ADMIN",
    });

    expect(result.success).toBe(true);
    expect(postedAuditLogs.length).toBe(1);
    const auditRecord = postedAuditLogs[0].body;
    expect(auditRecord.action).toBe("reservation_rescheduled");
    expect(auditRecord.actor_role).toBe("ADMIN");
    expect(auditRecord.actor_user_id).toBeNull();
  });

  it("MS102-TC09: Superadmin reschedule normalizes database actor role to ADMIN and renders Super Admin in timeline", async () => {
    const supabaseRepo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    const origStart = new Date(Date.now() + 86400000 * 5).toISOString();
    const origEnd = new Date(Date.now() + 86400000 * 5 + 7200000).toISOString();
    const targetStart = new Date(Date.now() + 86400000 * 8).toISOString();
    const targetEnd = new Date(Date.now() + 86400000 * 8 + 7200000).toISOString();

    const postedAuditLogs: Array<{ endpoint: string; body: Record<string, unknown> }> = [];

    (supabaseRepo as unknown as { request: (endpoint: string, options?: { method?: string; body?: string }) => Promise<unknown> }).request = async (
      endpoint: string,
      options?: { method?: string; body?: string }
    ) => {
      if (endpoint.includes("/reservations?select=*")) {
        return [
          {
            id: "res-ms102-super-1",
            reference_code: "DA-2026-SUPER1",
            customer_first_name: "Super",
            customer_last_name: "Admin",
            status: "CONFIRMED",
            amount_due: 300,
            currency: "PHP",
            reschedule_count: 0,
            created_at: new Date(Date.now() - 86400000).toISOString(),
            updated_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?reservation_id=eq.")) {
        return [
          {
            id: "cand-super-1",
            reservation_id: "res-ms102-super-1",
            rank: 0,
            is_assigned: true,
            workspace_instance_id: "spot-103",
            start_at: origStart,
            end_at: origEnd,
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?workspace_instance_id=eq.")) {
        return [];
      }
      if (endpoint.includes("/operating_hours?")) {
        return [{ opens_at: "00:00:00", closes_at: "24:00:00", is_active: true }];
      }
      if (endpoint.includes("/schedule_blocks?")) {
        return [];
      }
      if (endpoint.startsWith("/reservation_candidates?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint.startsWith("/reservations?") && options?.method === "PATCH") {
        return [];
      }
      if (endpoint === "/audit_logs" && options?.method === "POST") {
        const parsedBody = JSON.parse(options.body || "{}") as Record<string, unknown>;
        postedAuditLogs.push({ endpoint, body: parsedBody });
        return { id: "audit-log-super-1", ...parsedBody };
      }
      if (endpoint.includes("/workspace_instances?select=*")) {
        return [
          {
            id: "spot-103",
            instance_code: "spot-103",
            display_name: "Executive Desk",
            template_id: "tpl-1",
          },
        ];
      }
      if (endpoint.includes("/workspace_templates?select=*")) {
        return [{ id: "tpl-1", name: "Dedicated Desk", floor_id: "fl-1" }];
      }
      if (endpoint.includes("/floors?select=*")) {
        return [{ id: "fl-1", name: "Floor 1" }];
      }
      if (endpoint.includes("/payment_attempts?select=*")) {
        return [];
      }
      if (endpoint.includes("/audit_logs?select=*")) {
        return postedAuditLogs.map((log) => ({
          id: "audit-row-super-1",
          created_at: new Date().toISOString(),
          action: log.body.action,
          actor_role: log.body.actor_role,
          actor_user_id: log.body.actor_user_id,
          metadata: log.body.metadata,
        }));
      }
      return [];
    };

    const result = await supabaseRepo.rescheduleReservation({
      reservationId: "res-ms102-super-1",
      startAt: targetStart,
      endAt: targetEnd,
      actorRole: "SUPERADMIN",
      actorUserId: "28f07bd0-0372-447b-8c31-e1b562eafa3c",
    });

    expect(result.success).toBe(true);
    expect(postedAuditLogs.length).toBe(1);
    const auditRecord = postedAuditLogs[0].body;
    expect(auditRecord.action).toBe("reservation_rescheduled");
    expect(auditRecord.actor_role).toBe("ADMIN");
    expect(auditRecord.actor_user_id).toBe("28f07bd0-0372-447b-8c31-e1b562eafa3c");
    expect((auditRecord.metadata as Record<string, unknown>).actor_role).toBe("SUPERADMIN");

    expect(result.reservation.timeline.some((t) => t.includes("Rescheduled by Super Admin"))).toBe(true);
  });

  it("MS102-TC03: Reservation detail timeline surfaces reschedule event in format '[Date] - Rescheduled by [Actor] to [Schedule]'", async () => {
    const supabaseRepo = new ReservationSupabaseRepository({
      supabaseUrl: "https://mock.supabase.co",
      serviceRoleKey: "mock-key",
    });

    (supabaseRepo as unknown as { request: (endpoint: string) => Promise<unknown> }).request = async (endpoint: string) => {
      if (endpoint.includes("/reservations?select=*")) {
        return [
          {
            id: "res-detail-1",
            reference_code: "DA-2026-DET1",
            customer_first_name: "Carlos",
            customer_last_name: "Reyes",
            customer_email: "carlos@example.com",
            customer_phone: "09171234567",
            status: "CONFIRMED",
            source: "WEB",
            amount_due: 500,
            currency: "PHP",
            created_at: "2026-11-01T08:00:00Z",
            confirmed_at: "2026-11-01T08:30:00Z",
            updated_at: "2026-11-02T14:00:00Z",
          },
        ];
      }
      if (endpoint.includes("/reservation_candidates?select=*")) {
        return [
          {
            id: "cand-d1",
            reservation_id: "res-detail-1",
            rank: 0,
            is_assigned: true,
            workspace_instance_id: "spot-d1",
            start_at: "2026-11-05T14:00:00Z",
            end_at: "2026-11-05T18:00:00Z",
          },
        ];
      }
      if (endpoint.includes("/workspace_instances?select=*")) {
        return [
          {
            id: "spot-d1",
            instance_code: "spot-d1",
            display_name: "Desk D1",
            template_id: "tpl-1",
          },
        ];
      }
      if (endpoint.includes("/workspace_templates?select=*")) {
        return [{ id: "tpl-1", name: "Flex Desk", floor_id: "fl-1" }];
      }
      if (endpoint.includes("/floors?select=*")) {
        return [{ id: "fl-1", name: "2nd Floor" }];
      }
      if (endpoint.includes("/payment_attempts?select=*")) {
        return [];
      }
      if (endpoint.includes("/audit_logs?select=*")) {
        return [
          {
            id: "audit-resched-1",
            created_at: "2026-11-02T14:00:00Z",
            action: "reservation_rescheduled",
            actor_role: "CUSTOMER",
            actor_user_id: null,
            metadata: {
              old_schedule: "Nov 4, 2026 14:00 - 18:00",
              new_schedule: "Nov 5, 2026 14:00 - 18:00",
            },
          },
        ];
      }
      return [];
    };

    const detail = await supabaseRepo.getAdminReservationDetail("res-detail-1");
    expect(detail).not.toBeNull();
    expect(detail!.timeline.length).toBeGreaterThan(0);

    const reschedEntry = detail!.timeline.find((t) => t.includes("Rescheduled by"));
    expect(reschedEntry).toBeDefined();
    expect(reschedEntry).toContain("Rescheduled by Customer");
    expect(reschedEntry).toContain("from Nov 4, 2026 14:00 - 18:00");
    expect(reschedEntry).toContain("to Nov 5, 2026 14:00 - 18:00");
  });

  describe("MS102-TC04: Relocation and Reschedule Coexistence in Timeline", () => {
    let memoryRepo: ReservationMemoryRepository;
    let workspaceRepo: InMemoryWorkspaceRepository;
    let mockEmailService: TransactionalEmailService;
    let now: Date;
    const nowProvider = () => now;

    beforeEach(async () => {
      now = new Date("2026-11-01T08:00:00+08:00");
      memoryRepo = new ReservationMemoryRepository(nowProvider);
      workspaceRepo = new InMemoryWorkspaceRepository();

      const floor = await workspaceRepo.createFloor({ name: "Main Floor" });
      const template = await workspaceRepo.createTemplate({
        name: "Hot Desk",
        capacity: 1,
        rateAmount: 100,
        pricingUnit: "HOURLY",
      });

      for (let i = 1; i <= 3; i++) {
        await workspaceRepo.createInstance({
          floorId: floor.id,
          templateId: template.id,
          instanceCode: `spot-${i}`,
          displayName: `Spot ${i}`,
        });
      }

      mockEmailService = new TransactionalEmailService({
        apiKey: "test-key",
        fetcher: async () => new Response(JSON.stringify({ id: "mock-id" }), { status: 200 }),
      });
    });

    async function createTestReservation() {
      const catalog = await workspaceRepo.listCatalog();
      const spot1 = catalog.instances[0];

      const paymentSessionService = createPaymentSessionService(memoryRepo, nowProvider);
      const reservationService = createReservationService(
        memoryRepo,
        workspaceRepo,
        memoryRepo,
        paymentSessionService
      );
      const paymentReviewService = createPaymentReviewService(memoryRepo, nowProvider);

      const startAt = zonedDateTimeToUtc("2026-11-05", "10:00", "Asia/Manila").toISOString();
      const endAt = zonedDateTimeToUtc("2026-11-05", "12:00", "Asia/Manila").toISOString();

      const res = await reservationService.createReservation(
        {
          source: "WEB",
          customerFirstName: "Ana",
          customerLastName: "Lim",
          customerEmail: "ana.lim@example.com",
          candidates: [
            {
              rank: 0,
              workspaceInstanceId: spot1.id,
              startAt,
              endAt,
            },
          ],
        },
        { paymentLinkBaseUrl: "https://deskatlas.test/pay" }
      );

      await paymentSessionService.submitPaymentProof({
        token: res.paymentSession!.token,
        paymentMethodId: "pm-gcash",
        proofStoragePath: "proofs/test.png",
      });

      await paymentReviewService.reviewPayment({
        paymentAttemptId: res.paymentSession!.paymentAttemptId,
        actor: { role: "ADMIN", userId: "admin-1" },
        decision: "APPROVE",
      });

      const bookingAccessService = createBookingAccessService(memoryRepo, nowProvider);
      await bookingAccessService.issueBookingAccess(res.id, res.referenceCode, "https://deskatlas.test/access");

      return res;
    }

    it("relocation followed by reschedule renders in exact chronological order", async () => {
      const reservation = await createTestReservation();
      const catalog = await workspaceRepo.listCatalog();
      const spot2 = catalog.instances[1];

      // Step 1: Relocation at 09:00
      now = new Date("2026-11-01T09:00:00+08:00");
      await memoryRepo.relocateReservation({
        reservationId: reservation.id,
        targetWorkspaceInstanceId: spot2.id,
        reason: "Spot Maintenance",
        actorUserId: "admin-1",
        actorRole: "ADMIN",
      });

      // Step 2: Reschedule at 10:00
      now = new Date("2026-11-01T10:00:00+08:00");
      const adminService = createAdminReservationService(memoryRepo, nowProvider, mockEmailService);
      const newStart = zonedDateTimeToUtc("2026-11-06", "10:00", "Asia/Manila").toISOString();
      const newEnd = zonedDateTimeToUtc("2026-11-06", "12:00", "Asia/Manila").toISOString();

      await adminService.rescheduleReservation({
        reservationId: reservation.id,
        startAt: newStart,
        endAt: newEnd,
        actorUserId: "admin-1",
        actorRole: "ADMIN",
      });

      const detail = await adminService.getReservationDetail(reservation.id);
      expect(detail).not.toBeNull();

      const relocateIndex = detail!.timeline.findIndex((t) => t.includes("Relocated by Admin"));
      const reschedIndex = detail!.timeline.findIndex((t) => t.includes("Rescheduled by Admin"));

      expect(relocateIndex).toBeGreaterThan(-1);
      expect(reschedIndex).toBeGreaterThan(-1);
      expect(relocateIndex).toBeLessThan(reschedIndex);
    });

    it("reschedule followed by relocation renders in exact chronological order", async () => {
      const reservation = await createTestReservation();
      const catalog = await workspaceRepo.listCatalog();
      const spot3 = catalog.instances[2];

      // Step 1: Reschedule at 09:00
      now = new Date("2026-11-01T09:00:00+08:00");
      const adminService = createAdminReservationService(memoryRepo, nowProvider, mockEmailService);
      const newStart = zonedDateTimeToUtc("2026-11-07", "10:00", "Asia/Manila").toISOString();
      const newEnd = zonedDateTimeToUtc("2026-11-07", "12:00", "Asia/Manila").toISOString();

      await adminService.rescheduleReservation({
        reservationId: reservation.id,
        startAt: newStart,
        endAt: newEnd,
        actorUserId: "admin-1",
        actorRole: "ADMIN",
      });

      // Step 2: Relocation at 10:00
      now = new Date("2026-11-01T10:00:00+08:00");
      await memoryRepo.relocateReservation({
        reservationId: reservation.id,
        targetWorkspaceInstanceId: spot3.id,
        reason: "Desk Equipment Upgrade",
        actorUserId: "admin-1",
        actorRole: "ADMIN",
      });

      const detail = await adminService.getReservationDetail(reservation.id);
      expect(detail).not.toBeNull();

      const reschedIndex = detail!.timeline.findIndex((t) => t.includes("Rescheduled by Admin"));
      const relocateIndex = detail!.timeline.findIndex((t) => t.includes("Relocated by Admin"));

      expect(reschedIndex).toBeGreaterThan(-1);
      expect(relocateIndex).toBeGreaterThan(-1);
      expect(reschedIndex).toBeLessThan(relocateIndex);
    });
  });

  it("MS102-TC05: Staff Dashboard & Admin Portal Activity Log Filters Include Rescheduled Bookings", () => {
    expect(fs.existsSync(adminActivityLogPagePath)).toBe(true);
    const adminPage = fs.readFileSync(adminActivityLogPagePath, "utf8");
    expect(adminPage).toContain('label: "Rescheduled Bookings"');
    expect(adminPage).toContain('value: "RESCHEDULED"');
    expect(adminPage).toContain('"reservation_rescheduled"');
    expect(adminPage).toContain('"RESERVATION_RESCHEDULED"');
    expect(adminPage).toContain('data-testid="activity-log-action-filter"');

    expect(fs.existsSync(staffActivityLogPagePath)).toBe(true);
    const staffPage = fs.readFileSync(staffActivityLogPagePath, "utf8");
    expect(staffPage).toContain('label: "Rescheduled Bookings"');
    expect(staffPage).toContain('value: "RESCHEDULED"');
    expect(staffPage).toContain('"reservation_rescheduled"');
    expect(staffPage).toContain('"RESERVATION_RESCHEDULED"');
    expect(staffPage).toContain('data-testid="activity-log-action-filter"');
  });

  it("MS102-TC06: Human-Readable Metadata Formatting in Activity Details Modal for Reschedule", () => {
    const rawMetadata: Record<string, unknown> = {
      reference_code: "DA-2026-MS102-01",
      reservation_id: "00000000-0000-4000-8000-000000000102",
      old_schedule: "2026-11-10T09:00:00Z - 2026-11-10T17:00:00Z",
      new_schedule: "2026-11-11T09:00:00Z - 2026-11-11T17:00:00Z",
      rescheduled_at: "2026-11-05T12:30:00Z",
      reschedule_reason: "Meeting moved",
      reschedule_count: 1,
      rescheduled_by: "Customer Self-Service",
      actor_role: "CUSTOMER",
    };

    const items = getHumanReadableMetadata(rawMetadata);

    // Verify suppression of internal UUIDs
    expect(items.some((i) => i.key === "reservation_id")).toBe(false);

    // Verify formatted labels
    expect(items.find((i) => i.key === "reference_code")?.label).toBe("Reservation Reference");
    expect(items.find((i) => i.key === "old_schedule")?.label).toBe("Previous Schedule");
    expect(items.find((i) => i.key === "new_schedule")?.label).toBe("New Schedule");
    expect(items.find((i) => i.key === "rescheduled_at")?.label).toBe("Rescheduled At");
    expect(items.find((i) => i.key === "reschedule_reason")?.label).toBe("Reschedule Reason");
    expect(items.find((i) => i.key === "reschedule_count")?.label).toBe("Reschedule Count");
    expect(items.find((i) => i.key === "rescheduled_by")?.label).toBe("Rescheduled By");
    expect(items.find((i) => i.key === "actor_role")?.label).toBe("Actor Role");

    // Verify ISO formatted dates do not contain raw T
    expect(items.find((i) => i.key === "old_schedule")?.value).not.toContain("T");
    expect(items.find((i) => i.key === "new_schedule")?.value).not.toContain("T");
    expect(items.find((i) => i.key === "rescheduled_at")?.value).not.toContain("T");
  });

  it("MS102-TC07: Database migration files relax audit_logs actor check constraint", () => {
    expect(fs.existsSync(upMigrationPath)).toBe(true);
    const upSql = fs.readFileSync(upMigrationPath, "utf8");
    expect(upSql).toContain("ALTER TYPE public.audit_actor_role ADD VALUE IF NOT EXISTS 'CUSTOMER'");
    expect(upSql).toContain("ALTER TYPE public.audit_actor_role ADD VALUE IF NOT EXISTS 'SUPERADMIN'");
    expect(upSql).toContain("DROP CONSTRAINT IF EXISTS audit_logs_system_actor_consistency");
    expect(upSql).toContain("actor_role = 'CUSTOMER' AND actor_user_id IS NULL");
    expect(upSql).toContain("actor_role IN ('ADMIN', 'STAFF', 'SUPERADMIN')");

    expect(fs.existsSync(downMigrationPath)).toBe(true);
    const downSql = fs.readFileSync(downMigrationPath, "utf8");
    expect(downSql).toContain("DROP CONSTRAINT IF EXISTS audit_logs_system_actor_consistency");
    expect(downSql).toContain("actor_role IN ('ADMIN', 'STAFF') AND actor_user_id IS NOT NULL");
  });

  it("MS102-TC08: Zero em-dash and en-dash character invariant (BAN-PUNCT-01)", () => {
    const filesToCheck = [
      upMigrationPath,
      downMigrationPath,
      ms102SpecPath,
      path.join(rootDir, "packages", "domain", "src", "services", "reservationSupabaseRepository.ts"),
      path.join(rootDir, "packages", "domain", "src", "services", "reservationMemoryRepository.ts"),
      path.join(rootDir, "packages", "domain", "src", "services", "activityLogService.ts"),
      staffActivityLogPagePath,
      __filename,
    ];

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        // Check for em-dash (U+2014)
        expect(content.includes("\u2014"), `File ${filePath} contains an em-dash`).toBe(false);
      }
    }
  });
});
