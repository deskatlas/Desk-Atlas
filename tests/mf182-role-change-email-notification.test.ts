import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  type StaffManagementActor,
  type TransactionalEmailService,
  renderRoleChangeNotificationEmail,
  type RoleChangeNotificationEmailInput,
} from "@deskatlas/domain";

describe("MF-182: Role Change Notification Email for Staff and Admin Accounts", () => {
  const fixedNow = new Date("2026-09-23T10:00:00.000Z");
  const nowProvider = () => fixedNow;

  const superAdminActor: StaffManagementActor = {
    userId: "usr-superadmin",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  const adminActor: StaffManagementActor = {
    userId: "usr-admin-ops",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  // --------------------------------------------------------------------------
  // 1. Template Rendering Unit Tests
  // --------------------------------------------------------------------------

  describe("renderRoleChangeNotificationEmail", () => {
    it("renders email correctly when a team member is promoted from STAFF to ADMIN", () => {
      const input: RoleChangeNotificationEmailInput = {
        to: "elena.rostova@deskatlas.com",
        displayName: "Elena Rostova",
        previousRole: "STAFF",
        newRole: "ADMIN",
        updatedByAdminName: "Super Administrator",
        updatedAt: "2026-09-23T10:00:00.000Z",
        loginUrl: "http://localhost:3000/manage/login",
        portalName: "Admin Portal",
      };

      const rendered = renderRoleChangeNotificationEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] Account Update: Your Role is Now Admin"
      );
      assert.ok(rendered.html.includes("Elena Rostova"));
      assert.ok(rendered.html.includes("Staff"));
      assert.ok(rendered.html.includes("Admin"));
      assert.ok(rendered.html.includes("Super Administrator"));
      assert.ok(rendered.html.includes("Admin Portal"));
      assert.ok(rendered.html.includes("Sign In to Admin Portal"));
      assert.ok(rendered.html.includes("http://localhost:3000/manage/login"));
      assert.ok(rendered.html.includes("administrative management"));

      assert.ok(rendered.text.includes("Elena Rostova"));
      assert.ok(rendered.text.includes("Previous Role: Staff"));
      assert.ok(rendered.text.includes("New Role: Admin"));
      assert.ok(rendered.text.includes("Updated By: Super Administrator"));
      assert.ok(rendered.text.includes("Admin Portal Access:"));
      assert.ok(rendered.text.includes("http://localhost:3000/manage/login"));
    });

    it("renders email correctly when an admin is demoted from ADMIN to STAFF", () => {
      const input: RoleChangeNotificationEmailInput = {
        to: "marcus.vance@deskatlas.com",
        displayName: "Marcus Vance",
        previousRole: "ADMIN",
        newRole: "STAFF",
        updatedByAdminName: "Super Administrator",
        updatedAt: "2026-09-23T10:00:00.000Z",
        loginUrl: "http://localhost:3002/manage",
        portalName: "Staff Dashboard",
      };

      const rendered = renderRoleChangeNotificationEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] Account Update: Your Role is Now Staff"
      );
      assert.ok(rendered.html.includes("Marcus Vance"));
      assert.ok(rendered.html.includes("Admin"));
      assert.ok(rendered.html.includes("Staff"));
      assert.ok(rendered.html.includes("Staff Dashboard"));
      assert.ok(rendered.html.includes("Sign In to Staff Dashboard"));
      assert.ok(rendered.html.includes("http://localhost:3002/manage"));
      assert.ok(!rendered.html.includes("/manage/login"));
      assert.ok(rendered.html.includes("front-desk operations"));

      assert.ok(rendered.text.includes("Marcus Vance"));
      assert.ok(rendered.text.includes("Previous Role: Admin"));
      assert.ok(rendered.text.includes("New Role: Staff"));
      assert.ok(rendered.text.includes("Staff Dashboard Access:"));
      assert.ok(rendered.text.includes("http://localhost:3002/manage"));
      assert.ok(!rendered.text.includes("/manage/login"));
    });

    it("respects custom business settings profile", () => {
      const input: RoleChangeNotificationEmailInput = {
        to: "sarah.connor@example.com",
        displayName: "Sarah Connor",
        previousRole: "STAFF",
        newRole: "ADMIN",
        businessSettings: {
          businessName: "Cyberdyne Workspaces",
          contactEmail: "help@cyberdyne.io",
          contactPhone: "+1 800 555 0199",
        },
      };

      const rendered = renderRoleChangeNotificationEmail(input);

      assert.equal(
        rendered.subject,
        "[Cyberdyne Workspaces] Account Update: Your Role is Now Admin"
      );
      assert.ok(rendered.html.includes("Cyberdyne Workspaces"));
      assert.ok(rendered.html.includes("help@cyberdyne.io"));
      assert.ok(rendered.html.includes("+1 800 555 0199"));
      assert.ok(rendered.text.includes("Cyberdyne Workspaces"));
      assert.ok(rendered.text.includes("help@cyberdyne.io"));
    });
  });

  // --------------------------------------------------------------------------
  // 2. Service Integration Tests with Mocked Email Service
  // --------------------------------------------------------------------------

  describe("StaffManagementService Role Change Triggers", () => {
    it("dispatches sendRoleChangeNotificationEmail with Admin Portal URL when promoted from STAFF to ADMIN", async () => {
      const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

      const mockEmailService = {
        sendEmail: async () => ({ success: true, id: "msg-1" }),
        sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
          sentRoleChangeEmails.push(input);
          return { success: true, id: "msg-role-change-1" };
        },
        sendAccountDeactivatedEmail: async () => ({ success: true }),
        sendAccountReactivatedEmail: async () => ({ success: true }),
        sendTeamMemberJoinedEmail: async () => ({ success: true }),
      } as unknown as TransactionalEmailService;

      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: "usr-superadmin",
            email: "superadmin@deskatlas.com",
            displayName: "Super Admin",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: true,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
          {
            id: "usr-staff-1",
            email: "staff.member@deskatlas.com",
            displayName: "Staff Member",
            role: "STAFF",
            isActive: true,
            isSuperAdmin: false,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
        ],
        nowProvider
      );

      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-staff-1",
        role: "ADMIN",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(updated.rawRole, "ADMIN");
      assert.equal(sentRoleChangeEmails.length, 1);
      assert.equal(sentRoleChangeEmails[0].to, "staff.member@deskatlas.com");
      assert.equal(sentRoleChangeEmails[0].displayName, "Staff Member");
      assert.equal(sentRoleChangeEmails[0].previousRole, "STAFF");
      assert.equal(sentRoleChangeEmails[0].newRole, "ADMIN");
      assert.equal(sentRoleChangeEmails[0].portalName, "Admin Portal");
      assert.ok(sentRoleChangeEmails[0].loginUrl?.includes(":3000") || sentRoleChangeEmails[0].loginUrl?.includes("/manage/login"));
      assert.equal(sentRoleChangeEmails[0].updatedByAdminName, "Super Admin");
    });

    it("dispatches sendRoleChangeNotificationEmail with Staff Dashboard URL when demoted from ADMIN to STAFF", async () => {
      const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

      const mockEmailService = {
        sendEmail: async () => ({ success: true, id: "msg-1" }),
        sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
          sentRoleChangeEmails.push(input);
          return { success: true, id: "msg-role-change-2" };
        },
        sendAccountDeactivatedEmail: async () => ({ success: true }),
        sendAccountReactivatedEmail: async () => ({ success: true }),
        sendTeamMemberJoinedEmail: async () => ({ success: true }),
      } as unknown as TransactionalEmailService;

      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: "usr-superadmin",
            email: "superadmin@deskatlas.com",
            displayName: "Super Admin",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: true,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
          {
            id: "usr-admin-2",
            email: "admin.two@deskatlas.com",
            displayName: "Admin Two",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: false,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
        ],
        nowProvider
      );

      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-admin-2",
        role: "STAFF",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(updated.rawRole, "STAFF");
      assert.equal(sentRoleChangeEmails.length, 1);
      assert.equal(sentRoleChangeEmails[0].to, "admin.two@deskatlas.com");
      assert.equal(sentRoleChangeEmails[0].displayName, "Admin Two");
      assert.equal(sentRoleChangeEmails[0].previousRole, "ADMIN");
      assert.equal(sentRoleChangeEmails[0].newRole, "STAFF");
      assert.equal(sentRoleChangeEmails[0].portalName, "Staff Dashboard");
      assert.equal(sentRoleChangeEmails[0].loginUrl, "http://localhost:3002/manage");
      assert.ok(!sentRoleChangeEmails[0].loginUrl?.includes("/manage/login"));
    });

    it("does NOT dispatch role change email when other fields are updated without role change", async () => {
      const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

      const mockEmailService = {
        sendEmail: async () => ({ success: true, id: "msg-1" }),
        sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
          sentRoleChangeEmails.push(input);
          return { success: true, id: "msg-role-change-3" };
        },
        sendAccountDeactivatedEmail: async () => ({ success: true }),
        sendAccountReactivatedEmail: async () => ({ success: true }),
        sendTeamMemberJoinedEmail: async () => ({ success: true }),
      } as unknown as TransactionalEmailService;

      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: "usr-superadmin",
            email: "superadmin@deskatlas.com",
            displayName: "Super Admin",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: true,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
          {
            id: "usr-staff-1",
            email: "staff.member@deskatlas.com",
            displayName: "Staff Member",
            role: "STAFF",
            isActive: true,
            isSuperAdmin: false,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
        ],
        nowProvider
      );

      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      // 1. Update display name only
      await service.updateStaff({
        staffUserId: "usr-staff-1",
        displayName: "Staff Member Updated",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(sentRoleChangeEmails.length, 0);

      // 2. Explicitly pass same role STAFF
      await service.updateStaff({
        staffUserId: "usr-staff-1",
        role: "STAFF",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(sentRoleChangeEmails.length, 0);
    });

    it("does not block role update if email sending encounters an error", async () => {
      const mockEmailService = {
        sendEmail: async () => ({ success: true, id: "msg-1" }),
        sendRoleChangeNotificationEmail: async () => {
          throw new Error("Resend network outage");
        },
        sendAccountDeactivatedEmail: async () => ({ success: true }),
        sendAccountReactivatedEmail: async () => ({ success: true }),
        sendTeamMemberJoinedEmail: async () => ({ success: true }),
      } as unknown as TransactionalEmailService;

      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: "usr-superadmin",
            email: "superadmin@deskatlas.com",
            displayName: "Super Admin",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: true,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
          {
            id: "usr-staff-1",
            email: "staff.member@deskatlas.com",
            displayName: "Staff Member",
            role: "STAFF",
            isActive: true,
            isSuperAdmin: false,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
        ],
        nowProvider
      );

      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-staff-1",
        role: "ADMIN",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(updated.rawRole, "ADMIN");
    });

    it("ensures role change email is sent to actual member email even if update repository returns unknown@deskatlas.com", async () => {
      const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

      const mockEmailService = {
        sendEmail: async () => ({ success: true, id: "msg-1" }),
        sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
          sentRoleChangeEmails.push(input);
          return { success: true, id: "msg-role-change-4" };
        },
      } as unknown as TransactionalEmailService;

      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: "usr-superadmin",
            email: "superadmin@deskatlas.com",
            displayName: "Super Admin",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: true,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
          {
            id: "usr-staff-real-email",
            email: "actual.user@domain.com",
            displayName: "Actual User",
            role: "STAFF",
            isActive: true,
            isSuperAdmin: false,
            createdAt: fixedNow.toISOString(),
            updatedAt: fixedNow.toISOString(),
          },
        ],
        nowProvider
      );

      // Simulate a repository where updateStaff returns 'unknown@deskatlas.com'
      const originalUpdate = memoryRepo.updateStaff.bind(memoryRepo);
      memoryRepo.updateStaff = async (input) => {
        const res = await originalUpdate(input);
        return {
          ...res,
          email: "unknown@deskatlas.com",
        };
      };

      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-staff-real-email",
        role: "ADMIN",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(sentRoleChangeEmails.length, 1);
      assert.equal(sentRoleChangeEmails[0].to, "actual.user@domain.com");
      assert.equal(updated.email, "actual.user@domain.com");
    });
  });
});
