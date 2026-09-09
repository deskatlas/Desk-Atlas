import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  createAuthService,
  StaffManagementMemoryRepository,
  StaffManagementAuthorizationError,
  StaffManagementConflictError,
  StaffManagementError,
  InMemoryAuthRepository,
  DeactivatedAccountError,
  type InMemoryUserRecord,
} from "@deskatlas/domain";

describe("MF-45: Staff Account Deactivation, Reactivation & Deletion Guard", () => {
  const adminActor = { userId: "admin-root", role: "ADMIN" as const };
  const staffActor = { userId: "staff-sub", role: "STAFF" as const };

  it("admin can deactivate staff account, which sets is_active = false and logs audit", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    // Create staff member
    const staff = await service.createStaff({
      email: "sam.clerk@deskatlas.com",
      displayName: "Sam Clerk",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });
    assert.equal(staff.isActive, true);
    assert.equal(staff.status, "Active");

    // Deactivate staff
    const deactivated = await service.deactivateStaff(staff.id, adminActor);
    assert.equal(deactivated.isActive, false);
    assert.equal(deactivated.status, "Inactive");

    // Verify repository state
    const retrieved = await service.getStaffById(staff.id);
    assert.ok(retrieved);
    assert.equal(retrieved.isActive, false);
    assert.equal(retrieved.status, "Inactive");

    // Verify audit log
    const deactivateAudit = memoryRepo.auditLogs.find(
      (a) => a.action === "DEACTIVATE_STAFF_ACCOUNT" && a.entityId === staff.id
    );
    assert.ok(deactivateAudit, "Audit log for DEACTIVATE_STAFF_ACCOUNT must exist");
    assert.equal(deactivateAudit.actorUserId, adminActor.userId);
  });

  it("deactivated staff cannot log in (denied via DeactivatedAccountError)", async () => {
    const testStaff: InMemoryUserRecord = {
      id: "staff-inactive-1",
      email: "inactive@deskatlas.com",
      password: "Password123!",
      role: "STAFF",
      displayName: "Inactive Staff",
      isActive: false,
    };

    const authRepo = new InMemoryAuthRepository([testStaff]);
    const authService = createAuthService(authRepo);

    // Attempting login with correct password on inactive account must throw DeactivatedAccountError
    await assert.rejects(
      () => authService.loginStaff(testStaff.email, testStaff.password),
      DeactivatedAccountError
    );

    // Authenticate request context with inactive user also blocked
    const inactiveActor = { ...testStaff };
    await assert.rejects(
      () => authService.requireStaffOrAdmin(inactiveActor),
      DeactivatedAccountError
    );
  });

  it("admin can reactivate staff account, restoring is_active = true, audit log, and login", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    const staff = await service.createStaff({
      email: "sarah.rehire@deskatlas.com",
      displayName: "Sarah Rehire",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });

    // 1. Deactivate
    await service.deactivateStaff(staff.id, adminActor);

    // 2. Reactivate
    const reactivated = await service.activateStaff(staff.id, adminActor);
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.status, "Active");

    const retrieved = await service.getStaffById(staff.id);
    assert.ok(retrieved);
    assert.equal(reactivated.isActive, true);

    // Verify REACTIVATE_STAFF_ACCOUNT audit log
    const reactivateAudit = memoryRepo.auditLogs.find(
      (a) => a.action === "REACTIVATE_STAFF_ACCOUNT" && a.entityId === staff.id
    );
    assert.ok(reactivateAudit, "Audit log for REACTIVATE_STAFF_ACCOUNT must exist");

    // Verify auth login works for active user
    const authUser: InMemoryUserRecord = {
      id: staff.id,
      email: staff.email,
      password: "Password123!",
      role: "STAFF",
      displayName: staff.name,
      isActive: true,
    };
    const authRepo = new InMemoryAuthRepository([authUser]);
    const authService = createAuthService(authRepo);
    const session = await authService.loginStaff(authUser.email, authUser.password);
    assert.equal(session.actor.id, staff.id);
    assert.equal(session.actor.isActive, true);
  });

  it("operational lists exclude deactivated staff while admin list includes all staff", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    const activeStaff = await service.createStaff({
      email: "active@deskatlas.com",
      displayName: "Active Worker",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });

    const deactivatedStaff = await service.createStaff({
      email: "deactivated@deskatlas.com",
      displayName: "Deactivated Worker",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });
    await service.deactivateStaff(deactivatedStaff.id, adminActor);

    // listActiveStaff (operational list) only returns active staff
    const activeList = await service.listActiveStaff(adminActor);
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].id, activeStaff.id);
    assert.equal(activeList[0].isActive, true);

    // listStaff (admin management list) returns both for auditing / management
    const allList = await service.listStaff(adminActor);
    assert.equal(allList.length, 2);
    assert.ok(allList.some((s) => s.id === deactivatedStaff.id && !s.isActive));
  });

  it("hard-delete is blocked if historical references exist (audit logs, reservations, payments)", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    // 1. Staff with audit log references
    const staffWithAudit = await service.createStaff({
      email: "audited.staff@deskatlas.com",
      displayName: "Audited Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });

    // Simulate audit log created by this staff member
    memoryRepo.auditLogs.push({
      id: "audit-1",
      actorUserId: staffWithAudit.id,
      actorRole: "STAFF",
      action: "CONFIRM_KIOSK_PAYMENT",
      entityType: "payment_attempts",
      entityId: "pay-1",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    // Check deletion eligibility
    const checkAudit = await service.checkStaffDeletionEligibility(staffWithAudit.id);
    assert.equal(checkAudit.canDelete, false);
    assert.ok(checkAudit.reason?.includes("audit log"));

    // Attempting delete must throw StaffManagementConflictError
    await assert.rejects(
      () => service.deleteStaff(staffWithAudit.id, adminActor),
      StaffManagementConflictError
    );

    // 2. Staff with reservation references
    const staffWithReservations = await service.createStaff({
      email: "res.staff@deskatlas.com",
      displayName: "Reservation Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });
    memoryRepo.setStaffReservationReferences(staffWithReservations.id, 3);

    const checkRes = await service.checkStaffDeletionEligibility(staffWithReservations.id);
    assert.equal(checkRes.canDelete, false);
    assert.ok(checkRes.reason?.includes("reservation"));

    await assert.rejects(
      () => service.deleteStaff(staffWithReservations.id, adminActor),
      StaffManagementConflictError
    );

    // 3. Staff with payment references
    const staffWithPayments = await service.createStaff({
      email: "pay.staff@deskatlas.com",
      displayName: "Payment Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });
    memoryRepo.setStaffPaymentReferences(staffWithPayments.id, 2);

    const checkPay = await service.checkStaffDeletionEligibility(staffWithPayments.id);
    assert.equal(checkPay.canDelete, false);
    assert.ok(checkPay.reason?.includes("payment"));

    await assert.rejects(
      () => service.deleteStaff(staffWithPayments.id, adminActor),
      StaffManagementConflictError
    );
  });

  it("hard-delete succeeds when staff has zero historical references", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    // Create staff member without actorUserId (so zero audit logs created)
    const freshStaff = await service.createStaff({
      email: "brandnew@deskatlas.com",
      displayName: "Brand New Staff",
      password: "Password123!",
      role: "STAFF",
    });

    const check = await service.checkStaffDeletionEligibility(freshStaff.id);
    assert.equal(check.canDelete, true);
    assert.equal(check.references?.total, 0);

    // Delete staff
    const deleteResult = await service.deleteStaff(freshStaff.id, adminActor);
    assert.equal(deleteResult.success, true);

    // Verify record removed
    const retrieved = await service.getStaffById(freshStaff.id);
    assert.equal(retrieved, null);
  });

  it("non-admin users cannot deactivate or delete staff accounts", async () => {
    const memoryRepo = new StaffManagementMemoryRepository();
    const service = createStaffManagementService(memoryRepo);

    const staff = await service.createStaff({
      email: "worker@deskatlas.com",
      displayName: "Worker",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });

    // Staff actor rejected from deactivating
    await assert.rejects(
      () => service.deactivateStaff(staff.id, staffActor),
      StaffManagementAuthorizationError
    );

    // Staff actor rejected from deleting
    await assert.rejects(
      () => service.deleteStaff(staff.id, staffActor),
      StaffManagementAuthorizationError
    );
  });
});
