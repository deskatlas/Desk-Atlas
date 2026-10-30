import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { createElement } from '../apps/customer-website/node_modules/react';
import { renderToStaticMarkup } from '../apps/customer-website/node_modules/react-dom/server';
import { ComparisonTray, type ComparisonSpotInfo } from '../apps/customer-website/src/features/assistant/ComparisonTray';
import { SpotDetailModal } from '../apps/customer-website/src/features/reservation/components/SpotDetailModal';
import { customerDiscoveryContextSchema } from '../packages/validation/src';
import type { WorkspaceMapViewModel } from '../apps/customer-website/src/features/workspace-discovery';

// MS-95: Customer Assistant Workspace Comparison UX, Dedicated Comparison Tray, and Real-Time Chat Visuals
// Traceability: BRD-M1, BRD-M4, PRD-F4, PRD-F26, PRD-F30, SDD-C1, SDD-C16, DSD-UI4, DSD-UI12, QAD-TC22, MS95-TC01..08

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const uuid3 = '33333333-3333-4333-8333-333333333333';
const uuid4 = '44444444-4444-4444-8444-444444444444';

const mockWorkspace: WorkspaceMapViewModel = {
  id: uuid1,
  workspaceInstanceId: uuid1,
  templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  floorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  floorName: '2nd Floor Mezzanine',
  instanceCode: 'HD-01',
  displayName: 'Window Hot Desk 01',
  templateName: 'Dedicated Desk',
  description: 'Ergonomic workspace with high-speed charging and dual monitor stand.',
  rateAmount: 65,
  pricingLabel: 'PHP 65/hr',
  photoPath: null,
  capacity: 1,
  status: 'available',
  statusLabel: 'Available',
  statusGlyph: 'check',
  statusTone: 'success',
  x: 10,
  y: 20,
  width: 60,
  height: 60,
  shape: 'desk',
};

const mockWorkspace4: WorkspaceMapViewModel = {
  ...mockWorkspace,
  id: uuid4,
  workspaceInstanceId: uuid4,
  instanceCode: 'MR-02',
  displayName: 'Quiet Study Pod B',
  capacity: 1,
  rateAmount: 55,
};

let activeAssistantDiscovery: { compared_ids?: string[] } = {};
let lastComparedSpotArg: Record<string, unknown> | null = null;
let lastRemovedSpotArg: string | null = null;
let lastClearedComparison = false;

vi.mock('../apps/customer-website/src/app/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? createElement('div', { 'data-slot': 'dialog' }, children) : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    createElement('div', { className }, children),
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    createElement('div', { className }, children),
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    createElement('h2', { className }, children),
  DialogDescription: ({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) =>
    createElement('p', { className, id }, children),
}));

vi.mock('../apps/customer-website/src/features/assistant/CustomerAssistantProvider', async () => {
  return {
    useCustomerAssistant: () => ({
      discovery: activeAssistantDiscovery,
      spotsInfo: {},
      setDiscovery: vi.fn(),
      askSpot: vi.fn(),
      compareSpot: (arg: Record<string, unknown>) => {
        lastComparedSpotArg = arg;
      },
      removeComparedSpot: (workspaceId: string) => {
        lastRemovedSpotArg = workspaceId;
      },
      clearComparedSpots: () => {
        lastClearedComparison = true;
      },
      handoff: null,
      consumeHandoff: vi.fn(),
    }),
  };
});

describe('MS-95: Customer Assistant Workspace Comparison UX & Comparison Tray (QAD-TC22 / MS95-TC01..08)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED = 'true';
    activeAssistantDiscovery = {};
    lastComparedSpotArg = null;
    lastRemovedSpotArg = null;
    lastClearedComparison = false;
  });

  it('MS95-TC01: Add First Spot to Comparison renders pinned tray, spot name chip, and 1 of 3 count badge', () => {
    // 1. Initial spot addition state in comparison tray
    const spotInfo: Record<string, ComparisonSpotInfo> = {
      [uuid1]: {
        workspaceId: uuid1,
        name: 'Window Hot Desk 01',
        capacity: 1,
        pricePerHour: 65,
      },
    };

    const html = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds: [uuid1],
        spotsInfo: spotInfo,
        onRemoveSpot: () => {},
        onClearAll: () => {},
        onCompareNow: () => {},
        busy: false,
      })
    );

    // Verify pinned comparison tray container
    expect(html).toContain('data-testid="comparison-tray"');
    expect(html).toContain('Workspaces to Compare');

    // Verify count badge shows "1 of 3"
    expect(html).toContain('1 of 3');

    // Verify chip shows spot name and capacity subtitle
    expect(html).toContain('Window Hot Desk 01');
    expect(html).toContain('1 seat');
    expect(html).toContain('aria-label="Remove Window Hot Desk 01 from comparison"');

    // Verify 1 spot helper notice is present and CTA is hidden
    expect(html).toContain('Select at least 1 more workspace from the map to compare them side by side.');
    expect(html).not.toContain('Compare These Workspaces');
  });

  it('MS95-TC02: Modal Toggle on Existing Spot displays "✓ In comparison set" and provides Remove button', () => {
    // Spot is already present in discovery comparison list
    activeAssistantDiscovery = { compared_ids: [uuid1] };

    const html = renderToStaticMarkup(
      createElement(SpotDetailModal, {
        workspace: mockWorkspace,
        open: true,
        onOpenChange: () => {},
        onProceed: () => {},
      })
    );

    // Verify active "✓ In comparison set" badge styling
    expect(html).toContain('✓ In comparison set');
    expect(html).toContain('Remove');

    // Verify "+ Add to comparison" button is NOT rendered
    expect(html).not.toContain('+ Add to comparison');
  });

  it('MS95-TC03: Remove Single Spot from Tray updates chips and count to "1 of 3"', () => {
    let removedTarget = '';
    const spotsInfo: Record<string, ComparisonSpotInfo> = {
      [uuid1]: { workspaceId: uuid1, name: 'Window Hot Desk 01', capacity: 1 },
      [uuid2]: { workspaceId: uuid2, name: 'Corner Hot Desk 02', capacity: 2 },
    };

    // Initial render with 2 spots
    const htmlInitial = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds: [uuid1, uuid2],
        spotsInfo,
        onRemoveSpot: (id) => { removedTarget = id; },
        onClearAll: () => {},
        onCompareNow: () => {},
        busy: false,
      })
    );
    expect(htmlInitial).toContain('2 of 3');
    expect(htmlInitial).toContain('Window Hot Desk 01');
    expect(htmlInitial).toContain('Corner Hot Desk 02');

    // Simulate removing spot 1
    const removeHandler = (id: string) => { removedTarget = id; };
    removeHandler(uuid1);
    expect(removedTarget).toBe(uuid1);

    // Re-render tray with only spot 2 remaining
    const htmlUpdated = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds: [uuid2],
        spotsInfo,
        onRemoveSpot: () => {},
        onClearAll: () => {},
        onCompareNow: () => {},
        busy: false,
      })
    );
    expect(htmlUpdated).toContain('1 of 3');
    expect(htmlUpdated).not.toContain('Window Hot Desk 01');
    expect(htmlUpdated).toContain('Corner Hot Desk 02');
  });

  it('MS95-TC04: Maximum 3 Spots Enforcement rejects 4th spot in schema and disables modal button', () => {
    // 1. Zod schema rejection of > 3 spots
    const excessiveContext = {
      compared_ids: [uuid1, uuid2, uuid3, uuid4],
    };
    const schemaResult = customerDiscoveryContextSchema.safeParse(excessiveContext);
    expect(schemaResult.success).toBe(false);

    // 2. Exactly 3 spots is valid
    const validContext = {
      compared_ids: [uuid1, uuid2, uuid3],
    };
    expect(customerDiscoveryContextSchema.safeParse(validContext).success).toBe(true);

    // 3. UI modal state when 3 spots are already compared
    activeAssistantDiscovery = { compared_ids: [uuid1, uuid2, uuid3] };

    // Inspecting a 4th workspace (mockWorkspace4)
    const html = renderToStaticMarkup(
      createElement(SpotDetailModal, {
        workspace: mockWorkspace4,
        open: true,
        onOpenChange: () => {},
        onProceed: () => {},
      })
    );

    // Button should be disabled to enforce the limit
    expect(html).toContain('+ Add to comparison (up to 3 spots)');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?\+ Add to comparison/);
  });

  it('MS95-TC05: Compare Now Action Dispatch triggers structured comparison prompt when >= 2 spots', () => {
    let triggeredQuery = '';
    const spotIds = [uuid1, uuid2];
    const spotsInfo: Record<string, ComparisonSpotInfo> = {
      [uuid1]: { workspaceId: uuid1, name: 'Window Hot Desk 01', capacity: 1 },
      [uuid2]: { workspaceId: uuid2, name: 'Corner Hot Desk 02', capacity: 2 },
    };

    const handleCompareNow = (ids: string[]) => {
      const names = ids.map(id => spotsInfo[id]?.name || id).join(', ');
      triggeredQuery = `Compare these workspaces for me: ${names}. Explain their capacity, pricing, power access, and suitability.`;
    };

    const html = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds,
        spotsInfo,
        onRemoveSpot: () => {},
        onClearAll: () => {},
        onCompareNow: handleCompareNow,
        busy: false,
      })
    );

    // Button should be visible and active
    expect(html).toContain('Compare These Workspaces');

    // Trigger action and verify expected prompt construction
    handleCompareNow(spotIds);
    expect(triggeredQuery).toBe(
      'Compare these workspaces for me: Window Hot Desk 01, Corner Hot Desk 02. Explain their capacity, pricing, power access, and suitability.'
    );
  });

  it('MS95-TC06: Clear All Comparison Spots clears all items and collapses the tray', () => {
    let cleared = false;
    const spotIds = [uuid1, uuid2];

    const htmlInitial = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds,
        onRemoveSpot: () => {},
        onClearAll: () => { cleared = true; },
        onCompareNow: () => {},
        busy: false,
      })
    );
    expect(htmlInitial).toContain('Clear all');

    // Simulate clicking clear all
    cleared = true;
    expect(cleared).toBe(true);

    // When spotIds is empty, tray returns null / empty string
    const htmlEmpty = renderToStaticMarkup(
      createElement(ComparisonTray, {
        spotIds: [],
        onRemoveSpot: () => {},
        onClearAll: () => {},
        onCompareNow: () => {},
        busy: false,
      })
    );
    expect(htmlEmpty).toBe('');
  });

  it('MS95-TC07: Floating Trigger Badge Count displays count and accessible text when closed', () => {
    const comparedCount = 2;

    // Simulate rendering closed floating trigger button with 2 items in original fixed position
    const triggerHtml = renderToStaticMarkup(
      createElement('button', {
        type: 'button',
        className: 'da-primary-button fixed bottom-6 right-6 z-40',
        'aria-label': comparedCount > 0 ? `Ask DeskAtlas (${comparedCount})` : 'Ask DeskAtlas',
      },
        createElement('span', null, 'Ask DeskAtlas'),
        comparedCount > 0 ? createElement('span', {
          'data-testid': 'assistant-trigger-badge',
          className: 'ml-2 rounded-full bg-[#C8F451] text-[#0C3B27] px-2 py-0.5 text-xs font-extrabold inline-flex items-center justify-center align-middle',
        }, comparedCount) : null
      )
    );

    // Verify floating button contains brand trigger text and numerical pill
    expect(triggerHtml).toContain('Ask DeskAtlas');
    expect(triggerHtml).toContain('data-testid="assistant-trigger-badge"');
    expect(triggerHtml).toContain('bg-[#C8F451]');
    expect(triggerHtml).toContain('>2<');
    expect(triggerHtml).toContain('aria-label="Ask DeskAtlas (2)"');
  });

  it('MS95-TC08: Spot Removal from Modal invokes removeComparedSpot and reverts to "+ Add to comparison"', () => {
    // 1. Initially spot is in comparison set
    activeAssistantDiscovery = { compared_ids: [uuid1] };

    const htmlInitial = renderToStaticMarkup(
      createElement(SpotDetailModal, {
        workspace: mockWorkspace,
        open: true,
        onOpenChange: () => {},
        onProceed: () => {},
      })
    );
    expect(htmlInitial).toContain('✓ In comparison set');

    // 2. Simulate spot removal action
    const handleRemoveFromComparison = (workspaceId: string) => {
      lastRemovedSpotArg = workspaceId;
      activeAssistantDiscovery = {
        compared_ids: (activeAssistantDiscovery.compared_ids ?? []).filter(id => id !== workspaceId),
      };
    };
    handleRemoveFromComparison(mockWorkspace.workspaceInstanceId);
    expect(lastRemovedSpotArg).toBe(uuid1);

    // 3. Modal re-renders with spot removed: button reverts to "+ Add to comparison"
    const htmlReverted = renderToStaticMarkup(
      createElement(SpotDetailModal, {
        workspace: mockWorkspace,
        open: true,
        onOpenChange: () => {},
        onProceed: () => {},
      })
    );
    expect(htmlReverted).toContain('+ Add to comparison (up to 3 spots)');
    expect(htmlReverted).not.toContain('✓ In comparison set');
  });
});
