import { expect, it } from 'vitest';
import { decidePublicSpots, type PublicSpot, type SpotDecisionRepository } from '../packages/domain/src/services/publicSpotDecisionService';

const spot = (suffix: string, tags: string[]): PublicSpot => ({ workspace_id: `00000000-0000-4000-8000-00000000000${suffix}`,
  template_id: '00000000-0000-4000-8000-000000000011', floor_id: '00000000-0000-4000-8000-000000000012',
  map_version_id: '00000000-0000-4000-8000-000000000013', name: `Spot ${suffix}`, capacity: 1, hourly_rate: 50, tags });
const context = { date: '2026-10-25', start_time: '09:00', duration_minutes: 120, preferences: { focus: true, power: true, budget: 110 } };
const repository = (spots: PublicSpot[]): SpotDecisionRepository => ({ candidates: async () => ({ spots, has_more: false }),
  availability: async spots => new Set(spots.map(spot => spot.workspace_id)), prices: async spots => new Map(spots.map(spot => [spot.workspace_id, 100])) });

it('ranks three spots against saved focus and power preferences using published tags', async () => {
  const spots = [spot('1', []), spot('2', ['Quiet']), spot('3', ['Quiet', 'Power Outlet'])];
  const answer = await decidePublicSpots(repository(spots), context, []);
  expect(answer.suggestions.map(spot => spot.name)).toEqual(['Spot 3', 'Spot 2', 'Spot 1']);
  expect(answer.suggestions[0].score).toBe(2);
  expect(answer.suggestions[0].catalog_reasons).toEqual([{ dimension: 'focus', tag: 'Quiet' }, { dimension: 'power', tag: 'Power Outlet' }]);
  expect(answer.suggestions[0].quote?.amount).toBe(100);
});

it('does not infer call permission from quiet, private or collaborative map tags', async () => {
  const answer = await decidePublicSpots(repository([spot('1', ['Quiet', 'Private', 'Collaborative'])]), { ...context, preferences: { calls: true } }, []);
  expect(answer.suggestions[0].score).toBe(0);
  expect(answer.suggestions[0].reasons).toEqual([]);
  expect(answer.suggestions[0].catalog_reasons).toEqual([]);
});

it('does not let map tags override a contrary approved policy', async () => {
  const candidate = spot('1', ['Quiet']);
  const answer = await decidePublicSpots(repository([candidate]), context, [{ workspace_id: candidate.workspace_id, dimension: 'focus', value: false,
    chunk_id: '00000000-0000-4000-8000-000000000021', quote: 'Not suitable for focused work.' }]);
  expect(answer.suggestions[0].score).toBe(0);
});

it('withholds a recommendation when published tags change during the availability check', async () => {
  const candidate = spot('1', ['Quiet']);
  const repo = repository([candidate]);
  let reads = 0;
  repo.candidates = async () => ({ spots: [++reads === 1 ? candidate : { ...candidate, tags: [] }], has_more: false });
  const answer = await decidePublicSpots(repo, context, []);
  expect(answer.changed).toBe(true);
  expect(answer.suggestions).toEqual([]);
});
