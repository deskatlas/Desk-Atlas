export interface AmenityCategory {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export const WORKSPACE_AMENITY_CATEGORIES: AmenityCategory[] = [
  {
    id: 'environment',
    name: 'Environment',
    description: 'Conditions may vary depending on the time of day, weather, and workspace activity.',
    tags: ['Cool', 'Warm', 'Hot', 'Cold', 'Sun-Exposed', 'Shaded'],
  },
  {
    id: 'noise_activity',
    name: 'Noise & Activity',
    description: 'May change depending on the time and number of people present.',
    tags: ['Quiet', 'Moderate Noise', 'Busy', 'Crowded', 'Low Traffic', 'High Traffic'],
  },
  {
    id: 'lighting_view',
    name: 'Lighting & View',
    description: 'May change depending on the time of day and surrounding conditions.',
    tags: ['Bright', 'Dim', 'Natural Light', 'Good View', 'Near Window'],
  },
  {
    id: 'space_privacy',
    name: 'Space & Privacy',
    description: 'May vary depending on nearby users and workspace activity.',
    tags: ['Spacious', 'Private', 'Open', 'Collaborative'],
  },
  {
    id: 'desk_features',
    name: 'Desk Features',
    description: 'May vary depending on the assigned desk and workspace setup.',
    tags: ['Wi-Fi', 'Power Outlet', 'Ergonomic', 'Adjustable', 'Standing Desk', 'Monitor Available'],
  },
];

export const ALL_WORKSPACE_RECOMMENDATION_TAGS: string[] = WORKSPACE_AMENITY_CATEGORIES.flatMap(
  (category) => category.tags
);

export function normalizeAmenityTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.toLowerCase() === 'moderate') {
    return 'Moderate Noise';
  }
  return trimmed;
}

export function getAmenityCategoryForTag(tag: string): AmenityCategory | undefined {
  const normalized = normalizeAmenityTag(tag).toLowerCase();
  return WORKSPACE_AMENITY_CATEGORIES.find((cat) =>
    cat.tags.some((t) => t.toLowerCase() === normalized)
  );
}

export function groupTagsByCategory(
  tags: string[]
): Array<{ category: AmenityCategory; tags: string[] }> {
  if (!Array.isArray(tags) || tags.length === 0) return [];

  const normalizedInputTags = tags
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => normalizeAmenityTag(t));

  const grouped: Array<{ category: AmenityCategory; tags: string[] }> = [];

  for (const category of WORKSPACE_AMENITY_CATEGORIES) {
    const matchingTags = normalizedInputTags.filter((tag) =>
      category.tags.some((t) => t.toLowerCase() === tag.trim().toLowerCase())
    );
    if (matchingTags.length > 0) {
      grouped.push({
        category,
        tags: matchingTags,
      });
    }
  }

  // Also collect any legacy or custom tags not in standard taxonomy
  const standardTagsLower = new Set(ALL_WORKSPACE_RECOMMENDATION_TAGS.map((t) => t.toLowerCase()));
  const extraTags = normalizedInputTags.filter((t) => !standardTagsLower.has(t.trim().toLowerCase()));
  if (extraTags.length > 0) {
    grouped.push({
      category: {
        id: 'other',
        name: 'Other Features',
        description: 'Additional attributes for this workspace.',
        tags: extraTags,
      },
      tags: extraTags,
    });
  }

  return grouped;
}

