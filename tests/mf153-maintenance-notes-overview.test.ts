import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  InMemoryWorkspaceRepository,
  createWorkspaceService,
  normalizeCreateInstanceInput,
  normalizeUpdateInstanceInput,
  normalizeMaintenanceNote,
  SupabaseWorkspaceRepository as DomainSupabaseWorkspaceRepository,
} from "@deskatlas/domain";
import { PATCH as adminPatchInstance } from "../apps/admin-portal/src/app/api/admin/workspaces/instances/[instanceId]/route";
import { GET as adminGetMaintenanceInstances } from "../apps/admin-portal/src/app/api/admin/workspace-instances/maintenance/route";
import { GET as adminGetWorkspacesMaintenance } from "../apps/admin-portal/src/app/api/admin/workspaces/maintenance/route";
import { PATCH as staffPatchInstance } from "../apps/staff-dashboard/src/app/api/operations/workspaces/instances/[instanceId]/route";

describe("MF-153: Admin Maintenance Issues Overview and Desk Maintenance Notes", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("Normalization & Domain Service", () => {
    it("normalizes maintenance note: trims whitespace and caps at 300 characters", () => {
      assert.equal(normalizeMaintenanceNote("   Broken monitor   "), "Broken monitor");
      assert.equal(normalizeMaintenanceNote(""), null);
      assert.equal(normalizeMaintenanceNote("   "), null);
      assert.equal(normalizeMaintenanceNote(null), null);
      assert.equal(normalizeMaintenanceNote(undefined), null);

      const longText = "a".repeat(400);
      const normalized = normalizeMaintenanceNote(longText);
      assert.equal(normalized?.length, 300);
    });

    it("persists maintenance note when setting status to MAINTENANCE", async () => {
      const repo = new InMemoryWorkspaceRepository();
      const service = createWorkspaceService(repo);

      const template = await service.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 50,
      });
      const catalog = await service.listCatalog();
      const floorId = catalog.floors[0].id;

      const instance = await service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "A-01",
        displayName: "Desk A-01",
        operationalStatus: "ACTIVE",
      });

      assert.equal(instance.operationalStatus, "ACTIVE");
      assert.equal(instance.maintenanceNote, null);

      // Transition to MAINTENANCE with note
      const updated = await service.updateManagedInstance(instance.id, {
        operationalStatus: "MAINTENANCE",
        maintenanceNote: "AC leak above desk",
      });

      assert.equal(updated.instance.operationalStatus, "MAINTENANCE");
      assert.equal(updated.instance.maintenanceNote, "AC leak above desk");
    });

    it("clears maintenance note (sets to null) when transition away from MAINTENANCE", async () => {
      const repo = new InMemoryWorkspaceRepository();
      const service = createWorkspaceService(repo);

      const template = await service.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 50,
      });
      const catalog = await service.listCatalog();
      const floorId = catalog.floors[0].id;

      const instance = await service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "B-01",
        displayName: "Desk B-01",
        operationalStatus: "MAINTENANCE",
        maintenanceNote: "Broken chair",
      });

      assert.equal(instance.operationalStatus, "MAINTENANCE");
      assert.equal(instance.maintenanceNote, "Broken chair");

      // Change status to ACTIVE
      const updated = await service.updateManagedInstance(instance.id, {
        operationalStatus: "ACTIVE",
      });

      assert.equal(updated.instance.operationalStatus, "ACTIVE");
      assert.equal(updated.instance.maintenanceNote, null);
    });

    it("stores null when status is MAINTENANCE but no note is provided", async () => {
      const repo = new InMemoryWorkspaceRepository();
      const service = createWorkspaceService(repo);

      const template = await service.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 50,
      });
      const catalog = await service.listCatalog();
      const floorId = catalog.floors[0].id;

      const instance = await service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "C-01",
        displayName: "Desk C-01",
        operationalStatus: "ACTIVE",
      });

      const updated = await service.updateManagedInstance(instance.id, {
        operationalStatus: "MAINTENANCE",
      });

      assert.equal(updated.instance.operationalStatus, "MAINTENANCE");
      assert.equal(updated.instance.maintenanceNote, null);
    });

    it("includes previousMaintenanceNote and newMaintenanceNote in audit log", async () => {
      const repo = new InMemoryWorkspaceRepository();
      const service = createWorkspaceService(repo);

      const template = await service.createTemplate({
        name: "Dedicated Desk",
        capacity: 1,
        rateAmount: 50,
      });
      const catalog = await service.listCatalog();
      const floorId = catalog.floors[0].id;

      const instance = await service.createInstance({
        templateId: template.id,
        floorId,
        instanceCode: "D-01",
        displayName: "Desk D-01",
        operationalStatus: "ACTIVE",
      });

      await service.updateManagedInstance(
        instance.id,
        {
          operationalStatus: "MAINTENANCE",
          maintenanceNote: "Power socket not working",
        },
        { actorRole: "ADMIN", actorUserId: "11111111-2222-3333-4444-555555555555" }
      );

      const logs = await repo.listAuditLogs();
      assert.ok(logs.length > 0);
      const log = logs[0];
      assert.equal(log.action, "workspace.instance.updated");
      assert.equal(log.metadata.previousOperationalStatus, "ACTIVE");
      assert.equal(log.metadata.newOperationalStatus, "MAINTENANCE");
      assert.equal(log.metadata.previousMaintenanceNote, null);
      assert.equal(log.metadata.newMaintenanceNote, "Power socket not working");
    });
  });

  describe("Admin & Staff Portal API Integration", () => {
    it("admin PATCH endpoint accepts maintenanceNote and updates instance", async () => {
      let patchBody: any = null;
      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/staff_profiles")) {
          return new Response(
            JSON.stringify([{ user_id: "11111111-2222-3333-4444-555555555555", role: "ADMIN", is_active: true }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-01",
                display_name: "Desk A-01",
                operational_status: "ACTIVE",
                maintenance_note: null,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && init?.method === "PATCH") {
          patchBody = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-01",
                display_name: "Desk A-01",
                operational_status: patchBody.operational_status,
                maintenance_note: patchBody.maintenance_note,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/audit_logs") && init?.method === "POST") {
          return new Response("", { status: 201, headers: { "Content-Type": "application/json" } });
        }
        if (urlStr.includes("/reservation_candidates")) {
          return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/admin/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "11111111-2222-3333-4444-555555555555",
          "x-user-role": "ADMIN",
        },
        body: JSON.stringify({
          operationalStatus: "MAINTENANCE",
          maintenanceNote: "Table leg wobbly",
        }),
      });

      const res = await adminPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      assert.equal(patchBody?.operational_status, "MAINTENANCE");
      assert.equal(patchBody?.maintenance_note, "Table leg wobbly");
    });

    it("staff PATCH endpoint passes maintenanceNote to domain service", async () => {
      let patchBody: any = null;
      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/staff_profiles")) {
          return new Response(
            JSON.stringify([{ user_id: "22222222-3333-4444-5555-666666666666", role: "STAFF", is_active: true }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/workspace_instances?id=eq.inst-2") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-2",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-02",
                display_name: "Desk A-02",
                operational_status: "ACTIVE",
                maintenance_note: null,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/workspace_instances?id=eq.inst-2") && init?.method === "PATCH") {
          patchBody = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify([
              {
                id: "inst-2",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-02",
                display_name: "Desk A-02",
                operational_status: patchBody.operational_status,
                maintenance_note: patchBody.maintenance_note,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/audit_logs") && init?.method === "POST") {
          return new Response("", { status: 201, headers: { "Content-Type": "application/json" } });
        }
        if (urlStr.includes("/reservation_candidates")) {
          return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-2", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "22222222-3333-4444-5555-666666666666",
          "x-user-role": "STAFF",
        },
        body: JSON.stringify({
          operationalStatus: "MAINTENANCE",
          maintenanceNote: "LAN cable damaged",
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-2" }),
      });

      assert.equal(res.status, 200);
      assert.equal(patchBody?.operational_status, "MAINTENANCE");
      assert.equal(patchBody?.maintenance_note, "LAN cable damaged");
    });

    it("maintenance overview endpoint returns only MAINTENANCE instances with reasons", async () => {
      global.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/workspace_templates")) {
          return new Response(
            JSON.stringify([
              { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/floors")) {
          return new Response(
            JSON.stringify([{ id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/workspace_instances")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-01",
                display_name: "Desk A-01",
                operational_status: "ACTIVE",
                maintenance_note: null,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
              {
                id: "inst-2",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-02",
                display_name: "Desk A-02",
                operational_status: "MAINTENANCE",
                maintenance_note: "Broken monitor power adapter",
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
              {
                id: "inst-3",
                template_id: "tpl-1",
                floor_id: "fl-1",
                instance_code: "A-03",
                display_name: "Desk A-03",
                operational_status: "MAINTENANCE",
                maintenance_note: null,
                template: { id: "tpl-1", name: "Dedicated Desk", capacity: 1, rate_amount: "50", pricing_unit: "HOURLY", default_shape: "desk", default_color: "#009689", default_style: {}, is_active: true },
                floor: { id: "fl-1", name: "Floor 1", floor_number: 1, display_order: 1, is_active: true },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      const res = await adminGetMaintenanceInstances();
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.length, 2);
      assert.equal(data[0].id, "inst-2");
      assert.equal(data[0].maintenanceNote, "Broken monitor power adapter");
      assert.equal(data[1].id, "inst-3");
      assert.equal(data[1].maintenanceNote, null);

      const resAlias = await adminGetWorkspacesMaintenance();
      assert.equal(resAlias.status, 200);
      const dataAlias = await resAlias.json();
      assert.equal(dataAlias.length, 2);
    });
  });
});
