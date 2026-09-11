import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it } from "vitest";
import { PasswordInput, type PasswordInputProps } from "@deskatlas/ui";

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
      const val = stateOverrides.useState !== undefined ? stateOverrides.useState : (typeof initial === "function" ? initial() : initial);
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

function renderComponent(props: PasswordInputProps, ref: any = null, stateOverrides: Record<string, any> = {}) {
  return runWithHookDispatcher(() => (PasswordInput as any).render(props, ref), stateOverrides);
}

describe("MF-68: Show/Hide Password Eye Toggle Consistency Across All Password Inputs", () => {
  describe("1. PasswordInput Component Core Behavior", () => {
    it("renders container, password input and show-password toggle button by default", () => {
      const vnode = renderComponent({
        placeholder: "Enter secret password",
        value: "secret123",
        onChange: () => {},
      });

      // Verify container props
      assert.equal(vnode.type, "div");
      assert.equal(vnode.props["data-testid"], "password-input-container");
      assert.equal(vnode.props.style.position, "relative");
      assert.equal(vnode.props.style.display, "flex");

      const [inputElement, buttonElement] = vnode.props.children;

      // Verify input element
      assert.equal(inputElement.type, "input");
      assert.equal(inputElement.props["data-testid"], "password-input");
      assert.equal(inputElement.props.type, "password");
      assert.equal(inputElement.props.placeholder, "Enter secret password");
      assert.equal(inputElement.props.value, "secret123");
      assert.equal(inputElement.props.style.paddingRight, "38px");

      // Verify toggle button element
      assert.equal(buttonElement.type, "button");
      assert.equal(buttonElement.props["data-testid"], "password-toggle-btn");
      assert.equal(buttonElement.props.type, "button", "Toggle button MUST have type='button' so it does not submit forms");
      assert.equal(buttonElement.props["aria-label"], "Show password");
      assert.equal(buttonElement.props.title, "Show password");
      assert.equal(buttonElement.props.style.position, "absolute");
      assert.equal(buttonElement.props.style.right, "10px");
    });

    it("renders with type='text' when defaultVisible is true", () => {
      const vnode = renderComponent({
        defaultVisible: true,
        value: "revealed123",
        onChange: () => {},
      });

      const [inputElement, buttonElement] = vnode.props.children;

      assert.equal(inputElement.props.type, "text");
      assert.equal(buttonElement.props["aria-label"], "Hide password");
      assert.equal(buttonElement.props.title, "Hide password");
    });

    it("renders with type='text' and 'Hide password' icon when isVisible state is true", () => {
      const vnode = renderComponent(
        {
          value: "revealed-pass",
          onChange: () => {},
        },
        null,
        { useState: true }
      );

      const [inputElement, buttonElement] = vnode.props.children;

      assert.equal(inputElement.props.type, "text");
      assert.equal(buttonElement.props["aria-label"], "Hide password");
      assert.equal(buttonElement.props.title, "Hide password");
    });

    it("properly forwards disabled state to both input and toggle button", () => {
      const vnode = renderComponent({
        disabled: true,
        value: "disabled-pass",
        onChange: () => {},
      });

      const [inputElement, buttonElement] = vnode.props.children;

      assert.equal(inputElement.props.disabled, true);
      assert.equal(buttonElement.props.disabled, true);
      assert.equal(buttonElement.props.style.cursor, "not-allowed");
    });

    it("customizes aria labels when provided", () => {
      const vnode = renderComponent({
        buttonAriaLabelShow: "Show admin password",
        buttonAriaLabelHide: "Hide admin password",
        value: "custom-aria",
        onChange: () => {},
      });

      const [, buttonElement] = vnode.props.children;

      assert.equal(buttonElement.props["aria-label"], "Show admin password");
      assert.equal(buttonElement.props.title, "Show admin password");
    });

    it("handles styles gracefully: ensures padding-right for eye icon and forwards container styles", () => {
      const vnode = renderComponent({
        style: {
          margin: "6px 0 22px",
          border: "1px solid rgb(226, 232, 240)",
          fontSize: "14px",
          width: "100%",
        },
        containerClassName: "custom-container-class",
        containerStyle: { background: "#ffffff" },
        value: "styled-pass",
        onChange: () => {},
      });

      // Margin is moved to container for clean vertical centering of toggle button
      assert.equal(vnode.props.className, "custom-container-class");
      assert.equal(vnode.props.style.margin, "6px 0 22px");
      assert.equal(vnode.props.style.background, "#ffffff");

      const [inputElement] = vnode.props.children;
      assert.equal(inputElement.props.style.border, "1px solid rgb(226, 232, 240)");
      assert.equal(inputElement.props.style.fontSize, "14px");
      assert.equal(inputElement.props.style.paddingRight, "38px");
      assert.equal(inputElement.props.style.margin, 0);
    });

    it("forwards standard input attributes: id, name, required, autoComplete", () => {
      const vnode = renderComponent({
        id: "admin-password-field",
        name: "current-password",
        required: true,
        autoComplete: "current-password",
        value: "test",
        onChange: () => {},
      });

      const [inputElement] = vnode.props.children;

      assert.equal(inputElement.props.id, "admin-password-field");
      assert.equal(inputElement.props.name, "current-password");
      assert.equal(inputElement.props.required, true);
      assert.equal(inputElement.props.autoComplete, "current-password");
    });
  });

  describe("2. UI Package Export Parity", () => {
    it("exports PasswordInput from @deskatlas/ui main entry points", () => {
      assert.ok(PasswordInput, "PasswordInput must be exported from @deskatlas/ui");
      assert.equal(typeof PasswordInput, "object", "React forwardRef component is an object");
      assert.equal(PasswordInput.displayName, "PasswordInput");
    });
  });

  describe("3. Application Surface Parity & File Audit", () => {
    it("Admin Portal Login page (/manage/login) uses PasswordInput", () => {
      const filePath = path.resolve(__dirname, "../apps/admin-portal/src/features/auth/components/Login.tsx");
      assert.ok(fs.existsSync(filePath), "Admin Login component file must exist");
      const content = fs.readFileSync(filePath, "utf-8");

      assert.ok(content.includes("PasswordInput"), "Admin Login must import and use PasswordInput");
      assert.ok(content.includes("<PasswordInput"), "Admin Login must render <PasswordInput");
      assert.ok(!content.includes('type="password"'), "Admin Login must not use raw type='password' input");
    });

    it("Staff Dashboard Login page (/login) uses PasswordInput", () => {
      const filePath = path.resolve(__dirname, "../apps/staff-dashboard/src/features/auth/components/Login.tsx");
      assert.ok(fs.existsSync(filePath), "Staff Login component file must exist");
      const content = fs.readFileSync(filePath, "utf-8");

      assert.ok(content.includes("PasswordInput"), "Staff Login must import and use PasswordInput");
      assert.ok(content.includes("<PasswordInput"), "Staff Login must render <PasswordInput");
      assert.ok(!content.includes('type="password"'), "Staff Login must not use raw type='password' input");
    });

    it("Staff Management component (Add Staff & Reset Password modals) uses PasswordInput", () => {
      const filePath = path.resolve(__dirname, "../apps/admin-portal/src/features/staff-mgmt/components/StaffManagement.tsx");
      assert.ok(fs.existsSync(filePath), "StaffManagement component file must exist");
      const content = fs.readFileSync(filePath, "utf-8");

      assert.ok(content.includes("PasswordInput"), "StaffManagement must import and use PasswordInput");
      
      // Check Add Staff modal
      assert.ok(content.includes("addPassword"), "Add Staff modal password state must exist");
      // Check Edit Staff modal
      assert.ok(content.includes("managePassword"), "Edit Staff modal password state must exist");

      // Verify no raw type="password" inputs remain
      assert.ok(!content.includes('type="password"'), "StaffManagement must not contain any raw type='password' inputs");
    });

    it("Staff Verify Invitation page (/verify-invitation) uses PasswordInput for new and confirm passwords", () => {
      const filePath = path.resolve(__dirname, "../apps/staff-dashboard/src/app/verify-invitation/page.tsx");
      assert.ok(fs.existsSync(filePath), "Verify Invitation page file must exist");
      const content = fs.readFileSync(filePath, "utf-8");

      assert.ok(content.includes("PasswordInput"), "Verify Invitation must import and use PasswordInput");
      assert.ok(content.includes("<PasswordInput"), "Verify Invitation must render <PasswordInput");
      assert.ok(!content.includes('type="password"'), "Verify Invitation must not contain any raw type='password' inputs");
    });

    it("Admin & Staff auth feature indices export PasswordInput alongside PasswordRequirementsChecklist", () => {
      const adminAuthIndex = fs.readFileSync(
        path.resolve(__dirname, "../apps/admin-portal/src/features/auth/index.ts"),
        "utf-8"
      );
      assert.ok(adminAuthIndex.includes("PasswordInput"), "Admin auth index must re-export PasswordInput");

      const staffAuthIndex = fs.readFileSync(
        path.resolve(__dirname, "../apps/staff-dashboard/src/features/auth/index.ts"),
        "utf-8"
      );
      assert.ok(staffAuthIndex.includes("PasswordInput"), "Staff auth index must re-export PasswordInput");
    });
  });
});
