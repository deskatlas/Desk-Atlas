import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AuthError,
  DeactivatedAccountError,
  ForbiddenError,
  InMemoryAuthRepository,
  UnauthorizedError,
  createAuthService,
  type AuthActor,
  type InMemoryUserRecord,
} from "@deskatlas/domain";

describe("t11: Authentication & Security Boundaries", () => {
  const adminUser: InMemoryUserRecord = {
    id: "user-admin-1",
    email: "admin@deskatlas.com",
    password: "SuperAdminPassword123!",
    role: "ADMIN",
    displayName: "Lead Admin",
    isActive: true,
  };

  const staffUser: InMemoryUserRecord = {
    id: "user-staff-1",
    email: "staff@deskatlas.com",
    password: "StaffPassword123!",
    role: "STAFF",
    displayName: "Frontdesk Staff",
    isActive: true,
  };

  const deactivatedStaff: InMemoryUserRecord = {
    id: "user-staff-inactive",
    email: "inactive.staff@deskatlas.com",
    password: "OldPassword123!",
    role: "STAFF",
    displayName: "Inactive Staff",
    isActive: false,
  };

  it("authenticates users with valid credentials and blocks invalid passwords (M17)", async () => {
    const authRepo = new InMemoryAuthRepository([adminUser, staffUser, deactivatedStaff]);
    const authService = createAuthService(authRepo);

    // Valid admin login
    const adminSession = await authService.loginStaff(adminUser.email, adminUser.password);
    assert.equal(adminSession.actor.role, "ADMIN");
    assert.ok(adminSession.token);

    // Valid staff login
    const staffSession = await authService.loginStaff(staffUser.email, staffUser.password);
    assert.equal(staffSession.actor.role, "STAFF");

    // Invalid password
    await assert.rejects(
      () => authService.loginStaff(adminUser.email, "WrongPassword!"),
      UnauthorizedError
    );

    // Deactivated account rejected
    await assert.rejects(
      () => authService.loginStaff(deactivatedStaff.email, deactivatedStaff.password),
      DeactivatedAccountError
    );
  });

  it("enforces role-based access control (Admin vs Staff vs Anonymous) (M17)", async () => {
    const authRepo = new InMemoryAuthRepository([adminUser, staffUser]);
    const authService = createAuthService(authRepo);

    const adminSession = await authService.loginStaff(adminUser.email, adminUser.password);
    const staffSession = await authService.loginStaff(staffUser.email, staffUser.password);

    const adminActor: AuthActor = adminSession.actor;
    const staffActor: AuthActor = staffSession.actor;

    // Admin passes both admin and staff gates
    const adminPass = await authService.requireAdmin(adminActor);
    assert.equal(adminPass.role, "ADMIN");
    const staffAdminPass = await authService.requireStaffOrAdmin(adminActor);
    assert.equal(staffAdminPass.role, "ADMIN");

    // Staff passes staff gate, rejected from admin gate
    const staffPass = await authService.requireStaffOrAdmin(staffActor);
    assert.equal(staffPass.role, "STAFF");
    await assert.rejects(() => authService.requireAdmin(staffActor), ForbiddenError);

    // Anonymous actor rejected from both gates
    await assert.rejects(() => authService.requireAdmin(null), UnauthorizedError);
    await assert.rejects(() => authService.requireStaffOrAdmin(null), UnauthorizedError);
  });
});
