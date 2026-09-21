-- MF-173: Rename workspace recommendation tag "Moderate" to "Moderate Noise" across stored floor maps and templates

-- 1. Update map_elements properties JSONB where recommendationTags contains "Moderate"
-- Temporarily disable the draft integrity trigger so published/archived map versions can be migrated
ALTER TABLE public.map_elements DISABLE TRIGGER trg_map_elements_integrity;

UPDATE public.map_elements
SET properties = jsonb_set(
  properties,
  '{recommendationTags}',
  (
    SELECT jsonb_agg(
      CASE WHEN elem::text = '"Moderate"' THEN '"Moderate Noise"'::jsonb ELSE elem END
    )
    FROM jsonb_array_elements(properties->'recommendationTags') AS elem
  )
)
WHERE properties ? 'recommendationTags'
  AND properties->'recommendationTags' @> '["Moderate"]'::jsonb;

ALTER TABLE public.map_elements ENABLE TRIGGER trg_map_elements_integrity;

-- 2. Update workspace_templates default_style JSONB where recommendationTags contains "Moderate"
UPDATE public.workspace_templates
SET default_style = jsonb_set(
  default_style,
  '{recommendationTags}',
  (
    SELECT jsonb_agg(
      CASE WHEN elem::text = '"Moderate"' THEN '"Moderate Noise"'::jsonb ELSE elem END
    )
    FROM jsonb_array_elements(default_style->'recommendationTags') AS elem
  )
)
WHERE default_style ? 'recommendationTags'
  AND default_style->'recommendationTags' @> '["Moderate"]'::jsonb;

-- 3. Update floor_map_drafts draft_data JSONB if containing "Moderate"
UPDATE public.floor_map_drafts
SET draft_data = regexp_replace(draft_data::text, '"Moderate"', '"Moderate Noise"', 'g')::jsonb
WHERE draft_data::text LIKE '%"Moderate"%';

-- 4. Update floor_map_published_versions elements_data JSONB if containing "Moderate"
UPDATE public.floor_map_published_versions
SET elements_data = regexp_replace(elements_data::text, '"Moderate"', '"Moderate Noise"', 'g')::jsonb
WHERE elements_data::text LIKE '%"Moderate"%';
