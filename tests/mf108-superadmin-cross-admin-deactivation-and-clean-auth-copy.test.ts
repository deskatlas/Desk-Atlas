import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementAuthorizationError,
  StaffManagementActor,
  loginRateLimiter,
} from "@deskatlas/domain";
import { POST as staffLoginPost } from "../apps/staff-dashboard/src/app/api/auth/login/route";
import { POST as adminLoginPost } from "../apps/admin-portal/src/app/api/admin/auth/login/route";

describe("MF-108: Super Admin Cross-Admin Deactivation & Clean Auth Copy", () => {
  const fixedNow = new Date("2026-09-16T12:00:00.000Z");
  const nowProvider = () => fixedNow;

  const originalFetch = global.fetch;
  const originalEnvUrl = process.env.SUPABASE_URL;
  const originalEnvKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    loginRateLimiter.reset();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SUPABASE_URL = originalEnvUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnvKey;
  });

  const superAdminActor: StaffManagementActor = {
    userId: "superadmin-root",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  const adminAlphaActor: StaffManagementActor = {
    userId: "admin-alpha",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  const adminBetaActor: StaffManagementActor = {
    userId: "admin-beta",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  it("allows Super Admin to deactivate and reactivate staff member created by another admin", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
          createdByAdminId: null,
        },
        {
          id: adminAlphaActor.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: superAdminActor.userId,
        },
        {
          id: adminBetaActor.userId,
          email: "admin.beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: superAdminActor.userId,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin Alpha creates a staff member
    const staffCreatedByAlpha = await service.createStaff({
      email: "staff.alpha@deskatlas.com",
      displayName: "Staff Alpha",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminAlphaActor.userId,
      actorRole: adminAlphaActor.role,
      actorIsSuperAdmin: false,
    });
    assert.equal(staffCreatedByAlpha.createdByAdminId, adminAlphaActor.userId);
    assert.equal(staffCreatedByAlpha.isActive, true);

    // Super Admin deactivates staff member created by Admin Alpha
    const deactivated = await service.deactivateStaff(staffCreatedByAlpha.id, superAdminActor);
    assert.equal(deactivated.isActive, false);
    assert.equal(deactivated.status, "Inactive");

    // Super Admin reactivates staff member created by Admin Alpha
    const reactivated = await service.activateStaff(staffCreatedByAlpha.id, superAdminActor);
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.status, "Active");
  });

  it("allows regular admin to deactivate and manage staff member created by another admin", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminAlphaActor.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: "some-superadmin",
        },
        {
          id: adminBetaActor.userId,
          email: "admin.beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: "some-superadmin",
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin Alpha creates a staff member
    const staffCreatedByAlpha = await service.createStaff({
      email: "staff.team@deskatlas.com",
      displayName: "Staff Team",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminAlphaActor.userId,
      actorRole: adminAlphaActor.role,
      actorIsSuperAdmin: false,
    });

    // Admin Beta deactivates Admin Alpha's staff member -> allowed
    const deactivated = await service.deactivateStaff(staffCreatedByAlpha.id, adminBetaActor);
    assert.equal(deactivated.isActive, false);
    assert.equal(deactivated.status, "Inactive");

    // Admin Beta reactivates Admin Alpha's staff member -> allowed
    const reactivated = await service.activateStaff(staffCreatedByAlpha.id, adminBetaActor);
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.status, "Active");
  });

  it("allows Super Admin without explicit actorIsSuperAdmin parameter in deactivation call to deactivate cross-admin staff", async () => {
    const rootAdminActor: StaffManagementActor = {
      userId: "root-superadmin",
      role: "ADMIN",
      isSuperAdmin: true,
    };

    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: rootAdminActor.userId,
          email: "root@deskatlas.com",
          displayName: "Root Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
          createdByAdminId: null,
        },
        {
          id: adminAlphaActor.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: rootAdminActor.userId,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin Alpha creates a staff member
    const staff = await service.createStaff({
      email: "staff.sub@deskatlas.com",
      displayName: "Staff Sub",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminAlphaActor.userId,
      actorRole: adminAlphaActor.role,
      actorIsSuperAdmin: false,
    });

    // Root admin deactivates staff without explicit actorIsSuperAdmin parameter
    const deactivated = await service.deactivateStaff(staff.id, rootAdminActor);
    assert.equal(deactivated.isActive, false);
    assert.equal(deactivated.status, "Inactive");
  });

  it("staff login endpoint returns 'Account deactivated or not authorized' with rate limit countdown", async () => {
    const testEmail = "deactivated.staff@deskatlas.com";

    // Mock fetch to simulate RPC returning deactivated account error
    global.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("verify_staff_login")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "This account has been deactivated",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    };

    const req = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.108.1",
      },
      body: JSON.stringify({
        email: testEmail,
        password: "Password123!",
      }),
    });

    const initialRate = loginRateLimiter.checkRateLimit("staff", testEmail, "192.168.108.1");
    assert.equal(initialRate.remainingAttempts, 3);

    const res = await staffLoginPost(req as any);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Account deactivated or not authorized. 2 attempts remaining.");
    assert.equal(body.attemptsRemaining, 2);

    // Rate limiter remaining attempts should have been decremented
    const postRate = loginRateLimiter.checkRateLimit("staff", testEmail, "192.168.108.1");
    assert.equal(postRate.remainingAttempts, 2);
  });

  it("admin login endpoint returns 'Account deactivated or not authorized' with rate limit countdown", async () => {
    const testEmail = "deactivated.admin@deskatlas.com";

    // Mock fetch to simulate RPC returning deactivated error
    global.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("verify_staff_login")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "This account has been deactivated",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    };

    const req = new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.108.2",
      },
      body: JSON.stringify({
        email: testEmail,
        password: "Password123!",
      }),
    });

    const initialRate = loginRateLimiter.checkRateLimit("admin", testEmail, "192.168.108.2");
    assert.equal(initialRate.remainingAttempts, 3);

    const res = await adminLoginPost(req as any);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Account deactivated or not authorized. 2 attempts remaining.");
    assert.equal(body.attemptsRemaining, 2);

    // Rate limiter remaining attempts should have been decremented
    const postRate = loginRateLimiter.checkRateLimit("admin", testEmail, "192.168.108.2");
    assert.equal(postRate.remainingAttempts, 2);
  });

  it("admin login endpoint retains countdown attempts message for invalid credentials on active account", async () => {
    const testEmail = "active.admin@deskatlas.com";

    // Mock fetch to simulate RPC returning invalid credentials error
    global.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("verify_staff_login")) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid email or password",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    };

    const req = new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.168.108.3",
      },
      body: JSON.stringify({
        email: testEmail,
        password: "WrongPassword!",
      }),
    });

    const res = await adminLoginPost(req as any);

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Invalid email or password. 2 attempts remaining.");
    assert.equal(body.attemptsRemaining, 2);

    const postRate = loginRateLimiter.checkRateLimit("admin", testEmail, "192.168.108.3");
    assert.equal(postRate.remainingAttempts, 2);
  });
});
