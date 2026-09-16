import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it } from "vitest";
import { ProfileDropdown, type ProfileDropdownProps } from "@deskatlas/ui";

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

function renderComponent(props: ProfileDropdownProps, stateOverrides: Record<string, any> = {}) {
  return runWithHookDispatcher(() => (ProfileDropdown as any)(props), stateOverrides);
}

describe("MF-104: Admin and Staff Profile Header Dropdown Menu with Explicit Logout Action", () => {
  describe("1. ProfileDropdown Component Structure & Rendering", () => {
    it("returns null when user is null", () => {
      const vnode = renderComponent({
        user: null,
        onLogout: () => {},
      });
      assert.equal(vnode, null);
    });

    it("renders profile trigger with user initials, name, and role when closed", () => {
      const vnode = renderComponent(
        {
          user: {
            name: "Reyna Gomez",
            email: "reyna@example.com",
            role: "admin",
            isSuperAdmin: false,
          },
          onLogout: () => {},
        },
        { useState: false }
      );

      assert.equal(vnode.type, "div");
      const [trigger, dropdownMenu] = vnode.props.children;

      // Trigger checks
      assert.equal(trigger.props["data-testid"], "profile-dropdown-trigger");
      assert.equal(trigger.props["aria-expanded"], false);
      assert.equal(trigger.props.role, "button");

      // Menu is closed when isOpen is false
      assert.equal(dropdownMenu, false);
    });

    it("renders full dropdown popover with identity details, badge, and logout button when open", () => {
      let logoutCalled = false;
      const vnode = renderComponent(
        {
          user: {
            name: "Alexander Hamilton",
            email: "alex@desk-atlas.com",
            role: "admin",
            isSuperAdmin: true,
          },
          onLogout: () => {
            logoutCalled = true;
          },
        },
        { useState: true }
      );

      assert.equal(vnode.type, "div");
      const [trigger, dropdownMenu] = vnode.props.children;

      assert.equal(trigger.props["aria-expanded"], true);
      assert.ok(dropdownMenu, "Dropdown menu should be rendered");
      assert.equal(dropdownMenu.props["data-testid"], "profile-dropdown-menu");
      assert.equal(dropdownMenu.props.role, "menu");

      const [identitySection, divider, logoutButton] = dropdownMenu.props.children;

      // Check Identity Section
      assert.ok(identitySection, "Identity section rendered");
      const [avatar, infoCol] = identitySection.props.children;
      assert.equal(avatar.props.children, "A"); // First initial

      const [nameEl, emailEl, badgeContainer] = infoCol.props.children;
      assert.equal(nameEl.props.children, "Alexander Hamilton");
      assert.equal(emailEl.props.children, "alex@desk-atlas.com");

      const badge = badgeContainer.props.children;
      assert.equal(badge.props["data-testid"], "profile-role-badge");
      assert.equal(badge.props.children, "SUPERADMIN");

      // Check Logout Button
      assert.equal(logoutButton.props["data-testid"], "profile-logout-btn");
      assert.equal(logoutButton.props.role, "menuitem");

      // Verify clicking logout invokes onLogout
      const syntheticEvent = { stopPropagation: () => {} };
      logoutButton.props.onClick(syntheticEvent);
      assert.equal(logoutCalled, true);
    });

    it("renders correct role badge for standard Admin and Staff", () => {
      // Standard Admin
      const adminVnode = renderComponent(
        {
          user: {
            name: "John Admin",
            email: "john@example.com",
            role: "admin",
            isSuperAdmin: false,
          },
          onLogout: () => {},
        },
        { useState: true }
      );
      const [, adminMenu] = adminVnode.props.children;
      const [adminIdentity] = adminMenu.props.children;
      const adminBadge = adminIdentity.props.children[1].props.children[2].props.children;
      assert.equal(adminBadge.props.children, "ADMIN");

      // Staff
      const staffVnode = renderComponent(
        {
          user: {
            name: "Sarah Staff",
            email: "sarah@example.com",
            role: "staff",
          },
          onLogout: () => {},
        },
        { useState: true }
      );
      const [, staffMenu] = staffVnode.props.children;
      const [staffIdentity] = staffMenu.props.children;
      const staffBadge = staffIdentity.props.children[1].props.children[2].props.children;
      assert.equal(staffBadge.props.children, "STAFF");
    });
  });

  describe("2. Admin Portal & Staff Dashboard Layout Integration Audit", () => {
    it("verifies AdminShell uses ProfileDropdown instead of immediate logout click", () => {
      const adminLayoutPath = path.resolve(
        __dirname,
        "../apps/admin-portal/src/app/manage/layout.tsx"
      );
      const adminLayoutContent = fs.readFileSync(adminLayoutPath, "utf-8");

      assert.ok(
        adminLayoutContent.includes("ProfileDropdown"),
        "Admin layout must import and render ProfileDropdown"
      );
      assert.ok(
        !adminLayoutContent.includes("<div onClick={logout}"),
        "Admin layout must not attach onClick={logout} directly to profile container"
      );
      assert.ok(
        adminLayoutContent.includes("<ProfileDropdown user={user} onLogout={logout} />"),
        "Admin layout must pass user and logout to ProfileDropdown"
      );
    });

    it("verifies StaffShell uses ProfileDropdown instead of immediate logout click", () => {
      const staffLayoutPath = path.resolve(
        __dirname,
        "../apps/staff-dashboard/src/app/manage/layout.tsx"
      );
      const staffLayoutContent = fs.readFileSync(staffLayoutPath, "utf-8");

      assert.ok(
        staffLayoutContent.includes("ProfileDropdown"),
        "Staff layout must import and render ProfileDropdown"
      );
      assert.ok(
        !staffLayoutContent.includes("<div onClick={logout}"),
        "Staff layout must not attach onClick={logout} directly to profile container"
      );
      assert.ok(
        staffLayoutContent.includes("<ProfileDropdown user={user} onLogout={logout} />"),
        "Staff layout must pass user and logout to ProfileDropdown"
      );
    });
  });
});
