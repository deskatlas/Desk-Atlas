import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  type StaffManagementActor,
  type TransactionalEmailService,
  renderTeamMemberJoinedEmail,
  renderAccountDeactivatedEmail,
  renderAccountReactivatedEmail,
  type TeamMemberJoinedEmailInput,
  type AccountStatusChangedEmailInput,
} from "@deskatlas/domain";

describe("MF-142: Team Member Lifecycle Email Notifications", () => {
  const fixedNow = new Date("2026-09-19T10:30:00.000Z");
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

  describe("renderTeamMemberJoinedEmail", () => {
    it("renders email correctly for a new Staff member", () => {
      const input: TeamMemberJoinedEmailInput = {
        to: "superadmin@deskatlas.com",
        memberName: "Alex Mercer",
        memberEmail: "alex.mercer@deskatlas.com",
        role: "STAFF",
        joinedAt: "2026-09-19T02:30:00.000Z",
        invitedBy: "Super Administrator",
        rosterUrl: "http://localhost:3000/manage/staff",
      };

      const rendered = renderTeamMemberJoinedEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] New Team Member Joined: Alex Mercer (Staff)"
      );
      assert.ok(rendered.html.includes("Alex Mercer"));
      assert.ok(rendered.html.includes("alex.mercer@deskatlas.com"));
      assert.ok(rendered.html.includes("Staff"));
      assert.ok(rendered.html.includes("Invited By:"));
      assert.ok(rendered.html.includes("Super Administrator"));
      assert.ok(rendered.html.includes("View Team Roster"));
      assert.ok(rendered.html.includes("http://localhost:3000/manage/staff"));

      assert.ok(rendered.text.includes("Alex Mercer"));
      assert.ok(rendered.text.includes("alex.mercer@deskatlas.com"));
      assert.ok(rendered.text.includes("Staff"));
      assert.ok(rendered.text.includes("Invited By: Super Administrator"));
    });

    it("renders email correctly for a new Admin member", () => {
      const input: TeamMemberJoinedEmailInput = {
        to: "superadmin@deskatlas.com",
        memberName: "Diana Prince",
        memberEmail: "diana.admin@deskatlas.com",
        role: "ADMIN",
        joinedAt: "2026-09-19T02:30:00.000Z",
      };

      const rendered = renderTeamMemberJoinedEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] New Team Member Joined: Diana Prince (Admin)"
      );
      assert.ok(rendered.html.includes("Diana Prince"));
      assert.ok(rendered.html.includes("diana.admin@deskatlas.com"));
      assert.ok(rendered.html.includes("Admin"));
      assert.ok(rendered.html.includes("View Team Roster"));
      assert.ok(rendered.text.includes("Assigned Role: Admin"));
    });
  });

  describe("renderAccountDeactivatedEmail", () => {
    it("renders deactivation notice with first-name salutation, security warning, and support contacts", () => {
      const input: AccountStatusChangedEmailInput = {
        to: "john.staff@deskatlas.com",
        memberName: "Johnathan Doe",
        role: "STAFF",
        effectiveAt: "2026-09-19T02:30:00.000Z",
        contactNumber: "+63 2 8123 4567",
        supportEmail: "management@deskatlas.com",
      };

      const rendered = renderAccountDeactivatedEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] Notice: Your Account Has Been Deactivated"
      );
      // Salutation to first name
      assert.ok(rendered.html.includes("Hello Johnathan,"));
      assert.ok(rendered.text.includes("Hello Johnathan,"));

      // Explanation
      assert.ok(
        rendered.html.includes(
          "Your DeskAtlas Staff account has been deactivated by an administrator effective immediately."
        )
      );
      assert.ok(
        rendered.text.includes(
          "Your DeskAtlas Staff account has been deactivated by an administrator effective immediately."
        )
      );

      // Security Notice
      assert.ok(
        rendered.html.includes(
          "Your active sessions have been terminated and you will no longer be able to access the management portal."
        )
      );
      assert.ok(
        rendered.text.includes(
          "Your active sessions have been terminated and you will no longer be able to access the management portal."
        )
      );

      // Support details
      assert.ok(rendered.html.includes("management@deskatlas.com"));
      assert.ok(rendered.html.includes("+63 2 8123 4567"));
      assert.ok(rendered.text.includes("Admin Email: management@deskatlas.com"));
      assert.ok(rendered.text.includes("Contact Number: +63 2 8123 4567"));
    });

    it("renders deactivation notice for an Admin account", () => {
      const input: AccountStatusChangedEmailInput = {
        to: "clara.admin@deskatlas.com",
        memberName: "Clara Oswald",
        role: "ADMIN",
        effectiveAt: "2026-09-19T02:30:00.000Z",
      };

      const rendered = renderAccountDeactivatedEmail(input);

      assert.ok(rendered.html.includes("Hello Clara,"));
      assert.ok(
        rendered.html.includes(
          "Your DeskAtlas Admin account has been deactivated by an administrator effective immediately."
        )
      );
      assert.ok(rendered.html.includes("Account Role:"));
      assert.ok(rendered.html.includes("Admin"));
    });
  });

  describe("renderAccountReactivatedEmail", () => {
    it("renders reactivation notice with restoration copy, sign-in CTA, and password recovery guidance", () => {
      const input: AccountStatusChangedEmailInput = {
        to: "john.staff@deskatlas.com",
        memberName: "Johnathan Doe",
        role: "STAFF",
        effectiveAt: "2026-09-19T02:30:00.000Z",
        loginUrl: "http://localhost:3000/manage/login",
      };

      const rendered = renderAccountReactivatedEmail(input);

      assert.equal(
        rendered.subject,
        "[DeskAtlas] Your Account Has Been Reactivated"
      );
      // Salutation
      assert.ok(rendered.html.includes("Hello Johnathan,"));
      assert.ok(rendered.text.includes("Hello Johnathan,"));

      // Reinstatement notice
      assert.ok(
        rendered.html.includes(
          "Your DeskAtlas Staff account access has been restored."
        )
      );
      assert.ok(
        rendered.text.includes(
          "Your DeskAtlas Staff account access has been restored."
        )
      );

      // Sign In CTA
      assert.ok(rendered.html.includes("Sign In to DeskAtlas"));
      assert.ok(rendered.html.includes("http://localhost:3000/manage/login"));
      assert.ok(
        rendered.text.includes("Sign In: http://localhost:3000/manage/login")
      );

      // Password recovery guidance
      assert.ok(rendered.html.includes("Forgot your password?"));
      assert.ok(
        rendered.html.includes("Forgot Password")
      );
      assert.ok(
        rendered.text.includes("Forgot your password? You can use the \"Forgot Password\" link")
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Integration / Service Trigger Tests
  // --------------------------------------------------------------------------

  function createMockEmailService() {
    const joinedEmails: TeamMemberJoinedEmailInput[] = [];
    const deactivatedEmails: AccountStatusChangedEmailInput[] = [];
    const reactivatedEmails: AccountStatusChangedEmailInput[] = [];

    const mockService = {
      joinedEmails,
      deactivatedEmails,
      reactivatedEmails,
      shouldFail: false,
      async sendTeamMemberJoinedEmail(input: TeamMemberJoinedEmailInput) {
        if (this.shouldFail) {
          throw new Error("SMTP connection timeout");
        }
        joinedEmails.push(input);
        return { success: true, id: `msg-join-${joinedEmails.length}` };
      },
      async sendAccountDeactivatedEmail(input: AccountStatusChangedEmailInput) {
        if (this.shouldFail) {
          throw new Error("Mail provider unreachable");
        }
        deactivatedEmails.push(input);
        return { success: true, id: `msg-deact-${deactivatedEmails.length}` };
      },
      async sendAccountReactivatedEmail(input: AccountStatusChangedEmailInput) {
        if (this.shouldFail) {
          throw new Error("Mail provider error");
        }
        reactivatedEmails.push(input);
        return { success: true, id: `msg-react-${reactivatedEmails.length}` };
      },
      async sendStaffInvitationEmail() {
        return { success: true, id: "msg-invite" };
      },
    } as unknown as TransactionalEmailService & {
      joinedEmails: TeamMemberJoinedEmailInput[];
      deactivatedEmails: AccountStatusChangedEmailInput[];
      reactivatedEmails: AccountStatusChangedEmailInput[];
      shouldFail: boolean;
    };

    return mockService;
  }

  it("dispatches sendTeamMemberJoinedEmail to Super Admin and active Admins when invitation is confirmed", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: adminActor.userId,
          email: "operations.admin@deskatlas.com",
          displayName: "Operations Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
        {
          id: "usr-inactive-admin",
          email: "inactive.admin@deskatlas.com",
          displayName: "Inactive Admin",
          role: "ADMIN",
          isActive: false,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );

    const mockEmailService = createMockEmailService();
    const service = createStaffManagementService(
      memoryRepo,
      nowProvider,
      mockEmailService
    );

    // 1. Super Admin invites a new staff member
    const { invitation } = await service.inviteStaff({
      email: "new.staff@deskatlas.com",
      displayName: "New Staff Member",
      role: "STAFF",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    assert.equal(mockEmailService.joinedEmails.length, 0);

    // 2. Staff member confirms invitation and sets password
    const result = await service.confirmStaffInvitation({
      token: invitation.token,
      verificationCode: invitation.verificationCode,
      password: "ValidPass123!Secure",
    });

    assert.ok(result.staff);
    assert.equal(result.staff.email, "new.staff@deskatlas.com");

    // 3. Verify joined notification dispatched to active administrators
    assert.equal(mockEmailService.joinedEmails.length, 2);

    const recipientEmails = mockEmailService.joinedEmails.map((e) => e.to).sort();
    assert.deepEqual(recipientEmails, [
      "operations.admin@deskatlas.com",
      "superadmin@deskatlas.com",
    ]);

    for (const email of mockEmailService.joinedEmails) {
      assert.equal(email.memberName, "New Staff Member");
      assert.equal(email.memberEmail, "new.staff@deskatlas.com");
      assert.equal(email.role, "STAFF");
      assert.equal(email.invitedBy, "Super Administrator");
      assert.ok(email.rosterUrl?.includes("/manage/staff"));
    }
  });

  it("dispatches sendTeamMemberJoinedEmail when a team member is directly created by Super Admin", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: adminActor.userId,
          email: "operations.admin@deskatlas.com",
          displayName: "Operations Admin",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );

    const mockEmailService = createMockEmailService();
    const service = createStaffManagementService(
      memoryRepo,
      nowProvider,
      mockEmailService
    );

    const created = await service.createStaff({
      email: "direct.staff@deskatlas.com",
      displayName: "Direct Staff",
      role: "STAFF",
      password: "Password123!Safe",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });

    assert.ok(created);
    assert.equal(created.email, "direct.staff@deskatlas.com");

    // Both active admins receive the notification
    assert.equal(mockEmailService.joinedEmails.length, 2);
    assert.equal(mockEmailService.joinedEmails[0].memberName, "Direct Staff");
    assert.equal(mockEmailService.joinedEmails[0].memberEmail, "direct.staff@deskatlas.com");
    assert.equal(mockEmailService.joinedEmails[0].role, "STAFF");
    assert.equal(mockEmailService.joinedEmails[0].invitedBy, "Super Administrator");
  });

  it("dispatches sendAccountDeactivatedEmail when an Admin or Staff account is deactivated", async () => {
    const targetStaff = {
      id: "usr-target-staff",
      email: "target.staff@deskatlas.com",
      displayName: "Target Staff",
      role: "STAFF" as const,
      isActive: true,
      isSuperAdmin: false,
    };

    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        targetStaff,
      ],
      nowProvider
    );

    const mockEmailService = createMockEmailService();
    const service = createStaffManagementService(
      memoryRepo,
      nowProvider,
      mockEmailService
    );

    // Deactivate staff account
    const deactivated = await service.deactivateStaff(targetStaff.id, superAdminActor);

    assert.equal(deactivated.isActive, false);
    assert.equal(mockEmailService.deactivatedEmails.length, 1);

    const email = mockEmailService.deactivatedEmails[0];
    assert.equal(email.to, "target.staff@deskatlas.com");
    assert.equal(email.memberName, "Target Staff");
    assert.equal(email.role, "STAFF");
    assert.equal(email.changedBy, "Super Administrator");
    assert.ok(email.effectiveAt);
  });

  it("dispatches sendAccountReactivatedEmail when a deactivated account is reactivated", async () => {
    const targetStaff = {
      id: "usr-target-staff",
      email: "target.staff@deskatlas.com",
      displayName: "Target Staff",
      role: "STAFF" as const,
      isActive: false, // Initially deactivated
      isSuperAdmin: false,
    };

    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        targetStaff,
      ],
      nowProvider
    );

    const mockEmailService = createMockEmailService();
    const service = createStaffManagementService(
      memoryRepo,
      nowProvider,
      mockEmailService
    );

    // Reactivate staff account via reactivateStaffAccount
    const reactivated = await service.reactivateStaffAccount(targetStaff.id, superAdminActor);

    assert.equal(reactivated.isActive, true);
    assert.equal(mockEmailService.reactivatedEmails.length, 1);

    const email = mockEmailService.reactivatedEmails[0];
    assert.equal(email.to, "target.staff@deskatlas.com");
    assert.equal(email.memberName, "Target Staff");
    assert.equal(email.role, "STAFF");
    assert.equal(email.changedBy, "Super Administrator");
    assert.ok(email.loginUrl?.includes("/manage/login"));
    assert.ok(email.effectiveAt);
  });

  it("resilient failure handling: email send failures do not block account actions", async () => {
    const memoryRepo = new StaffManagementMemoryRepository(
      [
        {
          id: superAdminActor.userId,
          email: "superadmin@deskatlas.com",
          displayName: "Super Administrator",
          role: "ADMIN",
          isActive: true,
          isSuperAdmin: true,
        },
        {
          id: "usr-staff-error-test",
          email: "error.staff@deskatlas.com",
          displayName: "Error Test Staff",
          role: "STAFF",
          isActive: true,
          isSuperAdmin: false,
        },
      ],
      nowProvider
    );

    const mockEmailService = createMockEmailService();
    mockEmailService.shouldFail = true; // Email provider throws

    const service = createStaffManagementService(
      memoryRepo,
      nowProvider,
      mockEmailService
    );

    // 1. Direct creation succeeds even if email fails
    const created = await service.createStaff({
      email: "resilient.staff@deskatlas.com",
      displayName: "Resilient Staff",
      role: "STAFF",
      password: "Password123!Safe",
      actorUserId: superAdminActor.userId,
      actorRole: "ADMIN",
      actorIsSuperAdmin: true,
    });
    assert.ok(created);
    assert.equal(created.email, "resilient.staff@deskatlas.com");

    // 2. Deactivation succeeds even if email fails
    const deactivated = await service.deactivateStaffAccount(
      "usr-staff-error-test",
      superAdminActor
    );
    assert.equal(deactivated.isActive, false);

    // 3. Reactivation succeeds even if email fails
    const reactivated = await service.reactivateStaffAccount(
      "usr-staff-error-test",
      superAdminActor
    );
    assert.equal(reactivated.isActive, true);
  });
});
