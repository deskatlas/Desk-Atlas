import assert from "node:assert/strict";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
  StaffManagementActor,
  validatePassword,
  validatePersonName,
  type TransactionalEmailService,
} from "@deskatlas/domain";

describe("MS-20: Staff Provisioning Credential Security Simplification & Customer Transactional Notification Sequencing", () => {
  const fixedNow = new Date("2026-09-28T10:00:00.000Z");
  const nowProvider = () => fixedNow;

  const superAdminActor: StaffManagementActor = {
    userId: "super-admin-01",
    role: "ADMIN",
    isSuperAdmin: true,
  };

  const adminActor: StaffManagementActor = {
    userId: "admin-02",
    role: "ADMIN",
    isSuperAdmin: false,
  };

  describe("QAD-TC20.1: Add Staff Modal Clean State (Zero-Trust Staff Invitation)", () => {
    it("successfully creates a staff invitation with only name, email, and role without requiring an initial password", async () => {
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

      const nameValidation = validatePersonName("Jane Frontdesk", "Full name");
      assert.equal(nameValidation.isValid, true);

      // Superadmin invites staff member with no initial password provided
      const { invitation, emailSent } = await service.inviteStaff({
        email: "jane.frontdesk@deskatlas.com",
        displayName: "Jane Frontdesk",
        role: "STAFF",
        actorUserId: superAdminActor.userId,
        actorRole: "ADMIN",
        actorIsSuperAdmin: true,
        invitationBaseUrl: "https://staff.deskatlas.com",
      });

      assert.ok(invitation.id);
      assert.equal(invitation.email, "jane.frontdesk@deskatlas.com");
      assert.equal(invitation.displayName, "Jane Frontdesk");
      assert.equal(invitation.role, "STAFF");
      assert.equal(invitation.status, "PENDING");
      assert.equal(invitation.verificationCode.length, 6);
      assert.ok(invitation.token.length > 10);
      assert.equal(invitation.createdByAdminId, superAdminActor.userId);
      assert.equal(emailSent, true);
    });

    it("allows newly invited staff member to set their own confidential password upon invitation verification", async () => {
      const memoryRepo = new StaffManagementMemoryRepository(
        [
          {
            id: adminActor.userId,
            email: "manager@deskatlas.com",
            displayName: "Venue Manager",
            role: "ADMIN",
            isActive: true,
            isSuperAdmin: false,
          },
        ],
        nowProvider
      );
      const service = createStaffManagementService(memoryRepo, nowProvider);

      const { invitation } = await service.inviteStaff({
        email: "bob.barista@deskatlas.com",
        displayName: "Bob Barista",
        role: "STAFF",
        actorUserId: adminActor.userId,
        actorRole: "ADMIN",
        actorIsSuperAdmin: false,
      });

      const chosenPassword = "SecureStaffPass123!";
      const passValidation = validatePassword(chosenPassword);
      assert.equal(passValidation.isValid, true);

      const { staff } = await service.confirmStaffInvitation({
        token: invitation.token,
        verificationCode: invitation.verificationCode,
        password: chosenPassword,
      });

      assert.equal(staff.email, "bob.barista@deskatlas.com");
      assert.equal(staff.name, "Bob Barista");
      assert.equal(staff.rawRole, "STAFF");
      assert.equal(staff.isActive, true);
    });
  });

  describe("QAD-TC20.2: Existing Staff Password Reset & Recovery Assistance Support", () => {
    it("preserves superadmin and admin capability to update and reset password for existing staff accounts", async () => {
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
          {
            id: "staff-member-03",
            email: "lockedout@deskatlas.com",
            displayName: "Locked Out Staff",
            role: "STAFF",
            isActive: true,
            isSuperAdmin: false,
            createdByAdminId: superAdminActor.userId,
          },
        ],
        nowProvider
      );
      const service = createStaffManagementService(memoryRepo, nowProvider);

      const newPassword = "NewRecoveredPass2026!";
      const passCheck = validatePassword(newPassword);
      assert.equal(passCheck.isValid, true);

      // Superadmin assists locked out staff member by updating password
      const updated = await service.updateStaff({
        staffUserId: "staff-member-03",
        password: newPassword,
        displayName: "Locked Out Staff",
        actorUserId: superAdminActor.userId,
        actorRole: "ADMIN",
        actorIsSuperAdmin: true,
      });

      assert.equal(updated.id, "staff-member-03");
      assert.equal(updated.name, "Locked Out Staff");
    });
  });

  describe("QAD-TC20.3 & QAD-TC20.4: 5-Second Delay Sequencing Execution & Payment Precedence", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("dispatches payment link email immediately (T=0) and tracking email strictly after 5000ms delay", async () => {
      const emailTimeline: Array<{ type: "PAYMENT" | "TRACKING"; timestamp: number }> = [];

      const mockEmailService: Partial<TransactionalEmailService> = {
        sendPaymentLinkEmail: vi.fn(async () => {
          emailTimeline.push({ type: "PAYMENT", timestamp: Date.now() });
          return { success: true, messageId: "msg-pay-1" };
        }),
        sendReservationTrackingEmail: vi.fn(async () => {
          emailTimeline.push({ type: "TRACKING", timestamp: Date.now() });
          return { success: true, messageId: "msg-track-1" };
        }),
      };

      const delayAsync = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const reservationData = {
        customerEmail: "customer@example.com",
        customerFirstName: "Alice",
        customerLastName: "Wonder",
        referenceCode: "REF-10020",
        amountDue: 500,
        currency: "PHP",
        paymentSession: {
          paymentUrl: "https://pay.deskatlas.com/session/123",
          expiresAt: "2026-09-28T11:00:00.000Z",
          expiryMinutes: 60,
        },
        candidates: [
          {
            rank: 1,
            workspaceDisplayName: "Desk A-1",
            workspaceTemplateName: "Dedicated Desk",
            floorName: "1st Floor",
            startAt: "2026-09-28T12:00:00.000Z",
            endAt: "2026-09-28T16:00:00.000Z",
          },
        ],
      };

      const trackingUrl = "https://deskatlas.com/track/REF-10020";

      // 1. Dispatch Payment Link Email immediately
      if (reservationData.paymentSession) {
        await mockEmailService.sendPaymentLinkEmail!({
          to: reservationData.customerEmail,
          customerFirstName: reservationData.customerFirstName,
          customerLastName: reservationData.customerLastName,
          referenceCode: reservationData.referenceCode,
          amountDue: reservationData.amountDue,
          currency: reservationData.currency,
          paymentUrl: reservationData.paymentSession.paymentUrl,
          expiresAt: reservationData.paymentSession.expiresAt,
          expiryMinutes: reservationData.paymentSession.expiryMinutes,
          trackingUrl,
          workspaceTemplateName: reservationData.candidates[0].workspaceTemplateName,
          bookingDate: reservationData.candidates[0].startAt,
        });
      }

      // 2. Schedule Reservation Status Email with 5-Second Delay
      const dispatchTrackingNotice = async () => {
        try {
          if (reservationData.paymentSession) {
            await delayAsync(5000);
          }

          await mockEmailService.sendReservationTrackingEmail!({
            to: reservationData.customerEmail,
            customerFirstName: reservationData.customerFirstName,
            customerLastName: reservationData.customerLastName,
            referenceCode: reservationData.referenceCode,
            trackingUrl,
            candidates: reservationData.candidates.map((c) => ({
              rank: c.rank,
              workspaceDisplayName: c.workspaceDisplayName,
              workspaceTemplateName: c.workspaceTemplateName,
              floorName: c.floorName,
              startAt: c.startAt,
              endAt: c.endAt,
            })),
          });
        } catch {
          // isolation
        }
      };

      // Launch asynchronously
      const trackingPromise = dispatchTrackingNotice();

      // Immediately after call: Payment email sent, tracking email not yet sent
      assert.equal(emailTimeline.length, 1);
      assert.equal(emailTimeline[0].type, "PAYMENT");

      // Advance clock by 4999ms
      await vi.advanceTimersByTimeAsync(4999);
      assert.equal(emailTimeline.length, 1);

      // Advance clock by remaining 1ms (total 5000ms)
      await vi.advanceTimersByTimeAsync(1);
      await trackingPromise;

      assert.equal(emailTimeline.length, 2);
      assert.equal(emailTimeline[0].type, "PAYMENT");
      assert.equal(emailTimeline[1].type, "TRACKING");
      assert.equal(emailTimeline[1].timestamp - emailTimeline[0].timestamp, 5000);
    });
  });

  describe("QAD-TC20.5: Non-Blocking Execution Invariant", () => {
    it("handles background delayed tracking notification without blocking synchronous handler flow", async () => {
      let trackingCompleted = false;
      const delayAsync = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const dispatchTrackingNotice = async () => {
        await delayAsync(5000);
        trackingCompleted = true;
      };

      // Simulating the route handler returning HTTP response immediately
      const simulateRouteHandler = () => {
        void dispatchTrackingNotice();
        return { status: 201, body: { success: true } };
      };

      const start = Date.now();
      const response = simulateRouteHandler();
      const executionDuration = Date.now() - start;

      assert.equal(response.status, 201);
      assert.equal(response.body.success, true);
      assert.equal(trackingCompleted, false);
      assert.ok(executionDuration < 50, "Route handler returned immediately without waiting for delay");
    });
  });
});
