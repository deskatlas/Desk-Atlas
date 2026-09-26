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

describe("MS-02: Staff Dashboard Login Redirect URL 404 Correction", () => {
  const fixedNow = new Date("2026-09-23T10:00:00.000Z");
  const nowProvider = () => fixedNow;

  const superAdminActor: StaffManagementActor = {
    userId: "usr-superadmin",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  // --------------------------------------------------------------------------
  // QAD-TC15.1: Role change notification from ADMIN to STAFF
  // --------------------------------------------------------------------------
  it("QAD-TC15.1: dispatches role change notification to STAFF with loginUrl pointing strictly to staffBaseUrl/manage", async () => {
    const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

    const mockEmailService = {
      sendEmail: async () => ({ success: true, id: "msg-1" }),
      sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
        sentRoleChangeEmails.push(input);
        return { success: true, id: "msg-role-change-1" };
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
          id: "usr-admin-demote",
          email: "demoted.admin@deskatlas.com",
          displayName: "Demoted Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
          createdAt: fixedNow.toISOString(),
          updatedAt: fixedNow.toISOString(),
        },
      ],
      nowProvider
    );

    const prevStaffUrl = process.env.STAFF_PORTAL_URL;
    process.env.STAFF_PORTAL_URL = "https://staff.thedeskatlas.com";

    try {
      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-admin-demote",
        role: "STAFF",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(updated.rawRole, "STAFF");
      assert.equal(sentRoleChangeEmails.length, 1);
      assert.equal(sentRoleChangeEmails[0].to, "demoted.admin@deskatlas.com");
      assert.equal(sentRoleChangeEmails[0].previousRole, "ADMIN");
      assert.equal(sentRoleChangeEmails[0].newRole, "STAFF");
      assert.equal(sentRoleChangeEmails[0].portalName, "Staff Dashboard");
      assert.equal(sentRoleChangeEmails[0].loginUrl, "https://staff.thedeskatlas.com/manage");
      assert.ok(!sentRoleChangeEmails[0].loginUrl?.includes("/manage/login"));
    } finally {
      if (prevStaffUrl === undefined) {
        delete process.env.STAFF_PORTAL_URL;
      } else {
        process.env.STAFF_PORTAL_URL = prevStaffUrl;
      }
    }
  });

  // --------------------------------------------------------------------------
  // QAD-TC15.2: Role change notification from STAFF to ADMIN
  // --------------------------------------------------------------------------
  it("QAD-TC15.2: dispatches role change notification to ADMIN with loginUrl pointing to adminBaseUrl/manage/login", async () => {
    const sentRoleChangeEmails: RoleChangeNotificationEmailInput[] = [];

    const mockEmailService = {
      sendEmail: async () => ({ success: true, id: "msg-1" }),
      sendRoleChangeNotificationEmail: async (input: RoleChangeNotificationEmailInput) => {
        sentRoleChangeEmails.push(input);
        return { success: true, id: "msg-role-change-2" };
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
          id: "usr-staff-promote",
          email: "promoted.staff@deskatlas.com",
          displayName: "Promoted Staff",
          role: "STAFF",
          isActive: true,
          isSuperAdmin: false,
          createdAt: fixedNow.toISOString(),
          updatedAt: fixedNow.toISOString(),
        },
      ],
      nowProvider
    );

    const prevAdminUrl = process.env.ADMIN_PORTAL_URL;
    process.env.ADMIN_PORTAL_URL = "https://admin.thedeskatlas.com";

    try {
      const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

      const updated = await service.updateStaff({
        staffUserId: "usr-staff-promote",
        role: "ADMIN",
        actorUserId: superAdminActor.userId,
        actorRole: superAdminActor.role,
        actorIsSuperAdmin: superAdminActor.isSuperAdmin,
      });

      assert.equal(updated.rawRole, "ADMIN");
      assert.equal(sentRoleChangeEmails.length, 1);
      assert.equal(sentRoleChangeEmails[0].to, "promoted.staff@deskatlas.com");
      assert.equal(sentRoleChangeEmails[0].previousRole, "STAFF");
      assert.equal(sentRoleChangeEmails[0].newRole, "ADMIN");
      assert.equal(sentRoleChangeEmails[0].portalName, "Admin Portal");
      assert.equal(sentRoleChangeEmails[0].loginUrl, "https://admin.thedeskatlas.com/manage/login");
    } finally {
      if (prevAdminUrl === undefined) {
        delete process.env.ADMIN_PORTAL_URL;
      } else {
        process.env.ADMIN_PORTAL_URL = prevAdminUrl;
      }
    }
  });

  // --------------------------------------------------------------------------
  // QAD-TC15.3: Fallback URL without explicit loginUrl input for STAFF
  // --------------------------------------------------------------------------
  it("QAD-TC15.3: defaults loginUrl to http://localhost:3002/manage when input.loginUrl is omitted for STAFF role", () => {
    const inputWithoutLoginUrl: RoleChangeNotificationEmailInput = {
      to: "staff.fallback@deskatlas.com",
      displayName: "Staff Fallback",
      previousRole: "ADMIN",
      newRole: "STAFF",
      updatedByAdminName: "Super Admin",
      updatedAt: fixedNow.toISOString(),
    };

    const rendered = renderRoleChangeNotificationEmail(inputWithoutLoginUrl);

    assert.ok(rendered.html.includes("http://localhost:3002/manage"));
    assert.ok(!rendered.html.includes("/manage/login"));
    assert.ok(rendered.text.includes("http://localhost:3002/manage"));
    assert.ok(!rendered.text.includes("/manage/login"));
  });

  // --------------------------------------------------------------------------
  // QAD-TC15.4: HTML and plaintext email content inspection
  // --------------------------------------------------------------------------
  it("QAD-TC15.4: renders CTA button and body copy with /manage and zero occurrences of /manage/login for STAFF", () => {
    const input: RoleChangeNotificationEmailInput = {
      to: "marcus.vance@deskatlas.com",
      displayName: "Marcus Vance",
      previousRole: "ADMIN",
      newRole: "STAFF",
      updatedByAdminName: "Super Administrator",
      updatedAt: fixedNow.toISOString(),
      loginUrl: "https://staff.thedeskatlas.com/manage",
      portalName: "Staff Dashboard",
    };

    const rendered = renderRoleChangeNotificationEmail(input);

    assert.equal(
      rendered.subject,
      "[DeskAtlas] Account Update: Your Role is Now Staff"
    );

    // HTML assertions
    assert.ok(rendered.html.includes("href=\"https://staff.thedeskatlas.com/manage\""));
    assert.ok(rendered.html.includes("Sign In to Staff Dashboard"));
    assert.ok(rendered.html.includes("Staff Dashboard Access:"));
    assert.ok(!rendered.html.includes("/manage/login"), "HTML email must contain zero occurrences of /manage/login");

    // Plaintext assertions
    assert.ok(rendered.text.includes("Staff Dashboard Access:"));
    assert.ok(rendered.text.includes("Sign In to Staff Dashboard:\nhttps://staff.thedeskatlas.com/manage"));
    assert.ok(rendered.text.includes("https://staff.thedeskatlas.com/manage"));
    assert.ok(!rendered.text.includes("/manage/login"), "Plaintext email must contain zero occurrences of /manage/login");
  });
});
