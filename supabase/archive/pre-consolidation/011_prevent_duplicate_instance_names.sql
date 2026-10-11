-- MF-175: Prevent Duplicate Workspace Instance Names & Deduplicate Existing
-- 1. Deduplicate existing duplicate instance names per template
WITH numbered_instances AS (
  SELECT
    id,
    template_id,
    display_name,
    ROW_NUMBER() OVER (
      PARTITION BY template_id, lower(btrim(display_name))
      ORDER BY created_at ASC, id ASC
    ) AS dup_rank
  FROM public.workspace_instances
),
template_max_numbers AS (
  SELECT
    template_id,
    COALESCE(
      MAX(
        CASE
          WHEN display_name ~ '[0-9]+$' THEN (regexp_match(display_name, '([0-9]+)$'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) AS max_seq
  FROM public.workspace_instances
  GROUP BY template_id
)
UPDATE public.workspace_instances wi
SET
  display_name = regexp_replace(wi.display_name, '\s+[0-9]+$', '') || ' ' || (tmn.max_seq + ni.dup_rank - 1),
  updated_at = now()
FROM numbered_instances ni
JOIN template_max_numbers tmn ON ni.template_id = tmn.template_id
WHERE wi.id = ni.id AND ni.dup_rank > 1;

-- 2. Add unique constraint on (template_id, display_name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN ('uq_workspace_instance_template_display_name', 'workspace_instances_template_display_name_unique')
  ) THEN
    ALTER TABLE public.workspace_instances
      ADD CONSTRAINT uq_workspace_instance_template_display_name
      UNIQUE (template_id, display_name);
  END IF;
END $$;

