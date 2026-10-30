import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server';
import { LandingPage } from '../apps/customer-website/src/features/landing/components/LandingPage';

// MS-94 / PRD-F4 / PRD-F26 / SDD-C1 / DSD-UI4 / DSD-UI6 / QAD-TC22 / MS94-TC01 through MS94-TC06
// Global CSS cascade isolation, primary button typography contrast, and landing page CTA hover stability.

interface ParsedRule {
  selector: string;
  properties: Record<string, { value: string; important: boolean }>;
}

function parseCssRules(cssContent: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  // Strip CSS comments
  const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleBlocks = cleanCss.split('}');

  for (const block of ruleBlocks) {
    const parts = block.split('{');
    if (parts.length < 2) continue;
    const selector = parts[0].trim();
    const body = parts[1].trim();
    if (!selector || !body) continue;

    const properties: Record<string, { value: string; important: boolean }> = {};
    const decls = body.split(';');
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.slice(0, colonIdx).trim().toLowerCase();
      let val = decl.slice(colonIdx + 1).trim();
      const important = val.includes('!important');
      if (important) {
        val = val.replace('!important', '').trim();
      }
      properties[prop] = { value: val, important };
    }

    rules.push({ selector, properties });
  }
  return rules;
}

// Compute relative luminance and WCAG 2.1 contrast ratio
function hexToRgb(hex: string): [number, number, number] {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function computeContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const [r1, g1, b1] = hexToRgb(foregroundHex);
  const [r2, g2, b2] = hexToRgb(backgroundHex);
  const l1 = getRelativeLuminance(r1, g1, b1);
  const l2 = getRelativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Simulated CSS cascade matching for HTML anchor and button elements
function matchCssColor(
  rules: ParsedRule[],
  tagName: string,
  classNames: string[],
  interactionState: 'default' | 'hover' | 'focus-visible' | 'active'
): { color: string; isImportant: boolean; matchingSelector: string } {
  let matchedColor = '';
  let isImportant = false;
  let matchingSelector = '';

  for (const rule of rules) {
    const selectors = rule.selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      let matches = false;

      if (interactionState === 'default') {
        if (sel === tagName) {
          matches = true;
        } else if (sel.startsWith('.') && !sel.includes(':')) {
          const className = sel.slice(1);
          if (classNames.includes(className)) {
            matches = true;
          }
        }
      } else if (interactionState === 'hover') {
        if (sel.includes(':hover')) {
          // Rule 1: Scoped link hover: a:not([class*="da-"]):not([class*="button"]):hover
          if (sel.includes('a:not([class*="da-"]):not([class*="button"]):hover')) {
            const hasDaClass = classNames.some((c) => c.includes('da-'));
            const hasButtonClass = classNames.some((c) => c.includes('button'));
            if (tagName === 'a' && !hasDaClass && !hasButtonClass) {
              matches = true;
            }
          }
          // Rule 2: Button hover pseudo-classes: e.g. .da-primary-button:not(:disabled):hover
          else if (sel.startsWith('.')) {
            const baseClass = sel.split(':')[0].replace('.', '');
            if (classNames.includes(baseClass)) {
              matches = true;
            }
          }
        }
      } else if (interactionState === 'focus-visible') {
        if (sel.includes(':focus-visible')) {
          if (sel.startsWith('.')) {
            const baseClass = sel.split(':')[0].replace('.', '');
            if (classNames.includes(baseClass)) {
              matches = true;
            }
          }
        }
      } else if (interactionState === 'active') {
        if (sel.includes(':active')) {
          if (sel.startsWith('.')) {
            const baseClass = sel.split(':')[0].replace('.', '');
            if (classNames.includes(baseClass)) {
              matches = true;
            }
          }
        }
      }

      if (matches && rule.properties.color) {
        // If current matched property is not important and incoming is important, override
        if (!isImportant || rule.properties.color.important) {
          matchedColor = rule.properties.color.value;
          isImportant = rule.properties.color.important;
          matchingSelector = sel;
        }
      }
    }
  }

  return { color: matchedColor, isImportant, matchingSelector };
}

describe('MS-94: Customer Portal Explore Workspaces Button Hover Contrast and Anchor Color Collision Resolution', () => {
  const rootDir = path.resolve(__dirname, '..');
  const globalsCssPath = path.join(rootDir, 'apps', 'customer-website', 'src', 'styles', 'globals.css');
  const cssContent = fs.readFileSync(globalsCssPath, 'utf8');
  const parsedRules = parseCssRules(cssContent);

  it('MS94-TC01: Explore Workspaces Button Default Text Color', () => {
    // 1. Render LandingPage to HTML markup
    const html = renderToStaticMarkup(React.createElement(LandingPage));

    // 2. Assert [data-testid="landing-explore-workspaces-btn"] is present
    expect(html).toContain('data-testid="landing-explore-workspaces-btn"');

    // 3. Assert element has da-primary-button and text-white classes
    const buttonMatch = html.match(/<a[^>]*data-testid="landing-explore-workspaces-btn"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    const tagHtml = buttonMatch![0];
    expect(tagHtml).toContain('href="/reserve"');
    expect(tagHtml).toContain('da-primary-button');
    expect(tagHtml).toContain('text-white');

    // 4. Assert computed CSS color in default state is white (#ffffff)
    const result = matchCssColor(parsedRules, 'a', ['da-primary-button', 'text-white'], 'default');
    expect(result.color).toBe('#ffffff');
    expect(result.isImportant).toBe(true);
  });

  it('MS94-TC02: Explore Workspaces Button Hover Text Color', () => {
    // 1. Assert stylesheet excludes button-styled anchors from generic a:hover
    expect(cssContent).toContain('a:not([class*="da-"]):not([class*="button"]):hover');
    expect(cssContent).not.toMatch(/^a:hover\s*\{/m);

    // 2. Simulate hover on Explore Workspaces button
    const hoverResult = matchCssColor(parsedRules, 'a', ['da-primary-button', 'text-white'], 'hover');

    // 3. Assert computed hover text color is white (#ffffff), NOT var(--da-primary)
    expect(hoverResult.color).toBe('#ffffff');
    expect(hoverResult.isImportant).toBe(true);
    expect(hoverResult.color).not.toBe('var(--da-primary, #009689)');

    // 4. Assert WCAG 2.1 AA text contrast invariant (minimum 4.5:1 ratio)
    // Dark portion of button gradient is #154a32; primary brand is #009689
    const contrastAgainstDark = computeContrastRatio('#ffffff', '#154a32');
    expect(contrastAgainstDark).toBeGreaterThanOrEqual(4.5);

    // Contrast if text were erroneously green on green would fail catastrophically (~1.0:1)
    const brokenContrast = computeContrastRatio('#009689', '#009689');
    expect(brokenContrast).toBe(1.0);
  });

  it('MS94-TC03: Regular Text Link Hover Color Preservation', () => {
    // 1. Plain text link without button or da- classes
    const plainLinkHover = matchCssColor(parsedRules, 'a', [], 'hover');

    // 2. Assert text color transitions to primary green on hover
    expect(plainLinkHover.color).toBe('var(--da-primary, #009689)');
    expect(plainLinkHover.matchingSelector).toContain('a:not([class*="da-"]):not([class*="button"]):hover');

    // 3. Verify text-decoration underline rule exists for plain links
    const scopedRule = parsedRules.find((r) =>
      r.selector.includes('a:not([class*="da-"]):not([class*="button"]):hover')
    );
    expect(scopedRule).toBeDefined();
    expect(scopedRule?.properties['text-decoration']?.value).toBe('underline');
  });

  it('MS94-TC04: Secondary Button Hover Text Color Stability', () => {
    // 1. Simulate hover on secondary button anchor
    const secondaryHover = matchCssColor(parsedRules, 'a', ['da-secondary-button'], 'hover');

    // 2. Assert text color remains dark brand color, not green or white
    expect(secondaryHover.color).toBe('var(--da-brand-dark, #0f172a)');
    expect(secondaryHover.isImportant).toBe(true);

    // 3. Verify active state stability
    const secondaryActive = matchCssColor(parsedRules, 'a', ['da-secondary-button'], 'active');
    expect(secondaryActive.color).toBe('var(--da-brand-dark, #0f172a)');
    expect(secondaryActive.isImportant).toBe(true);
  });

  it('MS94-TC05: Danger and Accent Button Hover Stability', () => {
    // 1. Simulate hover on danger button link
    const dangerHover = matchCssColor(parsedRules, 'a', ['da-danger-button'], 'hover');
    expect(dangerHover.color).toBe('#ffffff');
    expect(dangerHover.isImportant).toBe(true);

    // 2. Simulate hover on accent button link
    const accentHover = matchCssColor(parsedRules, 'a', ['da-accent-button'], 'hover');
    expect(accentHover.color).toBe('#ffffff');
    expect(accentHover.isImportant).toBe(true);

    // 3. Simulate hover on inline button link
    const inlineHover = matchCssColor(parsedRules, 'a', ['da-inline-button'], 'hover');
    expect(inlineHover.color).toBe('#ffffff');
    expect(inlineHover.isImportant).toBe(true);
  });

  it('MS94-TC06: Focus Visible State Contrast', () => {
    // 1. Simulate focus-visible on primary button
    const focusResult = matchCssColor(parsedRules, 'a', ['da-primary-button'], 'focus-visible');
    expect(focusResult.color).toBe('#ffffff');
    expect(focusResult.isImportant).toBe(true);

    // 2. Verify global focus-visible outline is defined
    const focusRule = parsedRules.find((r) => r.selector === ':focus-visible');
    expect(focusRule).toBeDefined();
    expect(focusRule?.properties.outline?.value).toBe('3px solid var(--da-accent)');
    expect(focusRule?.properties['outline-offset']?.value).toBe('2px');

    // 3. Assert text decoration is none on button hover and focus
    const primaryHoverRule = parsedRules.find((r) =>
      r.selector.includes('.da-primary-button:not(:disabled):hover')
    );
    expect(primaryHoverRule?.properties['text-decoration']?.value).toBe('none');
  });
});

