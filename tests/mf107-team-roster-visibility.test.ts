import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementAuthorizationError,
  StaffManagementMemoryRepository,
  StaffManagementActor,
} from "@deskatlas/domain";

describe("MF-107: Admin Portal Team Roster Full Visibility for All Administrators and Staff", () => {
  const fixedNow = new Date("2026-09-16T08:00:00.000Z");
  const nowProvider = () => fixedNow;

  const superAdminActor: StaffManagementActor = {
    userId: "superadmin-root",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  const adminOneActor: StaffManagementActor = {
    userId: "admin-alpha",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  const adminTwoActor: StaffManagementActor = {
    userId: "admin-beta",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  const staffActor: StaffManagementActor = {
    userId: "staff-1",
    role: "STAFF",
  };

  it("non-superadmin administrator can view Super Admin, co-admins, and all staff accounts (not blank for new admins)", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-root",
          email: "superadmin@deskatlas.com",
          displayName: "Root Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "admin-alpha",
          email: "alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: "superadmin-root",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
        {
          id: "admin-beta",
          email: "beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: "superadmin-root",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "staff-1",
          email: "staff1@deskatlas.com",
          displayName: "Staff One",
          role: "STAFF",
          isActive: true,
          createdByAdminId: "admin-alpha",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
        {
          id: "staff-2",
          email: "staff2@deskatlas.com",
          displayName: "Staff Two",
          role: "STAFF",
          isActive: true,
          createdByAdminId: "superadmin-root",
          createdAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      nowProvider
    );

    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin Beta (who has created 0 staff members themselves) lists staff
    const roster = await service.listStaff(adminTwoActor);

    // Roster is NOT blank; returns all 5 team members
    assert.equal(roster.length, 5);

    // Verify ordering: Super Admin first, then Admins chronologically, then Staff chronologically
    assert.equal(roster[0].id, "superadmin-root");
    assert.equal(roster[0].isSuperAdmin, true);
    assert.equal(roster[0].email, "superadmin@deskatlas.com");

    assert.equal(roster[1].id, "admin-alpha");
    assert.equal(roster[1].rawRole, "ADMIN");
    assert.equal(roster[1].email, "alpha@deskatlas.com");

    assert.equal(roster[2].id, "admin-beta");
    assert.equal(roster[2].rawRole, "ADMIN");
    assert.equal(roster[2].email, "beta@deskatlas.com");

    assert.equal(roster[3].id, "staff-1");
    assert.equal(roster[3].rawRole, "STAFF");
    assert.equal(roster[3].email, "staff1@deskatlas.com");

    assert.equal(roster[4].id, "staff-2");
    assert.equal(roster[4].rawRole, "STAFF");
    assert.equal(roster[4].email, "staff2@deskatlas.com");
  });

  it("non-superadmin administrator cannot demote, edit, or deactivate co-admins or Super Admin, but can manage all staff", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-root",
          email: "superadmin@deskatlas.com",
          displayName: "Root Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-alpha",
          email: "alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
        {
          id: "admin-beta",
          email: "beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
        {
          id: "staff-super-created",
          email: "staff.super@deskatlas.com",
          displayName: "Staff Created By Super",
          role: "STAFF",
          isActive: true,
          createdByAdminId: "superadmin-root",
        },
      ],
      nowProvider
    );

    const service = createStaffManagementService(memoryRepo, nowProvider);

    // 1. Admin Alpha tries to demote Admin Beta to STAFF -> Rejected
    await assert.rejects(
      () =>
        service.updateStaff({
          staffUserId: "admin-beta",
          role: "STAFF",
          actorUserId: adminOneActor.userId,
          actorRole: adminOneActor.role,
          actorIsSuperAdmin: false,
        }),
      StaffManagementAuthorizationError
    );

    // 2. Admin Alpha tries to deactivate Admin Beta -> Rejected
    await assert.rejects(
      () => service.deactivateStaff("admin-beta", adminOneActor),
      StaffManagementAuthorizationError
    );

    // 3. Admin Alpha tries to deactivate or demote Super Admin -> Rejected
    await assert.rejects(
      () => service.deactivateStaff("superadmin-root", adminOneActor),
      StaffManagementAuthorizationError
    );
    await assert.rejects(
      () =>
        service.updateStaff({
          staffUserId: "superadmin-root",
          role: "STAFF",
          actorUserId: adminOneActor.userId,
          actorRole: adminOneActor.role,
          actorIsSuperAdmin: false,
        }),
      StaffManagementAuthorizationError
    );

    // 4. Admin Alpha CAN manage staff created by superadmin or other admins (cross-admin staff management)
    const updatedStaff = await service.updateStaff({
      staffUserId: "staff-super-created",
      displayName: "Updated Staff Name",
      actorUserId: adminOneActor.userId,
      actorRole: adminOneActor.role,
      actorIsSuperAdmin: false,
    });
    assert.equal(updatedStaff.name, "Updated Staff Name");

    const deactivatedStaff = await service.deactivateStaff("staff-super-created", adminOneActor);
    assert.equal(deactivatedStaff.isActive, false);

    // 5. Super Admin CAN manage super admin (update name) and demote Admin Beta
    const updatedSuper = await service.updateStaff({
      staffUserId: "superadmin-root",
      displayName: "Updated Superadmin Name",
      actorUserId: superAdminActor.userId,
      actorRole: superAdminActor.role,
      actorIsSuperAdmin: true,
    });
    assert.equal(updatedSuper.name, "Updated Superadmin Name");

    const demoted = await service.updateStaff({
      staffUserId: "admin-beta",
      role: "STAFF",
      actorUserId: superAdminActor.userId,
      actorRole: superAdminActor.role,
      actorIsSuperAdmin: true,
    });
    assert.equal(demoted.rawRole, "STAFF");
  });

  it("all active administrators can see all pending invitations across the organization", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-root",
          email: "superadmin@deskatlas.com",
          displayName: "Root Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-alpha",
          email: "alpha@deskatlas.com",
          displayName: "Admin Alpha",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
        {
          id: "admin-beta",
          email: "beta@deskatlas.com",
          displayName: "Admin Beta",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );

    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Super Admin invites an administrator
    await service.inviteStaff({
      email: "new.admin@deskatlas.com",
      displayName: "New Admin",
      role: "ADMIN",
      actorUserId: "superadmin-root",
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    // Admin Alpha invites a staff member
    await service.inviteStaff({
      email: "new.staff@deskatlas.com",
      displayName: "New Staff",
      role: "STAFF",
      actorUserId: "admin-alpha",
      actorRole: "ADMIN",
      actorIsSuperAdmin: false,
    });

    // Admin Beta lists pending invitations -> sees BOTH pending invitations
    const invitations = await service.listPendingInvitations(adminTwoActor);
    assert.equal(invitations.length, 2);
    assert.deepEqual(
      invitations.map((i) => i.email).sort(),
      ["new.admin@deskatlas.com", "new.staff@deskatlas.com"]
    );
  });

  it("rejects non-admin and inactive admin profiles from viewing staff management", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "admin-inactive",
          email: "inactive.admin@deskatlas.com",
          displayName: "Inactive Admin",
          role: "ADMIN",
          isActive: false,
          isSuperAdmin: false,
        },
        {
          id: "staff-1",
          email: "staff1@deskatlas.com",
          displayName: "Staff One",
          role: "STAFF",
          isActive: true,
        },
      ],
      nowProvider
    );

    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Inactive admin rejected
    await assert.rejects(
      () =>
        service.listStaff({
          userId: "admin-inactive",
          role: "ADMIN",
        }),
      StaffManagementAuthorizationError
    );

    // Staff member rejected
    await assert.rejects(
      () => service.listStaff(staffActor),
      StaffManagementAuthorizationError
    );

    // Inactive admin rejected from invitations
    await assert.rejects(
      () =>
        service.listPendingInvitations({
          userId: "admin-inactive",
          role: "ADMIN",
        }),
      StaffManagementAuthorizationError
    );
  });
});
