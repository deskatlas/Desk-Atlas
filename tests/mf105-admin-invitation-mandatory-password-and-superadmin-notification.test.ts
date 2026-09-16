import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementActor,
  StaffManagementError,
  createAdminNotificationService,
  calculateUnreadCount,
  markAsRead,
  applyReadState,
  validatePassword,
  createAuthService,
  InMemoryAuthRepository,
  type InMemoryUserRecord,
  UnauthorizedError,
  type AdminNotificationItem,
} from "@deskatlas/domain";

describe("MF-105: Admin Invitation Mandatory Password Setup and Super Admin Notification", () => {
  const fixedNow = new Date("2026-09-16T10:00:00.000Z");
  const nowProvider = () => fixedNow;

  const superAdminActor: StaffManagementActor = {
    userId: "super-admin-1",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  it("password policy validation enforces 8+ characters, uppercase, number, and special character", () => {
    // Blank password
    assert.equal(validatePassword("").isValid, false);
    // Too short (< 8 chars)
    assert.equal(validatePassword("Admin1!").isValid, false);
    // Missing uppercase
    assert.equal(validatePassword("password123!").isValid, false);
    // Missing number
    assert.equal(validatePassword("Password!").isValid, false);
    // Missing special character
    assert.equal(validatePassword("Password123").isValid, false);
    // Valid password
    const valid = validatePassword("AdminSecur3!");
    assert.equal(valid.isValid, true);
    assert.equal(valid.errors.length, 0);
  });

  it("super admin invites a new administrator without pre-setting a password", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation, emailSent } = await service.inviteStaff({
      email: "new.admin@deskatlas.com",
      displayName: "New Administrator",
      role: "ADMIN",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    assert.ok(invitation.id);
    assert.equal(invitation.email, "new.admin@deskatlas.com");
    assert.equal(invitation.displayName, "New Administrator");
    assert.equal(invitation.role, "ADMIN");
    assert.equal(invitation.status, "PENDING");
    assert.equal(invitation.verificationCode.length, 6);
    assert.ok(invitation.token.length > 10);
    assert.equal(invitation.createdByAdminId, superAdminActor.userId);
  });

  it("rejects confirmation if permanent password is blank or fails complexity requirements", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "admin.nopass@deskatlas.com",
      displayName: "No Pass Admin",
      role: "ADMIN",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    // Attempting to confirm with weak password fails validation
    await assert.rejects(
      async () => {
        await service.confirmStaffInvitation({
          token: invitation.token,
          verificationCode: invitation.verificationCode,
          password: "weak",
        });
      },
      (err: any) => {
        return (
          err instanceof StaffManagementError &&
          err.message.includes("Password does not meet security requirements")
        );
      }
    );
  });

  it("successful admin activation with custom password creates account, saves password, and records audit event", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "ops.admin@deskatlas.com",
      displayName: "Operations Admin",
      role: "ADMIN",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    const chosenPassword = "OpsAdmin2026!Sec";
    const result = await service.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
      password: chosenPassword,
    });

    assert.ok(result.staff);
    assert.equal(result.staff.email, "ops.admin@deskatlas.com");
    assert.equal(result.staff.name, "Operations Admin");
    assert.equal(result.staff.role, "Admin");
    assert.equal(result.staff.rawRole, "ADMIN");
    assert.equal(result.staff.isActive, true);
    assert.equal(result.invitation.status, "CONFIRMED");

    // Verify audit log entry was created for the invitation acceptance
    const acceptLog = memoryRepo.auditLogs.find(
      (log) => log.action === "ACCEPT_STAFF_INVITATION" && log.entityId === result.staff.id
    );
    assert.ok(acceptLog, "Audit log for ACCEPT_STAFF_INVITATION must be recorded");
    assert.equal(acceptLog.metadata.email, "ops.admin@deskatlas.com");
    assert.equal(acceptLog.metadata.displayName, "Operations Admin");
    assert.equal(acceptLog.metadata.role, "ADMIN");
  });

  it("activated admin can immediately authenticate and re-login after logout using their chosen password", async () => {
    const superAdminUser: InMemoryUserRecord = {
      id: superAdminActor.userId,
      email: "owner@deskatlas.com",
      displayName: "Super Administrator",
      role: "ADMIN",
      password: "SuperAdminPassword123!",
      isActive: true,
    };

    const authRepo = new InMemoryAuthRepository([superAdminUser]);
    const authService = createAuthService(authRepo);

    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const staffService = createStaffManagementService(memoryRepo, nowProvider);

    // 1. Superadmin invites admin
    const { invitation } = await staffService.inviteStaff({
      email: "finance.admin@deskatlas.com",
      displayName: "Finance Admin",
      role: "ADMIN",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    // 2. Admin sets custom password during activation
    const chosenPassword = "Fin4nceSecure!Pass";
    const result = await staffService.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
      password: chosenPassword,
    });

    // Seed auth repo (simulate authentication system synchronization)
    authRepo.seedUser({
      id: result.staff.id,
      email: result.staff.email,
      password: chosenPassword,
      displayName: result.staff.name,
      role: "ADMIN",
      isActive: true,
    });

    // 3. First login succeeds with chosen password
    const loginResult1 = await authService.loginStaff(
      "finance.admin@deskatlas.com",
      chosenPassword
    );
    assert.ok(loginResult1.actor);
    assert.equal(loginResult1.actor.role, "ADMIN");
    assert.ok(loginResult1.token);

    // 4. Wrong password rejected
    await assert.rejects(
      async () => {
        await authService.loginStaff(
          "finance.admin@deskatlas.com",
          "WrongPassword123!"
        );
      },
      (err: any) => err instanceof UnauthorizedError || err.message.includes("Invalid email or password")
    );

    // 5. Subsequent re-login succeeds after logging out
    const loginResult2 = await authService.loginStaff(
      "finance.admin@deskatlas.com",
      chosenPassword
    );
    assert.ok(loginResult2.actor);
    assert.equal(loginResult2.actor.role, "ADMIN");
  });

  it("Super Admin Notification Center surfaces in-app notification when an administrator accepts invitation", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const staffService = createStaffManagementService(memoryRepo, nowProvider);

    // Invite and confirm administrator
    const { invitation } = await staffService.inviteStaff({
      email: "clara.admin@deskatlas.com",
      displayName: "Clara Oswald",
      role: "ADMIN",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    await staffService.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
      password: "ClaraPassword!99",
    });

    // Query notification service using memory audit logs
    const notifService = createAdminNotificationService({
      reportsRepo: {
        async listReportReservations() {
          return [];
        },
        async listReportPaymentAttempts() {
          return [];
        },
      },
      staffOpsRepo: {
        async listOperationalActivity() {
          return [];
        },
      },
      customAuditLogsProvider: async () => {
        return memoryRepo.auditLogs.map((log) => ({
          actorUserId: log.actorUserId,
          actorRole: log.actorRole,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          metadata: log.metadata,
          createdAt: log.createdAt,
        }));
      },
    });

    const result = await notifService.listNotifications(50);
    assert.ok(result.total >= 1);

    const adminJoinedNotif = result.notifications.find(
      (n) => n.type === "ADMIN_INVITATION_ACCEPTED"
    );
    assert.ok(adminJoinedNotif, "ADMIN_INVITATION_ACCEPTED notification must be emitted");
    assert.equal(adminJoinedNotif.title, "New Administrator Joined");
    assert.equal(
      adminJoinedNotif.description,
      "Clara Oswald (clara.admin@deskatlas.com) has accepted your invitation and activated their administrator account."
    );
    assert.equal(adminJoinedNotif.link, "/manage/staff");
    assert.equal(adminJoinedNotif.metadata?.email, "clara.admin@deskatlas.com");
    assert.equal(adminJoinedNotif.metadata?.role, "ADMIN");

    // Unread count tracking
    const unread = calculateUnreadCount(result.notifications, []);
    assert.equal(unread, 1);

    // Mark as read
    const afterRead = markAsRead([], adminJoinedNotif.id);
    const unreadAfter = calculateUnreadCount(result.notifications, afterRead);
    assert.equal(unreadAfter, 0);

    const withReadState = applyReadState(result.notifications, afterRead);
    assert.equal(withReadState.find((n) => n.id === adminJoinedNotif.id)?.read, true);
  });

  it("Staff invitation acceptance surfaces 'New Staff Joined' notification", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
      ],
      nowProvider
    );
    const staffService = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await staffService.inviteStaff({
      email: "rory.staff@deskatlas.com",
      displayName: "Rory Williams",
      role: "STAFF",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    await staffService.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
      password: "RoryPassword!123",
    });

    const notifService = createAdminNotificationService({
      reportsRepo: {
        async listReportReservations() {
          return [];
        },
        async listReportPaymentAttempts() {
          return [];
        },
      },
      staffOpsRepo: {
        async listOperationalActivity() {
          return [];
        },
      },
      customAuditLogsProvider: async () => {
        return memoryRepo.auditLogs.map((log) => ({
          actorUserId: log.actorUserId,
          actorRole: log.actorRole,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          metadata: log.metadata,
          createdAt: log.createdAt,
        }));
      },
    });

    const result = await notifService.listNotifications(50);
    const staffJoinedNotif = result.notifications.find(
      (n) => n.type === "STAFF_INVITATION_ACCEPTED"
    );
    assert.ok(staffJoinedNotif, "STAFF_INVITATION_ACCEPTED notification must be emitted");
    assert.equal(staffJoinedNotif.title, "New Staff Joined");
    assert.equal(
      staffJoinedNotif.description,
      "Rory Williams (rory.staff@deskatlas.com) has accepted your invitation and activated their staff account."
    );
    assert.equal(staffJoinedNotif.link, "/manage/staff");
  });
});
