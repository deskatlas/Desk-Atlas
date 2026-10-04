import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, it } from 'vitest';
import { Button, type ButtonProps } from '@deskatlas/ui';

interface VNode {
  type: unknown;
  props: {
    className?: string;
    disabled?: boolean;
    'aria-disabled'?: string;
    children?: React.ReactNode;
    type?: string;
    [key: string]: unknown;
  };
}

function renderButton(props: ButtonProps, ref: unknown = null): VNode {
  const component = Button as unknown as {
    render: (p: ButtonProps, r: unknown) => VNode;
  };
  return component.render(props, ref);
}

describe('MS-33 / QAD-TC33: Monorepo-Wide Interactive Button Hover Elevation, Micro-Interactions, and Visual Affordance System', () => {
  const rootDir = path.resolve(__dirname, '..');
  const stylesheetPaths = [
    path.join(rootDir, 'packages', 'ui', 'src', 'styles', 'buttons.css'),
    path.join(rootDir, 'apps', 'customer-website', 'src', 'styles', 'globals.css'),
    path.join(rootDir, 'apps', 'kiosk', 'src', 'styles', 'globals.css'),
    path.join(rootDir, 'apps', 'staff-dashboard', 'src', 'styles', 'globals.css'),
    path.join(rootDir, 'apps', 'admin-portal', 'src', 'styles', 'globals.css'),
  ];

  describe('QAD-TC33-01: Global CSS Button Foundation and Cursor Affordance', () => {
    it('verifies that all application stylesheets and packages/ui define cursor pointer and smooth transition on button selectors', () => {
      for (const stylesheetPath of stylesheetPaths) {
        assert.ok(fs.existsSync(stylesheetPath), `Stylesheet file must exist: ${stylesheetPath}`);
        const content = fs.readFileSync(stylesheetPath, 'utf8');

        // Check for button selector rule
        assert.ok(
          content.includes('button') && content.includes('cursor: pointer'),
          `Stylesheet ${path.basename(stylesheetPath)} must define cursor: pointer on buttons`
        );

        // Check for smooth transition
        assert.ok(
          content.includes('transition:') && content.includes('0.15s ease-in-out'),
          `Stylesheet ${path.basename(stylesheetPath)} must define 0.15s ease-in-out transition`
        );

        // Check for touch-action and user-select
        assert.ok(
          content.includes('touch-action: manipulation'),
          `Stylesheet ${path.basename(stylesheetPath)} must define touch-action: manipulation`
        );
      }
    });
  });

  describe('QAD-TC33-02: Hover Pseudo-Class Elevation and Brightness Shift', () => {
    it('verifies that :hover pseudo-classes define translateY elevation and brightness filter shifts', () => {
      for (const stylesheetPath of stylesheetPaths) {
        const content = fs.readFileSync(stylesheetPath, 'utf8');

        // Verify hover rule exists for buttons
        assert.ok(
          content.includes(':hover'),
          `Stylesheet ${path.basename(stylesheetPath)} must contain :hover rules`
        );

        // Verify translateY(-1px) elevation
        assert.ok(
          content.includes('transform: translateY(-1px)'),
          `Stylesheet ${path.basename(stylesheetPath)} must apply transform: translateY(-1px) on hover`
        );

        // Verify brightness shift
        assert.ok(
          content.includes('filter: brightness(1.06)') || content.includes('filter: brightness(1.08)'),
          `Stylesheet ${path.basename(stylesheetPath)} must apply brightness boost on hover`
        );
      }
    });

    it('verifies that primary and secondary button classes define distinct hover elevation and box shadows', () => {
      const uiButtonsCss = fs.readFileSync(stylesheetPaths[0], 'utf8');

      // Primary button hover styling
      assert.ok(
        uiButtonsCss.includes('.da-primary-button:not(:disabled):hover'),
        'Must define .da-primary-button:not(:disabled):hover'
      );
      assert.ok(
        uiButtonsCss.includes('box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25)'),
        'Primary button hover must have elevation shadow'
      );

      // Secondary button hover styling
      assert.ok(
        uiButtonsCss.includes('.da-secondary-button:not(:disabled):hover'),
        'Must define .da-secondary-button:not(:disabled):hover'
      );
      assert.ok(
        uiButtonsCss.includes('background-color: #f8fafc'),
        'Secondary button hover must have neutral hover background'
      );
    });
  });

  describe('QAD-TC33-03: Disabled State Invariant and Interaction Suppression', () => {
    it('verifies that disabled buttons strictly suppress hover/active transformations and enforce cursor: not-allowed', () => {
      for (const stylesheetPath of stylesheetPaths) {
        const content = fs.readFileSync(stylesheetPath, 'utf8');

        // Check disabled rule block
        assert.ok(
          content.includes('button:disabled'),
          `Stylesheet ${path.basename(stylesheetPath)} must contain button:disabled rules`
        );
        assert.ok(
          content.includes('cursor: not-allowed !important'),
          `Stylesheet ${path.basename(stylesheetPath)} must enforce cursor: not-allowed !important`
        );
        assert.ok(
          content.includes('transform: none !important'),
          `Stylesheet ${path.basename(stylesheetPath)} must enforce transform: none !important`
        );
        assert.ok(
          content.includes('pointer-events: none'),
          `Stylesheet ${path.basename(stylesheetPath)} must enforce pointer-events: none`
        );
      }
    });
  });

  describe('QAD-TC33-04: Presentation Layer Button Component in packages/ui', () => {
    it('renders primary variant by default with correct design token classes', () => {
      const vnode = renderButton({
        children: 'Confirm Reservation',
      });

      assert.equal(vnode.type, 'button');
      assert.equal(vnode.props.type, 'button');
      assert.ok(vnode.props.className?.includes('da-primary-button'));
      assert.ok(vnode.props.className?.includes('px-4 py-2 text-sm rounded-lg font-semibold'));
      const childText = Array.isArray(vnode.props.children)
        ? vnode.props.children.find((c) => typeof c === 'string')
        : vnode.props.children;
      assert.equal(childText, 'Confirm Reservation');
    });

    it('renders secondary, danger, ghost, and accent variants correctly', () => {
      const variants: Array<{
        variant: ButtonProps['variant'];
        expectedClass: string;
      }> = [
        { variant: 'secondary', expectedClass: 'da-secondary-button' },
        { variant: 'danger', expectedClass: 'da-danger-button' },
        { variant: 'ghost', expectedClass: 'da-ghost-button' },
        { variant: 'accent', expectedClass: 'da-accent-button' },
      ];

      for (const { variant, expectedClass } of variants) {
        const vnode = renderButton({
          variant,
          children: 'Action Trigger',
        });
        assert.ok(
          vnode.props.className?.includes(expectedClass),
          `Expected variant ${variant} to include class ${expectedClass}`
        );
      }
    });

    it('renders small (sm) and large (lg) size modifiers', () => {
      const smVNode = renderButton({
        size: 'sm',
        children: 'Small Button',
      });
      assert.ok(smVNode.props.className?.includes('px-3 py-1.5 text-xs rounded-lg'));

      const lgVNode = renderButton({
        size: 'lg',
        children: 'Large Action',
      });
      assert.ok(lgVNode.props.className?.includes('px-6 py-3 text-base rounded-xl font-bold'));
    });

    it('renders loading spinner and disables button when isLoading is true', () => {
      const vnode = renderButton({
        isLoading: true,
        children: 'Submitting Proof',
      });

      assert.equal(vnode.props.disabled, true);
      assert.equal(vnode.props['aria-disabled'], 'true');

      // Children should contain the spinner element
      const childrenArray = Array.isArray(vnode.props.children)
        ? vnode.props.children
        : [vnode.props.children];
      const hasSpinner = childrenArray.some(
        (child) =>
          React.isValidElement(child) &&
          (child.props as { 'data-testid'?: string })['data-testid'] === 'button-spinner'
      );
      assert.ok(hasSpinner, 'Must render loading spinner when isLoading is true');
    });

    it('handles explicit disabled state with aria-disabled parity', () => {
      const vnode = renderButton({
        disabled: true,
        children: 'Locked Action',
      });

      assert.equal(vnode.props.disabled, true);
      assert.equal(vnode.props['aria-disabled'], 'true');
    });
  });

  describe('QAD-TC33-05: Active Press Tactile Feedback Verification', () => {
    it('verifies that :active pseudo-classes apply tactile physical press scale(0.98) across stylesheets', () => {
      for (const stylesheetPath of stylesheetPaths) {
        const content = fs.readFileSync(stylesheetPath, 'utf8');

        // Check active press rules
        assert.ok(
          content.includes(':active'),
          `Stylesheet ${path.basename(stylesheetPath)} must contain :active rules`
        );
        assert.ok(
          content.includes('scale(0.98)') || content.includes('scale(0.97)'),
          `Stylesheet ${path.basename(stylesheetPath)} must apply scale(0.98) or scale(0.97) press effect`
        );
        assert.ok(
          content.includes('transform: translateY(0px) scale(0.98)') ||
            content.includes('transform: translateY(0px) scale(0.97)') ||
            content.includes('transform: translateY(0px)'),
          `Stylesheet ${path.basename(stylesheetPath)} must reset translateY on active press`
        );
      }
    });
  });
});
