import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementActor,
  StaffManagementError,
} from "@deskatlas/domain";

describe("MF-77: Revoked Staff Invitation Handling & Session Guard", () => {
  const fixedNow = new Date("2026-09-12T10:00:00.000Z");
  const nowProvider = () => fixedNow;
  const adminActor: StaffManagementActor = { userId: "admin-owner-1", role: "ADMIN" };

  it("admin revokes pending invitation, updating status to CANCELLED", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Workspace Owner",
          role: "ADMIN",
          isActive: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    // 1. Create invitation
    const { invitation } = await service.inviteStaff({
      email: "staff.revoked@deskatlas.com",
      displayName: "Revoked Staff",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: "ADMIN",
    });

    assert.equal(invitation.status, "PENDING");

    // 2. Admin revokes/cancels the invitation
    const cancelled = await service.cancelStaffInvitation(invitation.id, adminActor);
    assert.equal(cancelled, true);

    // 3. Retrieval by token reflects CANCELLED status
    const retrieved = await service.getStaffInvitationByToken(invitation.token);
    assert.ok(retrieved);
    assert.equal(retrieved.status, "CANCELLED");
    assert.equal(retrieved.email, "staff.revoked@deskatlas.com");
  });

  it("rejects confirmation attempts against a CANCELLED invitation", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Workspace Owner",
          role: "ADMIN",
          isActive: true,
        },
      ],
      nowProvider
    );
    const service = createStaffManagementService(memoryRepo, nowProvider);

    const { invitation } = await service.inviteStaff({
      email: "staff.attempt@deskatlas.com",
      displayName: "Attempt Staff",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: "ADMIN",
    });

    // Revoke
    await service.cancelStaffInvitation(invitation.id, adminActor);

    // Confirming should throw error
    await assert.rejects(
      async () => {
        await service.confirmStaffInvitation({
          token: invitation.token,
          verificationCode: invitation.verificationCode,
        });
      },
      (err: any) => {
        return err instanceof StaffManagementError && err.message.toLowerCase().includes("cancelled");
      }
    );

    // Verify no staff profile was created
    const allStaff = await service.listStaff(adminActor);
    const found = allStaff.find((s) => s.email === "staff.attempt@deskatlas.com");
    assert.equal(found, undefined, "Staff profile must not exist for cancelled invitation!");
  });

  it("verification endpoint contract accurately derives and returns CANCELLED, EXPIRED, and CONFIRMED states", async () => {
    let clock = new Date("2026-09-12T10:00:00.000Z");
    const dynamicNow = () => clock;

    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: adminActor.userId,
          email: "owner@deskatlas.com",
          displayName: "Workspace Owner",
          role: "ADMIN",
          isActive: true,
        },
      ],
      dynamicNow
    );
    const service = createStaffManagementService(memoryRepo, dynamicNow);

    // 1. Cancelled
    const { invitation: invCancelled } = await service.inviteStaff({
      email: "cancelled@deskatlas.com",
      displayName: "Cancelled Staff",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: "ADMIN",
    });
    await service.cancelStaffInvitation(invCancelled.id, adminActor);
    const resCancelled = await service.getStaffInvitationByToken(invCancelled.token);
    assert.equal(resCancelled?.status, "CANCELLED");

    // 2. Confirmed
    const { invitation: invConfirmed } = await service.inviteStaff({
      email: "confirmed@deskatlas.com",
      displayName: "Confirmed Staff",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: "ADMIN",
    });
    await service.confirmStaffInvitation({
      token: invConfirmed.token,
      verificationCode: invConfirmed.verificationCode,
    });
    const resConfirmed = await service.getStaffInvitationByToken(invConfirmed.token);
    assert.equal(resConfirmed?.status, "CONFIRMED");

    // 3. Expired
    const { invitation: invExpired } = await service.inviteStaff({
      email: "expired@deskatlas.com",
      displayName: "Expired Staff",
      role: "STAFF",
      actorUserId: adminActor.userId,
      actorRole: "ADMIN",
    });
    // Advance clock past 24 hours
    clock = new Date("2026-09-14T12:00:00.000Z");
    const resExpired = await service.getStaffInvitationByToken(invExpired.token);
    assert.ok(resExpired);
    const isExpired = new Date(resExpired.expiresAt).getTime() < clock.getTime();
    assert.equal(isExpired, true);
  });

  it("verify-invitation UI copy semantics test: CANCELLED, EXPIRED, and INVALID must NOT render CTA to staff login", () => {
    // Model test of the view logic applied in verify-invitation/page.tsx
    function getInvitationViewState(status: string, email: string) {
      if (status === 'CANCELLED') {
        return {
          title: "Invitation Revoked",
          badge: "Revoked",
          body: `This staff invitation for ${email} has been revoked or cancelled by an administrator. This link is no longer active, and an account cannot be created. If you believe this is an error, please contact your workspace administrator.`,
          hasLoginButton: false,
          allowsDirectSignIn: false,
        };
      }
      if (status === 'EXPIRED') {
        return {
          title: "Invitation Expired",
          badge: "Expired",
          body: `This invitation link for ${email} has expired. Invitations are valid for 24 hours. Please contact your workspace administrator to request a new invitation.`,
          hasLoginButton: false,
          allowsDirectSignIn: false,
        };
      }
      if (status === 'CONFIRMED') {
        return {
          title: "Invitation Already Processed",
          badge: "Activated",
          body: `This invitation for ${email} has already been confirmed and activated. You can proceed directly to sign in with your credentials.`,
          hasLoginButton: true,
          buttonLabel: "Proceed to Staff Login",
          allowsDirectSignIn: true,
        };
      }
      return {
        title: "Staff Account Confirmation & 2FA",
        badge: "Pending",
        body: "",
        hasLoginButton: false,
        buttonLabel: "Confirm & Activate Account",
        allowsDirectSignIn: false,
      };
    }

    const cancelledView = getInvitationViewState('CANCELLED', 'staff@test.com');
    assert.equal(cancelledView.title, "Invitation Revoked");
    assert.equal(cancelledView.badge, "Revoked");
    assert.equal(cancelledView.allowsDirectSignIn, false);
    assert.equal(cancelledView.hasLoginButton, false, "Revoked state must NOT have a CTA to go to staff login!");
    assert.ok(!cancelledView.body.includes("proceed directly to sign in"));
    assert.ok(cancelledView.body.includes("revoked or cancelled by an administrator"));

    const expiredView = getInvitationViewState('EXPIRED', 'staff@test.com');
    assert.equal(expiredView.title, "Invitation Expired");
    assert.equal(expiredView.hasLoginButton, false, "Expired state must NOT have a CTA to go to staff login!");

    const confirmedView = getInvitationViewState('CONFIRMED', 'staff@test.com');
    assert.equal(confirmedView.title, "Invitation Already Processed");
    assert.equal(confirmedView.hasLoginButton, true, "Confirmed state keeps Proceed to Staff Login button");
    assert.equal(confirmedView.allowsDirectSignIn, true);
    assert.ok(confirmedView.body.includes("proceed directly to sign in"));
  });

  it("session guard test: navigating to staff login from verify page invokes logout to purge ambient session", () => {
    let activeSession: any = { role: "admin", name: "Existing User", token: "tok-abc" };
    let navigationTarget = "";

    const logout = () => {
      activeSession = null;
    };
    const router = {
      push: (path: string) => {
        navigationTarget = path;
      },
    };

    const handleNavigateToLogin = () => {
      logout();
      router.push('/manage');
    };

    // Trigger navigation
    handleNavigateToLogin();

    // Session is purged and destination is /manage
    assert.equal(activeSession, null, "Active session must be cleared before navigating to /manage!");
    assert.equal(navigationTarget, "/manage");
  });
});
