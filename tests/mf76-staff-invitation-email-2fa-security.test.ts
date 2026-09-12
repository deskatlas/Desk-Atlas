import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementActor,
  renderStaffInvitationEmail,
  TransactionalEmailService,
  EmailSendResult,
} from "@deskatlas/domain";

describe("MF-76: Staff Invitation Email 2FA Security & Copy Update", () => {
  const fixedNow = new Date("2026-09-12T10:00:00.000Z");
  const nowProvider = () => fixedNow;
  const adminActor: StaffManagementActor = { userId: "admin-owner-1", role: "ADMIN" };

  it("renderStaffInvitationEmail never includes the 2FA verification code in HTML or plain text", () => {
    const dummyCode = "738192";
    const rendered = renderStaffInvitationEmail({
      to: "invited.staff@deskatlas.com",
      displayName: "Jane Staff",
      role: "STAFF",
      invitationUrl: "http://localhost:3003/verify-invitation?token=test-invitation-token-123",
      verificationCode: dummyCode, // Passed intentionally to ensure it is ignored
      expiresAt: new Date("2026-09-13T10:00:00.000Z").toISOString(),
    });

    // 1. Strict negative check: the code must NOT be in HTML or text
    assert.ok(
      !rendered.html.includes(dummyCode),
      "Security failure: 2FA verification code was rendered in invitation email HTML!"
    );
    assert.ok(
      !rendered.text.includes(dummyCode),
      "Security failure: 2FA verification code was rendered in invitation email plain text!"
    );
    assert.ok(
      !rendered.html.includes("2FA Confirmation Code"),
      "Code box title should not appear when code is omitted"
    );

    // 2. Positive check: Clear security copy directing staff to ask workspace owner or administrator
    assert.ok(
      rendered.html.includes("Security Verification Required"),
      "HTML must contain the security verification notice title"
    );
    assert.ok(
      rendered.html.includes("workspace owner or administrator"),
      "HTML copy must instruct recipient to contact workspace owner or administrator"
    );
    assert.ok(
      rendered.html.includes("not included in this email"),
      "HTML copy must state code is not included in the email"
    );
    assert.ok(
      rendered.html.includes("Confirm &amp; Activate Account") || rendered.html.includes("Confirm & Activate Account"),
      "HTML must have the activation call-to-action button"
    );
    assert.ok(
      rendered.html.includes("http://localhost:3003/verify-invitation?token=test-invitation-token-123"),
      "HTML must link to verification URL"
    );

    // 3. Plain text check
    assert.ok(
      rendered.text.includes("Two-Factor Authentication (2FA) Notice:"),
      "Plain text must include 2FA notice section"
    );
    assert.ok(
      rendered.text.includes("workspace owner or administrator"),
      "Plain text must instruct recipient to ask workspace owner or administrator"
    );
    assert.ok(
      rendered.text.includes("not included in this email"),
      "Plain text must state code is not included in the email"
    );
  });

  it("StaffManagementService.inviteStaff dispatches email without 2FA code in payload or rendered email", async () => {
    let capturedSendEmailInput: any = null;

    const mockEmailService = new TransactionalEmailService({
      apiKey: "re_test_mock_api_key",
      fetcher: (async (_url: any, init: any) => {
        capturedSendEmailInput = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: "msg-mf76-test" }), { status: 200 });
      }) as any,
    });

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

    const service = createStaffManagementService(memoryRepo, nowProvider, mockEmailService);

    const { invitation, emailSent } = await service.inviteStaff({
      email: "newly.added@deskatlas.com",
      displayName: "Alex Rivera",
      role: "STAFF",
      password: "TempPassword123!",
      actorUserId: adminActor.userId,
      actorRole: adminActor.role,
    });

    assert.equal(emailSent, true);
    assert.ok(invitation.verificationCode, "6-digit code must be generated for out-of-band admin handoff");
    assert.equal(invitation.verificationCode.length, 6);

    // Verify email payload sent to recipient
    assert.ok(capturedSendEmailInput, "Email should have been sent");
    assert.deepEqual(capturedSendEmailInput.to, ["newly.added@deskatlas.com"]);

    // The raw 6-digit code must NEVER be present in the dispatched email HTML or text
    assert.ok(
      !capturedSendEmailInput.html.includes(invitation.verificationCode),
      "Dispatched email HTML must not contain the 6-digit verification code"
    );
    assert.ok(
      !capturedSendEmailInput.text.includes(invitation.verificationCode),
      "Dispatched email plain text must not contain the 6-digit verification code"
    );

    // Dispatched email must include the out-of-band security notice
    assert.ok(
      capturedSendEmailInput.html.includes("workspace owner or administrator"),
      "Dispatched email HTML must inform user to ask workspace owner or administrator"
    );
    assert.ok(
      capturedSendEmailInput.text.includes("workspace owner or administrator"),
      "Dispatched email plain text must inform user to ask workspace owner or administrator"
    );

    // Verify account confirmation works when the staff member receives the 2FA code from the admin
    const confirmationResult = await service.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
    });

    assert.equal(confirmationResult.invitation.status, "CONFIRMED");
    assert.equal(confirmationResult.staff.email, "newly.added@deskatlas.com");
    assert.equal(confirmationResult.staff.isActive, true);
  });
});
