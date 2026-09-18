import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  SupabaseWorkspaceRepository as DomainSupabaseWorkspaceRepository,
  createWorkspaceService,
} from "@deskatlas/domain";
import { SupabaseWorkspaceRepository as AdminSupabaseWorkspaceRepository } from "../apps/admin-portal/src/app/api/admin/workspaces/_lib/supabaseWorkspaceRepository";
import { PATCH as staffPatchInstance } from "../apps/staff-dashboard/src/app/api/operations/workspaces/instances/[instanceId]/route";
import { PATCH as adminPatchInstance } from "../apps/admin-portal/src/app/api/admin/workspaces/instances/[instanceId]/route";

describe("MF-65: Workspace Operational Status & Audit Log Fixes", () => {
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

  describe("Domain SupabaseWorkspaceRepository", () => {
    it("safely handles HTTP 201 with empty body (return=minimal) without throwing Unexpected end of JSON input", async () => {
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        recordedRequests.push({ url: String(url), options: init || {} });
        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new DomainSupabaseWorkspaceRepository();
      await assert.doesNotReject(async () => {
        await repo.appendAuditLog({
          actorRole: "STAFF",
          actorUserId: "11111111-2222-3333-4444-555555555555",
          action: "workspace.instance.updated",
          entityType: "workspace_instance",
          entityId: "inst-1",
          metadata: { operationalStatus: "MAINTENANCE" },
        });
      });

      assert.equal(recordedRequests.length, 1);
      assert.match(recordedRequests[0].url, /\/audit_logs$/);
      const body = JSON.parse(recordedRequests[0].options.body as string);
      assert.equal(body.actor_user_id, "11111111-2222-3333-4444-555555555555");
      assert.equal(body.actor_role, "STAFF");
    });

    it("sanitizes non-UUID actorUserId (like 'STAFF_OPERATOR') to null in appendAuditLog", async () => {
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        recordedRequests.push({ url: String(url), options: init || {} });
        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new DomainSupabaseWorkspaceRepository();
      await repo.appendAuditLog({
        actorRole: "STAFF",
        actorUserId: "STAFF_OPERATOR",
        action: "workspace.instance.updated",
        entityType: "workspace_instance",
        entityId: "inst-1",
        metadata: { operationalStatus: "MAINTENANCE" },
      });

      assert.equal(recordedRequests.length, 1);
      const body = JSON.parse(recordedRequests[0].options.body as string);
      assert.equal(body.actor_user_id, null);
      assert.equal(body.actor_role, "SYSTEM");
    });

    it("handles null or empty actorUserId gracefully", async () => {
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        recordedRequests.push({ url: String(url), options: init || {} });
        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new DomainSupabaseWorkspaceRepository();
      await repo.appendAuditLog({
        actorRole: "SYSTEM",
        actorUserId: null,
        action: "workspace.instance.updated",
        entityType: "workspace_instance",
        entityId: "inst-1",
        metadata: { operationalStatus: "ACTIVE" },
      });

      assert.equal(recordedRequests.length, 1);
      const body = JSON.parse(recordedRequests[0].options.body as string);
      assert.equal(body.actor_user_id, null);
    });

    it("safely handles HTTP 204 No Content", async () => {
      global.fetch = vi.fn(async () => {
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      const repo = new DomainSupabaseWorkspaceRepository();
      await assert.doesNotReject(async () => {
        await repo.appendAuditLog({
          actorRole: "ADMIN",
          actorUserId: null,
          action: "workspace.instance.updated",
          entityType: "workspace_instance",
          entityId: "inst-1",
          metadata: {},
        });
      });
    });
  });

  describe("Admin SupabaseWorkspaceRepository", () => {
    it("safely handles HTTP 201 with empty body and sanitizes non-UUID actorUserId", async () => {
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        recordedRequests.push({ url: String(url), options: init || {} });
        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new AdminSupabaseWorkspaceRepository();
      await assert.doesNotReject(async () => {
        await repo.appendAuditLog({
          actorRole: "ADMIN",
          actorUserId: "NOT_A_UUID",
          action: "workspace.instance.updated",
          entityType: "workspace_instance",
          entityId: "inst-1",
          metadata: { operationalStatus: "UNAVAILABLE" },
        });
      });

      assert.equal(recordedRequests.length, 1);
      const body = JSON.parse(recordedRequests[0].options.body as string);
      assert.equal(body.actor_user_id, null);
      assert.equal(body.actor_role, "SYSTEM");
    });

    it("preserves valid UUID for admin audit log", async () => {
      const validAdminUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        recordedRequests.push({ url: String(url), options: init || {} });
        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const repo = new AdminSupabaseWorkspaceRepository();
      await repo.appendAuditLog({
        actorRole: "ADMIN",
        actorUserId: validAdminUuid,
        action: "workspace.instance.updated",
        entityType: "workspace_instance",
        entityId: "inst-1",
        metadata: { operationalStatus: "ACTIVE" },
      });

      assert.equal(recordedRequests.length, 1);
      const body = JSON.parse(recordedRequests[0].options.body as string);
      assert.equal(body.actor_user_id, validAdminUuid);
    });
  });

  describe("Staff Dashboard instance PATCH route", () => {
    it("returns 400 when operationalStatus is missing", async () => {
      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "operationalStatus is required");
    });

    it("resolves staff profile UUID instead of passing STAFF_OPERATOR string", async () => {
      const validStaffUuid = "22222222-3333-4444-5555-666666666666";
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        recordedRequests.push({ url: urlStr, options: init || {} });

        if (urlStr.includes("/staff_profiles")) {
          return new Response(JSON.stringify([{ user_id: validStaffUuid }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && (!init?.method || init?.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "ACTIVE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "MAINTENANCE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/audit_logs")) {
          return new Response("", {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationalStatus: "MAINTENANCE" }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "MAINTENANCE");

      const auditRequest = recordedRequests.find((r) => r.url.includes("/audit_logs"));
      assert.ok(auditRequest, "Audit log request should be made");
      const auditBody = JSON.parse(auditRequest.options.body as string);
      assert.equal(auditBody.actor_user_id, validStaffUuid);
      assert.equal(auditBody.actor_role, "STAFF");
      assert.notEqual(auditBody.actor_user_id, "STAFF_OPERATOR");
    });

    it("resolves role ADMIN when staff_profile has role ADMIN, avoiding audit_actor constraint violation", async () => {
      const validAdminUuid = "33333333-4444-5555-6666-777777777777";
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        recordedRequests.push({ url: urlStr, options: init || {} });

        if (urlStr.includes("/staff_profiles")) {
          return new Response(JSON.stringify([{ user_id: validAdminUuid, role: "ADMIN" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && (!init?.method || init?.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "ACTIVE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "MAINTENANCE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/audit_logs")) {
          return new Response("", {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationalStatus: "MAINTENANCE" }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "MAINTENANCE");

      const auditRequest = recordedRequests.find((r) => r.url.includes("/audit_logs"));
      assert.ok(auditRequest, "Audit log request should be made");
      const auditBody = JSON.parse(auditRequest.options.body as string);
      assert.equal(auditBody.actor_user_id, validAdminUuid);
      assert.equal(auditBody.actor_role, "ADMIN");
    });
  });

  describe("Admin Portal instance PATCH route", () => {
    it("updates instance operational status and logs admin audit without JSON parse error", async () => {
      const validAdminUuid = "33333333-4444-5555-6666-777777777777";
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        recordedRequests.push({ url: urlStr, options: init || {} });

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && (!init?.method || init?.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "ACTIVE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "UNAVAILABLE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/audit_logs")) {
          // PostgREST return=minimal returns 201 with empty body
          return new Response("", {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/admin/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": validAdminUuid,
          "x-user-role": "ADMIN",
        },
        body: JSON.stringify({ operationalStatus: "UNAVAILABLE" }),
      });

      const res = await adminPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "UNAVAILABLE");

      const auditRequest = recordedRequests.find((r) => r.url.includes("/audit_logs"));
      assert.ok(auditRequest, "Audit log request should be made");
      const auditBody = JSON.parse(auditRequest.options.body as string);
      assert.equal(auditBody.actor_user_id, validAdminUuid);
      assert.equal(auditBody.actor_role, "ADMIN");
    });

    it("updates instance operational status and falls back to SYSTEM audit when no admin profile exists", async () => {
      const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        recordedRequests.push({ url: urlStr, options: init || {} });

        if (urlStr.includes("/staff_profiles")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && (!init?.method || init?.method === "GET")) {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "ACTIVE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/workspace_instances?id=eq.inst-1") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify([
              {
                id: "inst-1",
                template_id: "tpl-1",
                floor_id: "flr-1",
                instance_code: "D-01",
                display_name: "Desk 01",
                operational_status: "MAINTENANCE",
                template: {
                  id: "tpl-1",
                  name: "Standard Desk",
                  capacity: 1,
                  rate_amount: 50,
                  pricing_unit: "HOURLY",
                  default_shape: "rectangle",
                  default_color: "#333",
                  default_style: {},
                  is_active: true,
                },
                floor: {
                  id: "flr-1",
                  name: "Floor 1",
                  floor_number: 1,
                  display_order: 1,
                  is_active: true,
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes("/reservation_candidates")) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (urlStr.includes("/audit_logs")) {
          return new Response("", {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const req = new Request("http://localhost/api/admin/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationalStatus: "MAINTENANCE" }),
      });

      const res = await adminPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "MAINTENANCE");

      const auditRequest = recordedRequests.find((r) => r.url.includes("/audit_logs"));
      assert.ok(auditRequest, "Audit log request should be made");
      const auditBody = JSON.parse(auditRequest.options.body as string);
      assert.equal(auditBody.actor_user_id, null);
      assert.equal(auditBody.actor_role, "SYSTEM");
    });
  });
});
