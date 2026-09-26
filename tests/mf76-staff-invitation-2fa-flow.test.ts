import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementAuthorizationError,
  StaffManagementMemoryRepository,
  StaffManagementActor,
  StaffManagementError,
  StaffInvitationInvalidCodeError,
} from "@deskatlas/domain";

describe("Staff Invitation with Email & 2FA Confirmation", () => {
  const fixedNow = new Date("2026-09-08T12:00:00.000Z");
  const nowProvider = () => fixedNow;

  const adminA: StaffManagementActor = { userId: "admin-alpha", role: "ADMIN" };
  const adminB: StaffManagementActor = { userId: "admin-beta", role: "ADMIN" };

  it("admin invites staff, generates 6-digit code and secure token, and records pending invitation", async () => {
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

    const { invitation } = await service.inviteStaff({
      email: "newstaff@deskatlas.com",
      displayName: "New Staff Member",
      role: "STAFF",
      password: "Password123!",
      actorUserId: adminA.userId,
      actorRole: adminA.role,
    });

    assert.equal(invitation.email, "newstaff@deskatlas.com");
    assert.equal(invitation.displayName, "New Staff Member");
    assert.equal(invitation.role, "STAFF");
    assert.equal(invitation.status, "PENDING");
    assert.equal(invitation.verificationCode.length, 6);
    assert.ok(/^\d{6}$/.test(invitation.verificationCode));
    assert.ok(invitation.token.length > 10);
    assert.equal(invitation.createdByAdminId, adminA.userId);

    // Invitation is listed in pending invitations for Admin A
    const pending = await service.listPendingInvitations(adminA);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, invitation.id);
  });

  it("retrieves invitation details by token", async () => {
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "staff.token@deskatlas.com",
      displayName: "Token Staff",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: "ADMIN",
    });

    const retrieved = await service.getStaffInvitationByToken(invitation.token);
    assert.ok(retrieved);
    assert.equal(retrieved.id, invitation.id);
    assert.equal(retrieved.email, "staff.token@deskatlas.com");
  });

  it("rejects confirmation if verification code does not match", async () => {
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "staff.wrongcode@deskatlas.com",
      displayName: "Wrong Code Staff",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: "ADMIN",
    });

    await assert.rejects(
      async () => {
        await service.confirmStaffInvitation({
          token: invitation.token,
          verificationCode: "000000", // Wrong code
        });
      },
      (err: any) => {
        return err.message.includes("Invalid verification code");
      }
    );
  });

  it("successfully finalizes staff account upon correct 2FA code submission", async () => {
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "staff.success@deskatlas.com",
      displayName: "Success Staff",
      role: "STAFF",
      password: "InitialPassword123!",
      actorUserId: adminA.userId,
      actorRole: "ADMIN",
    });

    const result = await service.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
    });

    assert.ok(result.staff);
    assert.equal(result.staff.email, "staff.success@deskatlas.com");
    assert.equal(result.staff.name, "Success Staff");
    assert.equal(result.staff.isActive, true);
    assert.equal(result.staff.createdByAdminId, adminA.userId);
    assert.equal(result.invitation.status, "CONFIRMED");

    // Staff is now in the active staff list for Admin A
    const activeStaff = await service.listStaff(adminA);
    const found = activeStaff.find((s) => s.email === "staff.success@deskatlas.com");
    assert.ok(found);
    assert.equal(found.name, "Success Staff");

    // Attempting to confirm again fails
    await assert.rejects(
      async () => {
        await service.confirmStaffInvitation({
          token: invitation.token,
          verificationCode: invitation.verificationCode,
        });
      },
      (err: any) => err.message.includes("confirmed")
    );
  });

  it("admin can cancel/revoke a pending invitation", async () => {
    const memoryRepo = new StaffManagementMemoryRepository([], nowProvider);
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "staff.revoke@deskatlas.com",
      displayName: "Revoke Staff",
      role: "STAFF",
      actorUserId: adminA.userId,
      actorRole: "ADMIN",
    });

    // Cross-admin cancel is allowed
    const cancelled = await service.cancelStaffInvitation(invitation.id, adminB);
    assert.equal(cancelled, true);

    // Confirming cancelled invitation fails
    await assert.rejects(
      async () => {
        await service.confirmStaffInvitation({
          token: invitation.token,
          verificationCode: invitation.verificationCode,
        });
      },
      (err: any) => err.message.includes("cancelled")
    );
  });
});
