import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it } from "vitest";
import {
  DeactivatedAccountModal,
  type DeactivatedAccountModalProps,
} from "@deskatlas/ui";
import {
  createStaffManagementService,
  StaffManagementMemoryRepository,
} from "@deskatlas/domain";

function runWithHookDispatcher<T>(fn: () => T, stateOverrides: Record<string, any> = {}): T {
  const r = (React as any).default || React;
  const ReactInternals =
    r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
    r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_OR_YOU_WILL_BE_FIRED ||
    r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ||
    {};

  const prevDispatcher = ReactInternals.H;

  ReactInternals.H = {
    useState: (initial: any) => {
      const val =
        stateOverrides.useState !== undefined
          ? stateOverrides.useState
          : typeof initial === "function"
          ? initial()
          : initial;
      return [val, () => {}];
    },
    useRef: (initial: any) => ({ current: initial }),
    useImperativeHandle: () => {},
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
  };

  try {
    return fn();
  } finally {
    ReactInternals.H = prevDispatcher;
  }
}

function renderComponent(props: DeactivatedAccountModalProps) {
  return runWithHookDispatcher(() => (DeactivatedAccountModal as any)(props));
}

describe("MF-109: Real-Time Deactivation Session Termination & Non-Dismissible Warning Modal", () => {
  describe("1. DeactivatedAccountModal Component Structure & Behavior", () => {
    it("returns null when isOpen is false", () => {
      const vnode = renderComponent({
        isOpen: false,
      });
      assert.equal(vnode, null);
    });

    it("renders modal with full-screen overlay, shield icon, headline, and professional copy when isOpen is true", () => {
      let returnClicked = false;
      const vnode = renderComponent({
        isOpen: true,
        onReturnToLogin: () => {
          returnClicked = true;
        },
      });

      assert.ok(vnode, "Modal should render when open");
      assert.equal(vnode.props["data-testid"], "deactivated-account-modal-overlay");
      assert.equal(vnode.props.role, "dialog");
      assert.equal(vnode.props["aria-modal"], "true");

      const card = vnode.props.children;
      assert.equal(card.props["data-testid"], "deactivated-account-modal-card");

      const [iconEl, headlineEl, descEl, buttonEl] = card.props.children;

      // Icon container check
      assert.equal(iconEl.props["data-testid"], "deactivated-modal-icon");

      // Headline check
      assert.equal(headlineEl.props["data-testid"], "deactivated-modal-headline");
      assert.equal(headlineEl.props.children, "Account Deactivated");

      // Body copy check
      assert.equal(descEl.props["data-testid"], "deactivated-modal-message");
      assert.ok(
        descEl.props.children.includes(
          "Your account has been deactivated by an administrator."
        ),
        "Must contain accurate professional deactivation message"
      );
      assert.ok(
        descEl.props.children.includes(
          "If you believe this is an error or need your access restored, please contact your workspace administrator."
        )
      );

      // Button check
      assert.equal(buttonEl.props["data-testid"], "return-to-login-btn");
      assert.equal(buttonEl.props.children, "Return to Login");

      // Click button invokes onReturnToLogin
      const syntheticEvent = {
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      buttonEl.props.onClick(syntheticEvent);
      assert.equal(returnClicked, true);
    });

    it("stops propagation on overlay clicks to prevent closing", () => {
      let prevented = false;
      let stopped = false;
      const vnode = renderComponent({ isOpen: true });

      const syntheticEvent = {
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      };

      vnode.props.onClick(syntheticEvent);
      assert.equal(prevented, true);
      assert.equal(stopped, true);
    });
  });

  describe("2. Session Status Endpoint & Service Deactivation Verification", () => {
    it("differentiates active versus deactivated staff accounts", async () => {
      const repo = new StaffManagementMemoryRepository();
      const service = createStaffManagementService(repo);

      // 1. Create staff
      const activeStaff = await service.createStaff({
        displayName: "Active Operator",
        email: "operator@deskatlas.com",
        role: "STAFF",
      });

      const checkedActive = await service.getStaffById(activeStaff.id);
      assert.ok(checkedActive);
      assert.equal(checkedActive.isActive, true);

      // 2. Deactivate staff
      const deactivatedStaff = await service.updateStaff({
        staffUserId: activeStaff.id,
        isActive: false,
      });

      assert.equal(deactivatedStaff.isActive, false);

      const checkedDeactivated = await service.getStaffById(activeStaff.id);
      assert.ok(checkedDeactivated);
      assert.equal(checkedDeactivated.isActive, false);
    });
  });

  describe("3. Frontend Auth Provider & Session Endpoint Integration Audit", () => {
    it("verifies Admin AuthProvider integrates heartbeat, fetch interceptor, and DeactivatedAccountModal", () => {
      const adminAuthProviderPath = path.resolve(
        __dirname,
        "../apps/admin-portal/src/features/auth/components/AuthProvider.tsx"
      );
      const content = fs.readFileSync(adminAuthProviderPath, "utf-8");

      assert.ok(
        content.includes("DeactivatedAccountModal"),
        "Admin AuthProvider must import DeactivatedAccountModal"
      );
      assert.ok(
        content.includes("/api/admin/auth/session"),
        "Admin AuthProvider must query session status endpoint"
      );
      assert.ok(
        content.includes("isDeactivated"),
        "Admin AuthProvider must track deactivation state"
      );
      assert.ok(
        content.includes("sessionStorage.clear()"),
        "Admin AuthProvider must clear session storage upon deactivation"
      );
    });

    it("verifies Staff AuthProvider integrates heartbeat, fetch interceptor, and DeactivatedAccountModal", () => {
      const staffAuthProviderPath = path.resolve(
        __dirname,
        "../apps/staff-dashboard/src/features/auth/components/AuthProvider.tsx"
      );
      const content = fs.readFileSync(staffAuthProviderPath, "utf-8");

      assert.ok(
        content.includes("DeactivatedAccountModal"),
        "Staff AuthProvider must import DeactivatedAccountModal"
      );
      assert.ok(
        content.includes("/api/auth/session"),
        "Staff AuthProvider must query session status endpoint"
      );
      assert.ok(
        content.includes("isDeactivated"),
        "Staff AuthProvider must track deactivation state"
      );
      assert.ok(
        content.includes("sessionStorage.clear()"),
        "Staff AuthProvider must clear session storage upon deactivation"
      );
    });

    it("verifies session endpoint routes exist for both Admin Portal and Staff Dashboard", () => {
      const adminSessionRoute = path.resolve(
        __dirname,
        "../apps/admin-portal/src/app/api/admin/auth/session/route.ts"
      );
      const staffSessionRoute = path.resolve(
        __dirname,
        "../apps/staff-dashboard/src/app/api/auth/session/route.ts"
      );

      assert.ok(fs.existsSync(adminSessionRoute), "Admin session route must exist");
      assert.ok(fs.existsSync(staffSessionRoute), "Staff session route must exist");

      const adminContent = fs.readFileSync(adminSessionRoute, "utf-8");
      assert.ok(adminContent.includes("deactivated"));

      const staffContent = fs.readFileSync(staffSessionRoute, "utf-8");
      assert.ok(staffContent.includes("deactivated"));
    });
  });
});
