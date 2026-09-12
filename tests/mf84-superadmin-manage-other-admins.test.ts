import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  createStaffService,
  InMemoryStaffRepository,
  StaffManagementAuthorizationError,
  StaffManagementMemoryRepository,
  StaffManagementActor,
} from "@deskatlas/domain";

describe("MF-84: Superadmin Manage Other Admins and Remove Admin Access", () => {
  const fixedNow = new Date("2026-09-12T12:00:00.000Z");
  const nowProvider = () => fixedNow;

  it("assigns isSuperAdmin = true to the first admin bootstrapping via Google OAuth", async () => {
    const staffRepo = new InMemoryStaffRepository();
    const staffService = createStaffService(staffRepo);

    const initialAdmin = await staffService.setupInitialAdmin({
      userId: "first-superadmin-1",
      email: "first.superadmin@example.com",
      displayName: "First SuperAdmin",
    });

    assert.equal(initialAdmin.role, "ADMIN");
    assert.equal(initialAdmin.isSuperAdmin, true);

    const fetched = await staffRepo.getProfileByUserId("first-superadmin-1");
    assert.equal(fetched?.isSuperAdmin, true);
  });

  it("enforces that only superadmin can create or invite another ADMIN", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-1",
          email: "superadmin@example.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-regular",
          email: "regular.admin@example.com",
          displayName: "Regular Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // 1. Regular Admin attempts to create another ADMIN -> Forbidden
    await assert.rejects(
      async () => {
        await service.createStaff({
          email: "second.admin@example.com",
          displayName: "Second Admin",
          password: "Password123!",
          role: "ADMIN",
          actorUserId: "admin-regular",
          actorRole: "ADMIN",
          actorIsSuperAdmin: false,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.toLowerCase().includes("only the superadmin can add administrator accounts"));
        return true;
      }
    );

    // 2. Regular Admin attempts to invite another ADMIN -> Forbidden
    await assert.rejects(
      async () => {
        await service.inviteStaff({
          email: "invite.admin@example.com",
          displayName: "Invited Admin",
          role: "ADMIN",
          actorUserId: "admin-regular",
          actorRole: "ADMIN",
          actorIsSuperAdmin: false,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.toLowerCase().includes("only the superadmin can invite administrator accounts"));
        return true;
      }
    );

    // 3. Superadmin successfully invites and creates an ADMIN
    const createdAdmin = await service.createStaff({
      email: "new.admin@example.com",
      displayName: "New Admin",
      password: "Password123!",
      role: "ADMIN",
      actorUserId: "superadmin-1",
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });
    assert.equal(createdAdmin.rawRole, "ADMIN");
    assert.equal(createdAdmin.isSuperAdmin, false);

    const { invitation } = await service.inviteStaff({
      email: "invited.admin@example.com",
      displayName: "Invited Admin",
      role: "ADMIN",
      actorUserId: "superadmin-1",
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });
    assert.equal(invitation.role, "ADMIN");
  });

  it("superadmin can list all admins and staff, while regular admin only sees staff created by them", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-1",
          email: "superadmin@example.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-2",
          email: "admin2@example.com",
          displayName: "Admin Two",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdByAdminId: "superadmin-1",
        },
        {
          id: "staff-super",
          email: "staff.super@example.com",
          displayName: "Staff Super",
          role: "STAFF",
          isActive: true,
          createdByAdminId: "superadmin-1",
        },
        {
          id: "staff-admin2",
          email: "staff.admin2@example.com",
          displayName: "Staff Admin2",
          role: "STAFF",
          isActive: true,
          createdByAdminId: "admin-2",
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Superadmin listing
    const superList = await service.listStaff({
      userId: "superadmin-1",
      role: "ADMIN",
      isSuperAdmin: true,
    });
    assert.equal(superList.length, 4);
    // Superadmin is first
    assert.equal(superList[0].id, "superadmin-1");
    assert.equal(superList[0].isSuperAdmin, true);

    // Regular admin 2 listing -> only their own staff
    const admin2List = await service.listStaff({
      userId: "admin-2",
      role: "ADMIN",
      isSuperAdmin: false,
    });
    assert.equal(admin2List.length, 1);
    assert.equal(admin2List[0].id, "staff-admin2");
  });

  it("superadmin can remove admin access (demote to STAFF) and manage other admins", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-1",
          email: "superadmin@example.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-2",
          email: "admin2@example.com",
          displayName: "Admin Two",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Superadmin demotes Admin Two to STAFF ("Remove Admin Access")
    const demoted = await service.updateStaff({
      staffUserId: "admin-2",
      role: "STAFF",
      actorUserId: "superadmin-1",
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    assert.equal(demoted.rawRole, "STAFF");
    assert.equal(demoted.role, "Staff");

    // Superadmin can also deactivate demoted account or other admins
    const deactivated = await service.updateStaff({
      staffUserId: "admin-2",
      isActive: false,
      actorUserId: "superadmin-1",
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });
    assert.equal(deactivated.isActive, false);
  });

  it("protects superadmin from demotion, deactivation, and deletion", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-1",
          email: "superadmin@example.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-2",
          email: "admin2@example.com",
          displayName: "Admin Two",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // 1. Attempt to demote superadmin to STAFF -> Forbidden
    await assert.rejects(
      async () => {
        await service.updateStaff({
          staffUserId: "superadmin-1",
          role: "STAFF",
          actorUserId: "superadmin-1",
          actorRole: "ADMIN",
          actorIsSuperAdmin: true,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.includes("The superadmin account role cannot be changed or demoted"));
        return true;
      }
    );

    // 2. Attempt to deactivate superadmin -> Forbidden
    await assert.rejects(
      async () => {
        await service.updateStaff({
          staffUserId: "superadmin-1",
          isActive: false,
          actorUserId: "superadmin-1",
          actorRole: "ADMIN",
          actorIsSuperAdmin: true,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.includes("The superadmin account cannot be deactivated"));
        return true;
      }
    );

    // 3. Attempt to delete superadmin -> Blocked
    const eligibility = await service.checkStaffDeletionEligibility("superadmin-1", {
      userId: "superadmin-1",
      role: "ADMIN",
      isSuperAdmin: true,
    });
    assert.equal(eligibility.canDelete, false);
    assert.equal(eligibility.reason, "Superadmin account cannot be deleted.");

    await assert.rejects(
      async () => {
        await service.deleteStaff("superadmin-1", {
          userId: "superadmin-1",
          role: "ADMIN",
          isSuperAdmin: true,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.includes("Superadmin account cannot be deleted"));
        return true;
      }
    );
  });

  it("prevents regular admins from modifying or deleting other admin accounts", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: "superadmin-1",
          email: "superadmin@example.com",
          displayName: "Super Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "admin-2",
          email: "admin2@example.com",
          displayName: "Admin Two",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
        {
          id: "admin-3",
          email: "admin3@example.com",
          displayName: "Admin Three",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // Admin 2 tries to modify Admin 3
    await assert.rejects(
      async () => {
        await service.updateStaff({
          staffUserId: "admin-3",
          displayName: "Hacked Name",
          actorUserId: "admin-2",
          actorRole: "ADMIN",
          actorIsSuperAdmin: false,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.toLowerCase().includes("only the superadmin can manage administrator accounts"));
        return true;
      }
    );

    // Admin 2 tries to delete Admin 3
    await assert.rejects(
      async () => {
        await service.deleteStaff("admin-3", {
          userId: "admin-2",
          role: "ADMIN",
          isSuperAdmin: false,
        });
      },
      (err: any) => {
        assert(err instanceof StaffManagementAuthorizationError);
        assert(err.message.toLowerCase().includes("only the superadmin can delete administrator accounts"));
        return true;
      }
    );
  });
});
