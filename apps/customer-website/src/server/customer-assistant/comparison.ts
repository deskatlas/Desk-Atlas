import type { ApprovedCharacteristic, PublicSpot } from '@deskatlas/domain';

// PRD-F26 / MS77-TC05/08: only current, revalidated map facts and approved evidence.
export function workspaceComparisonSummary(spots: PublicSpot[], characteristics: ApprovedCharacteristic[], scheduled: boolean): string {
  const lines = spots.map(spot => {
    const fact = (dimension: ApprovedCharacteristic['dimension']) => {
      const values = new Set(characteristics.filter(f => f.workspace_id === spot.workspace_id && f.dimension === dimension).map(f => f.value));
      return values.size === 1 ? [...values][0] : undefined;
    };
    const hasEvidence = (dimension: ApprovedCharacteristic['dimension']) => characteristics.some(f => f.workspace_id === spot.workspace_id && f.dimension === dimension);
    const power = fact('power');
    const powerText = power === true ? 'Power access: supported by approved evidence.' : power === false ? 'Power access: unavailable according to approved evidence.'
      : !hasEvidence('power') && spot.tags?.includes('Power Outlet') ? 'Power access: Power Outlet is listed on the published map.' : 'Power access: not verified in the published information.';
    const suitability = [`capacity supports ${spot.capacity === 1 ? 'one person' : `groups of up to ${spot.capacity} people`}`];
    if (fact('focus') === true || (!hasEvidence('focus') && spot.tags?.includes('Quiet'))) suitability.push('listed for quiet, focused work');
    if (fact('calls') === true) suitability.push('approved evidence supports calls');
    const tags = spot.tags?.filter(tag => ['Private', 'Open', 'Collaborative', 'Ergonomic', 'Standing Desk', 'Monitor Available', 'Natural Light'].includes(tag));
    if (tags?.length) suitability.push(`published features: ${tags.join(', ')}`);
    return `${spot.name}: capacity ${spot.capacity} ${spot.capacity === 1 ? 'person' : 'people'}; PHP ${spot.hourly_rate} per hour (published base rate). ${powerText} Suitability: ${suitability.join('; ')}. Further suitability depends on your needs; unlisted amenities and call permission are not assumed.`;
  });
  return `Comparison of the selected map spots:\n\n${lines.join('\n\n')}\n\n${scheduled ? 'See the checked availability and any returned base price quotes below.' : 'Availability and a schedule-specific price quote have not been checked. Share a business date, start time and duration to check them.'}`;
}
