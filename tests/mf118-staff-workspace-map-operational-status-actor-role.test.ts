import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { PATCH as staffPatchInstance } from "../apps/staff-dashboard/src/app/api/operations/workspaces/instances/[instanceId]/route";
import { PATCH as adminPatchInstance } from "../apps/admin-portal/src/app/api/admin/workspaces/instances/[instanceId]/route";
import { updateStaffInstanceOperationalStatus } from "../apps/staff-dashboard/src/app/lib/publishedMapApi";

describe("MF-118: Staff Workspace Map Operational Status Update Actor Role Alignment Fix", () => {
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

  function createMockSupabaseFetch(options: {
    staffProfiles: Array<{ user_id: string; role: string; is_active?: boolean; is_super_admin?: boolean }>;
    onAuditLog?: (entry: any) => void;
  }) {
    const recordedRequests: Array<{ url: string; options: RequestInit }> = [];

    const mockFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      recordedRequests.push({ url: urlStr, options: init || {} });

      if (urlStr.includes("/staff_profiles")) {
        // Find matching profile based on query
        let matched = [...options.staffProfiles];
        const userIdMatch = urlStr.match(/user_id=eq\.([0-9a-f-]+)/i);
        if (userIdMatch) {
          matched = matched.filter((p) => p.user_id === userIdMatch[1]);
        }
        const roleMatch = urlStr.match(/role=eq\.([A-Z]+)/i);
        if (roleMatch) {
          matched = matched.filter((p) => p.role === roleMatch[1]);
        }
        const activeMatch = urlStr.match(/is_active=eq\.(true|false)/i);
        if (activeMatch) {
          const isActiveVal = activeMatch[1] === "true";
          matched = matched.filter((p) => (p.is_active ?? true) === isActiveVal);
        }

        return new Response(JSON.stringify(matched), {
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
                name: "Hot Desk",
                capacity: 1,
                rate_amount: 50,
                pricing_unit: "HOURLY",
                default_shape: "rectangle",
                default_color: "#009689",
                default_style: {},
                is_active: true,
              },
              floor: {
                id: "flr-1",
                name: "Ground Floor",
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
        const parsedBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify([
            {
              id: "inst-1",
              template_id: "tpl-1",
              floor_id: "flr-1",
              instance_code: "D-01",
              display_name: "Desk 01",
              operational_status: parsedBody.operational_status ?? "MAINTENANCE",
              template: {
                id: "tpl-1",
                name: "Hot Desk",
                capacity: 1,
                rate_amount: 50,
                pricing_unit: "HOURLY",
                default_shape: "rectangle",
                default_color: "#009689",
                default_style: {},
                is_active: true,
              },
              floor: {
                id: "flr-1",
                name: "Ground Floor",
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
        const auditEntry = JSON.parse(init?.body as string);
        if (options.onAuditLog) {
          options.onAuditLog(auditEntry);
        }

        // Simulate PostgreSQL database trigger trg_audit_logs_actor_valid
        if (auditEntry.actor_user_id) {
          const profile = options.staffProfiles.find((p) => p.user_id === auditEntry.actor_user_id);
          if (profile && profile.role !== auditEntry.actor_role) {
            return new Response(
              JSON.stringify({
                code: "P0001",
                details: null,
                hint: null,
                message: `Audit actor_role ${auditEntry.actor_role} does not match staff role ${profile.role}`,
              }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
        }

        return new Response("", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    return { mockFetch, recordedRequests };
  }

  describe("Staff Dashboard Operational Status Route (PATCH)", () => {
    it("successfully logs audit with actor_role 'ADMIN' when an ADMIN changes operational status", async () => {
      const adminUserId = "aaaaaaaa-1111-2222-3333-444444444444";
      let loggedEntry: any = null;

      const { mockFetch, recordedRequests } = createMockSupabaseFetch({
        staffProfiles: [
          { user_id: adminUserId, role: "ADMIN", is_active: true },
        ],
        onAuditLog: (entry) => {
          loggedEntry = entry;
        },
      });
      global.fetch = mockFetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": adminUserId,
          "x-user-role": "ADMIN",
        },
        body: JSON.stringify({
          operationalStatus: "MAINTENANCE",
          actor: { userId: adminUserId, role: "ADMIN" },
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "MAINTENANCE");
      assert.ok(loggedEntry, "Audit log should have been captured");
      assert.equal(loggedEntry.actor_user_id, adminUserId);
      assert.equal(loggedEntry.actor_role, "ADMIN");
    });

    it("successfully logs audit with actor_role 'ADMIN' when a SUPERADMIN changes operational status", async () => {
      const superadminUserId = "bbbbbbbb-1111-2222-3333-444444444444";
      let loggedEntry: any = null;

      const { mockFetch } = createMockSupabaseFetch({
        staffProfiles: [
          { user_id: superadminUserId, role: "ADMIN", is_super_admin: true, is_active: true },
        ],
        onAuditLog: (entry) => {
          loggedEntry = entry;
        },
      });
      global.fetch = mockFetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": superadminUserId,
          "x-user-role": "SUPERADMIN",
        },
        body: JSON.stringify({
          operationalStatus: "INACTIVE",
          actor: { userId: superadminUserId, role: "SUPERADMIN" },
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "INACTIVE");
      assert.ok(loggedEntry);
      assert.equal(loggedEntry.actor_user_id, superadminUserId);
      assert.equal(loggedEntry.actor_role, "ADMIN");
    });

    it("successfully logs audit with actor_role 'STAFF' when a STAFF member changes operational status", async () => {
      const staffUserId = "cccccccc-1111-2222-3333-444444444444";
      let loggedEntry: any = null;

      const { mockFetch } = createMockSupabaseFetch({
        staffProfiles: [
          { user_id: staffUserId, role: "STAFF", is_active: true },
        ],
        onAuditLog: (entry) => {
          loggedEntry = entry;
        },
      });
      global.fetch = mockFetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": staffUserId,
          "x-user-role": "STAFF",
        },
        body: JSON.stringify({
          operationalStatus: "ACTIVE",
          actor: { userId: staffUserId, role: "STAFF" },
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.instance.operationalStatus, "ACTIVE");
      assert.ok(loggedEntry);
      assert.equal(loggedEntry.actor_user_id, staffUserId);
      assert.equal(loggedEntry.actor_role, "STAFF");
    });

    it("dynamically queries staff_profiles and avoids P0001 trigger error when actorRole is omitted from request body", async () => {
      const adminUserId = "dddddddd-1111-2222-3333-444444444444";
      let loggedEntry: any = null;

      const { mockFetch } = createMockSupabaseFetch({
        staffProfiles: [
          { user_id: adminUserId, role: "ADMIN", is_active: true },
        ],
        onAuditLog: (entry) => {
          loggedEntry = entry;
        },
      });
      global.fetch = mockFetch;

      // Request body only sends operationalStatus, header sends x-user-id
      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": adminUserId,
        },
        body: JSON.stringify({
          operationalStatus: "MAINTENANCE",
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      assert.ok(loggedEntry);
      assert.equal(loggedEntry.actor_user_id, adminUserId);
      assert.equal(loggedEntry.actor_role, "ADMIN");
    });

    it("falls back to querying staff_profiles with user_id and role when no actor userId is given", async () => {
      const defaultStaffUserId = "eeeeeeee-1111-2222-3333-444444444444";
      let loggedEntry: any = null;

      const { mockFetch } = createMockSupabaseFetch({
        staffProfiles: [
          { user_id: defaultStaffUserId, role: "STAFF", is_active: true },
        ],
        onAuditLog: (entry) => {
          loggedEntry = entry;
        },
      });
      global.fetch = mockFetch;

      const req = new Request("http://localhost/api/operations/workspaces/instances/inst-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationalStatus: "MAINTENANCE",
        }),
      });

      const res = await staffPatchInstance(req, {
        params: Promise.resolve({ instanceId: "inst-1" }),
      });

      assert.equal(res.status, 200);
      assert.ok(loggedEntry);
      assert.equal(loggedEntry.actor_user_id, defaultStaffUserId);
      assert.equal(loggedEntry.actor_role, "STAFF");
    });
  });

  describe("API Client Helper updateStaffInstanceOperationalStatus", () => {
    it("attaches actor userId and role in both headers and body", async () => {
      let capturedRequest: { url: string; headers: Headers; body: any } | null = null;

      global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        capturedRequest = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(init?.body as string),
        };
        return new Response(
          JSON.stringify({
            instance: { id: "inst-1", operationalStatus: "MAINTENANCE" },
            availability: { isBookable: false },
            affectedFutureReservations: [],
            auditLogged: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const result = await updateStaffInstanceOperationalStatus("inst-1", "MAINTENANCE", {
        userId: "12345678-1234-1234-1234-123456789012",
        role: "ADMIN",
      });

      assert.equal(result.instance.operationalStatus, "MAINTENANCE");
      assert.ok(capturedRequest);
      assert.equal(capturedRequest.headers.get("x-user-id"), "12345678-1234-1234-1234-123456789012");
      assert.equal(capturedRequest.headers.get("x-user-role"), "ADMIN");
      assert.equal(capturedRequest.body.operationalStatus, "MAINTENANCE");
      assert.equal(capturedRequest.body.actorUserId, "12345678-1234-1234-1234-123456789012");
      assert.equal(capturedRequest.body.actorRole, "ADMIN");
    });
  });
});
