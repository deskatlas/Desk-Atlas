import { beforeEach, expect, it, vi } from 'vitest';
const maps = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@deskatlas/domain', async importOriginal => ({
  ...await importOriginal<typeof import('@deskatlas/domain')>(),
  SupabasePublishedMapRepository: class {},
  createPublishedMapService: () => ({ loadAllPublishedFloorMaps: maps.load }),
}));
import { resolvePublicComparison } from '../apps/customer-website/src/server/customer-assistant/spots';

beforeEach(() => maps.load.mockResolvedValue([{ elements: [
  { workspace: { workspaceInstanceId: 'one', displayName: 'Think Spot 1', instanceCode: 'THI-ONE', isBookable: true } },
  { workspace: { workspaceInstanceId: 'two', displayName: 'Think Spot 2', instanceCode: 'THI-TWO', isBookable: true } },
  { workspace: { workspaceInstanceId: 'three', displayName: 'Think Spot 3', instanceCode: 'THI-THREE', isBookable: false } },
] }]));

it('accepts ordinary short labels when each has one published match, including a currently unavailable comparison', async () => {
  expect(await resolvePublicComparison(['spot 1', 'Spot 2', 'Think Spot 3'])).toEqual(['one', 'two', 'three']);
});

it('asks for clarification when a short label has multiple published matches', async () => {
  maps.load.mockResolvedValue([{ elements: [
    { workspace: { workspaceInstanceId: 'one', displayName: 'Think Spot 1', instanceCode: 'ONE' } },
    { workspace: { workspaceInstanceId: 'other', displayName: 'Study Spot 1', instanceCode: 'OTHER' } },
  ] }]);
  expect(await resolvePublicComparison(['spot 1'])).toBeNull();
});
