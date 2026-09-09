import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementAuthorizationError,
  StaffManagementMemoryRepository,
  StaffManagementActor,
} from "@deskatlas/domain";

describe("MF-44: Admin-Scoped Staff Accounts", () => {
  const fixedNow = new Date("2026-09-08T12:00:00.000Z");
  const nowProvider = () => fixedNow;

  const adminA: StaffManagementActor = { userId: "admin-alpha", role: "ADMIN" };
  const adminB: StaffManagementActor = { userId: "admin-beta", role: "ADMIN" };
  const staffMemberActor: StaffManagementActor = { userId: "staff-charlie", role: "STAFF" };

  it("records creating admin ID on staff creation and scopes staff listings per admin", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminA.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
        },
        {
          id: adminB.userId,
          email: "admin.beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin A creates two staff members
    const staffA1 = await service.createStaff({
      email: "alice@deskatlas.com",
      displayName: "Alice Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });
    assert.equal(staffA1.createdByAdminId, adminA.userId);

    const staffA2 = await service.createStaff({
      email: "alex@deskatlas.com",
      displayName: "Alex Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });
    assert.equal(staffA2.createdByAdminId, adminA.userId);

    // Admin B creates one staff member
    const staffB1 = await service.createStaff({
      email: "bob@deskatlas.com",
      displayName: "Bob Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminB.userId,
      actorRole: adminB.role,
    });
    assert.equal(staffB1.createdByAdminId, adminB.userId);

    // Admin A queries staff: only returns staff created by Admin A
    const listA = await service.listStaff(adminA);
    assert.equal(listA.length, 2);
    assert.deepEqual(
      listA.map((s) => s.email).sort(),
      ["alex@deskatlas.com", "alice@deskatlas.com"]
    );

    // Admin B queries staff: only returns staff created by Admin B
    const listB = await service.listStaff(adminB);
    assert.equal(listB.length, 1);
    assert.equal(listB[0].email, "bob@deskatlas.com");
  });

  it("denies cross-admin viewing, updating, and deactivation", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminA.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
        },
        {
          id: adminB.userId,
          email: "admin.beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin A creates staff member
    const staffA = await service.createStaff({
      email: "claire@deskatlas.com",
      displayName: "Claire Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });

    // Admin B cannot view staff created by Admin A via getStaffById with actor
    await assert.rejects(
      () => service.getStaffById(staffA.id, adminB),
      StaffManagementAuthorizationError
    );

    // Admin B cannot update staff created by Admin A
    await assert.rejects(
      () =>
        service.updateStaff({
          staffUserId: staffA.id,
          displayName: "Hacked Name",
          actorUserId: adminB.userId,
          actorRole: adminB.role,
        }),
      StaffManagementAuthorizationError
    );

    // Admin B cannot deactivate staff created by Admin A
    await assert.rejects(
      () => service.deactivateStaff(staffA.id, adminB),
      StaffManagementAuthorizationError
    );
  });

  it("preserves ownership immutability across legitimate updates", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminA.userId,
          email: "admin.alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const staffA = await service.createStaff({
      email: "daniel@deskatlas.com",
      displayName: "Daniel Staff",
      password: "Password123!",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });
    assert.equal(staffA.createdByAdminId, adminA.userId);

    // Admin A legitimately updates staff
    const updated = await service.updateStaff({
      staffUserId: staffA.id,
      displayName: "Daniel Senior Staff",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });
    assert.equal(updated.name, "Daniel Senior Staff");
    assert.equal(updated.createdByAdminId, adminA.userId);

    // Admin A deactivates and reactivates staff
    const deactivated = await service.deactivateStaff(staffA.id, adminA);
    assert.equal(deactivated.isActive, false);
    assert.equal(deactivated.status, "Inactive");
    assert.equal(deactivated.createdByAdminId, adminA.userId);

    const reactivated = await service.activateStaff(staffA.id, adminA);
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.status, "Active");
    assert.equal(reactivated.createdByAdminId, adminA.userId);
  });

  it("denies non-admin accounts from managing staff", async () => {
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Staff cannot list staff
    await assert.rejects(
      () => service.listStaff(staffMemberActor),
      StaffManagementAuthorizationError
    );

    // Staff cannot create staff
    await assert.rejects(
      () =>
        service.createStaff({
          email: "eve@deskatlas.com",
          displayName: "Eve Staff",
          password: "Password123!",
          role: "STAFF",
          actorUserId: staffMemberActor.userId,
          actorRole: staffMemberActor.role,
        }),
      StaffManagementAuthorizationError
    );
  });
});
