// PRD-F1-F4/F26 / MS77-TC05/08/12: real conversation and public name seams.
import { describe, expect, it } from 'vitest';
import type { PublishedFloorMap } from '@deskatlas/domain';
import { mergeConversationConstraints, missingScheduleQuestion, requestsPrivateRecord } from '../apps/customer-website/src/server/customer-assistant/conversation';
import { resolveWorkspaceNames } from '../apps/customer-website/src/server/customer-assistant/spots';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const published: PublishedFloorMap[] = [{ floor: { id: id(1), name: 'Ground Floor', floorNumber: 0, displayOrder: 0, isActive: true },
  version: { id: id(2), versionNumber: 1, canvasWidth: 100, canvasHeight: 100, gridSize: 10, publishedAt: null },
  elements: [1, 2].map(n => ({ id: id(n + 10), elementRole: 'WORKSPACE', elementType: 'RECT', x: 0, y: 0, width: 10, height: 10,
    rotation: 0, zIndex: 0, label: null, style: {}, workspace: { workspaceInstanceId: id(n + 20), templateId: id(3), floorId: id(1),
      instanceCode: `FP-${n}`, displayName: `Focus Pod Spot ${n}`, templateName: 'Focus Pod', description: null, photoPath: null,
      capacity: 1, rateAmount: 100, pricingUnit: 'HOURLY', operationalStatus: 'ACTIVE', isBookable: true, blockingReason: null } })) }];

describe('public/private procedure contract', () => {
  it.each(['It is my first time here. How does booking work?', 'How do I pay for my booking?', 'Can I cancel my reservation?',
    'What happens if I miss my check-in?'] )('keeps general procedure public: %s', question => expect(requestsPrivateRecord(question)).toBe(false));
  it.each(['What is the status of my reservation?', 'Show my Customer ID', 'Find my reference code',
    'When does my booking start?', 'How can I see the status of my payment?'] )('protects record requests: %s', question => expect(requestsPrivateRecord(question)).toBe(true));
});

it('resolves today/tomorrow using Philippine business time across UTC and month boundaries', () => {
  const now = new Date('2026-10-31T16:30:00Z');
  expect(mergeConversationConstraints(undefined, { relative_date: 'TODAY' }, now).date).toBe('2026-11-01');
  expect(mergeConversationConstraints(undefined, { relative_date: 'TOMORROW' }, now).date).toBe('2026-11-02');
});
it('merges explicit corrections without erasing other saved constraints or false preferences', () => {
  const result = mergeConversationConstraints({ start_time: '07:00', duration_minutes: 120, preferences: { focus: true, group_size: 1 } },
    { start_time: '09:00', preferences: { focus: false, budget: 500 } });
  expect(result).toEqual({ start_time: '09:00', duration_minutes: 120, preferences: { focus: false, group_size: 1, budget: 500 } });
  expect(missingScheduleQuestion({ date: '2026-11-01', start_time: '07:00' })).toMatch(/duration/);
  expect(() => mergeConversationConstraints(undefined, { date: '2026-02-31' })).toThrow();
});
it('resolves category and floor before the bounded candidate query, clearing stale selected pointers', () => {
  const result = resolveWorkspaceNames(published, { workspace_id: id(99), compared_ids: [id(98)], start_time: '07:00' }, 'focus pods', 'Ground Floor');
  expect(result.context).toEqual({ template_id: id(3), floor_id: id(1), start_time: '07:00' });
  expect(result.clarification).toBeUndefined();
  expect(result.offered_names).toEqual(['Focus Pod Spot 1', 'Focus Pod Spot 2']);
});
it('recovers a category supplied by a legacy planner as a physical comparison name', () => {
  expect(resolveWorkspaceNames(published, {}, undefined, undefined, ['Focus Pod']).context.template_id).toBe(id(3));
  expect(resolveWorkspaceNames(published, {}, undefined, undefined, ['FP-2']).context.compared_ids).toEqual([id(22)]);
});
it('does not guess ambiguous or unpublished names and retains supplied schedule while clarifying', () => {
  const result = resolveWorkspaceNames(published, { start_time: '07:00' }, 'Private Office');
  expect(result.clarification).toContain('Focus Pod');
  expect(result.context).toEqual({ start_time: '07:00' });
  expect(resolveWorkspaceNames(published, {}, undefined, undefined, ['Focus Pod', 'FP-2']).clarification).toBeTruthy();
});
it('uses the literal current published choice rather than a stale floor interpretation', () => {
  expect(resolveWorkspaceNames(published, {}, undefined, 'A different floor', [], 'Ground Floor please.').context.floor_id).toBe(id(1));
  const main = [{ ...published[0], floor: { ...published[0].floor, name: 'Main' } }];
  expect(resolveWorkspaceNames(main, {}, undefined, 'Main Floor').context.floor_id).toBe(id(1));
  expect(resolveWorkspaceNames(main, {}, undefined, 'Ground Floor', [], 'Main please.').context.floor_id).toBe(id(1));
});
