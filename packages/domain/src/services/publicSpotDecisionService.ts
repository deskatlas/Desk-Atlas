import type { CustomerDiscoveryContext, CustomerSpotSuggestion } from '@deskatlas/validation';

// MS77-TC05-TC09 / PRD-F1-F4: reads and deterministic ranking create no holds.
export interface PublicSpot {
  workspace_id: string; template_id: string; floor_id: string; map_version_id: string;
  name: string; capacity: number; hourly_rate: number;
  template_name?: string; tags?: string[];
}
export interface ApprovedCharacteristic {
  workspace_id: string; dimension: 'focus' | 'calls' | 'power'; value: boolean;
  chunk_id: string; quote: string;
}
export interface SpotDecisionRepository {
  candidates(context: CustomerDiscoveryContext): Promise<{ spots: PublicSpot[]; has_more: boolean }>;
  availability(spots: PublicSpot[], context: CustomerDiscoveryContext): Promise<Set<string>>;
  prices(spots: PublicSpot[], context: CustomerDiscoveryContext): Promise<Map<string, number>>;
}
export async function decidePublicSpots(repository: SpotDecisionRepository, context: CustomerDiscoveryContext,
  characteristics: ApprovedCharacteristic[], now: () => string = () => new Date().toISOString(),
  snapshot?: Awaited<ReturnType<SpotDecisionRepository['candidates']>>) {
  const initial = snapshot ?? await repository.candidates(context);
  if (initial.has_more || initial.spots.length > 12) return { narrow: true, suggestions: [] as CustomerSpotSuggestion[], changed: false };
  const scheduled = Boolean(context.date && context.start_time && context.duration_minutes);
  const first = scheduled ? await repository.availability(initial.spots, context) : new Set(initial.spots.map(s => s.workspace_id));
  const eligible = initial.spots.filter(s => first.has(s.workspace_id) && s.capacity >= (context.preferences?.group_size ?? 1));
  const prices = scheduled ? await repository.prices(eligible, context) : new Map<string, number>();
  const rank = (spots: PublicSpot[]) => spots.flatMap(spot => {
    const amount = prices.get(spot.workspace_id);
    if (context.preferences?.budget !== undefined && (amount === undefined || amount > context.preferences.budget)) return [];
    const reasons: CustomerSpotSuggestion['reasons'] = [];
    const catalog_reasons: NonNullable<CustomerSpotSuggestion['catalog_reasons']> = [];
    for (const dimension of ['focus', 'calls', 'power'] as const) {
      const facts = characteristics.filter(f => f.workspace_id === spot.workspace_id && f.dimension === dimension);
      // No implicit per-instance override and no ranking on unresolved contradictions.
      if (new Set(facts.map(f => f.value)).size !== 1) continue;
      const match = facts.find(f => context.preferences?.[dimension] !== undefined && f.value === context.preferences[dimension]);
      if (match) reasons.push({ dimension, chunk_id: match.chunk_id, quote: match.quote });
    }
    for (const [dimension, tag] of [['focus', 'Quiet'], ['power', 'Power Outlet']] as const) {
      const facts = characteristics.filter(f => f.workspace_id === spot.workspace_id && f.dimension === dimension);
      if (context.preferences?.[dimension] === true && !facts.length && spot.tags?.includes(tag)) catalog_reasons.push({ dimension, tag });
    }
    const as_of = now();
    return [{ workspace_id: spot.workspace_id, template_id: spot.template_id, floor_id: spot.floor_id,
      map_version_id: spot.map_version_id, name: spot.name, capacity: spot.capacity,
      score: reasons.length + catalog_reasons.length, reasons, catalog_reasons, availability: scheduled ? 'AVAILABLE' as const : 'NOT_CHECKED' as const, as_of,
      ...(amount !== undefined ? { quote: { amount, currency: 'PHP' as const, rate_type: 'HOURLY' as const, as_of } } : {}),
    }];
  }).sort((a, b) => b.score - a.score || a.workspace_id.localeCompare(b.workspace_id));
  // Re-read current map/catalog and one final availability batch before release.
  const latest = await repository.candidates(context);
  const available = scheduled ? await repository.availability(latest.spots, context) : new Set(latest.spots.map(s => s.workspace_id));
  const stable = eligible.filter(s => available.has(s.workspace_id) && latest.spots.some(l =>
    l.workspace_id === s.workspace_id && l.map_version_id === s.map_version_id && l.template_id === s.template_id &&
    l.capacity === s.capacity && l.hourly_rate === s.hourly_rate && l.name === s.name && JSON.stringify(l.tags) === JSON.stringify(s.tags)));
  return { narrow: latest.has_more, suggestions: latest.has_more ? [] : rank(stable).slice(0, 3), changed: stable.length !== eligible.length };
}
