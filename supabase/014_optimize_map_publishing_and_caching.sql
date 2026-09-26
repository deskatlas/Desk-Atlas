-- ============================================================================
-- DeskAtlas - 014_optimize_map_publishing_and_caching.sql
-- Milestone 06: Floor Map Database Performance and Caching Optimization (MS-06)
-- Traceability: PRD-F1, PRD-F3, SDD-C1, ERD-E7, ERD-E8, QAD-TC6.5, QAD-TC6.6, QAD-TC6.7
-- ============================================================================

BEGIN;

-- 1. Add compiled_map_cache JSONB column to map_versions
ALTER TABLE public.map_versions
  ADD COLUMN IF NOT EXISTS compiled_map_cache jsonb;

-- 2. Spatial GiST index on element 2D bounding boxes for logarithmic collision checks
CREATE INDEX IF NOT EXISTS idx_map_elements_geometry_box
  ON public.map_elements
  USING gist (box(point(x, y), point(x + width, y + height)));

-- 3. Composite covering index for element z-order and version lookups
CREATE INDEX IF NOT EXISTS idx_map_elements_version_zorder
  ON public.map_elements(map_version_id, z_index ASC, id ASC);

-- 4. Optimized publish_map_version stored procedure
CREATE OR REPLACE FUNCTION public.publish_map_version(
  p_draft_version_id uuid,
  p_published_by_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.map_versions%ROWTYPE;
  v_floor public.floors%ROWTYPE;
  v_actor_role public.staff_role;
  v_actor_active boolean;
  v_previous_published_ids uuid[];
  v_compiled_map jsonb;
  v_result jsonb;
BEGIN
  IF p_published_by_user_id IS NULL THEN
    RAISE EXCEPTION 'published_by_user_id is required when publishing a map';
  END IF;

  SELECT role, is_active
    INTO v_actor_role, v_actor_active
  FROM public.staff_profiles
  WHERE user_id = p_published_by_user_id
  FOR UPDATE;

  IF v_actor_role IS DISTINCT FROM 'ADMIN' OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only an active ADMIN may publish a map version';
  END IF;

  SELECT *
    INTO v_draft
  FROM public.map_versions
  WHERE id = p_draft_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map draft version % does not exist', p_draft_version_id;
  END IF;

  IF v_draft.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a DRAFT map version can be published';
  END IF;

  SELECT *
    INTO v_floor
  FROM public.floors
  WHERE id = v_draft.floor_id
  FOR UPDATE;

  IF NOT FOUND OR v_floor.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Draft map version must belong to an active floor';
  END IF;

  PERFORM 1
  FROM public.map_elements e
  WHERE e.map_version_id = v_draft.id
    AND (
      e.x < 0
      OR e.y < 0
      OR e.width <= 0
      OR e.height <= 0
      OR e.x + e.width > v_draft.canvas_width
      OR e.y + e.height > v_draft.canvas_height
      OR e.rotation NOT IN (0, 90, 180, 270)
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains invalid map geometry';
  END IF;

  PERFORM 1
  FROM public.map_elements e
  LEFT JOIN public.workspace_instances wi
    ON wi.id = e.workspace_instance_id
  WHERE e.map_version_id = v_draft.id
    AND e.element_role = 'WORKSPACE'
    AND (
      e.workspace_instance_id IS NULL
      OR wi.id IS NULL
      OR wi.floor_id <> v_draft.floor_id
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains an invalid bookable workspace placement';
  END IF;

  PERFORM e.workspace_instance_id
  FROM public.map_elements e
  WHERE e.map_version_id = v_draft.id
    AND e.workspace_instance_id IS NOT NULL
  GROUP BY e.workspace_instance_id
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains duplicate workspace-instance placements';
  END IF;

  -- GiST Spatial collision detection for overlapping workspaces (O(log N))
  PERFORM 1
  FROM public.map_elements a
  JOIN public.map_elements b
    ON a.map_version_id = b.map_version_id
   AND a.id < b.id
  WHERE a.map_version_id = v_draft.id
    AND a.element_role = 'WORKSPACE'
    AND b.element_role = 'WORKSPACE'
    AND box(point(a.x, a.y), point(a.x + a.width, a.y + a.height)) &&
        box(point(b.x, b.y), point(b.x + b.width, b.y + b.height))
    AND a.x < b.x + b.width
    AND a.x + a.width > b.x
    AND a.y < b.y + b.height
    AND a.y + a.height > b.y
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains overlapping bookable workspaces';
  END IF;

  -- GiST Spatial collision detection for workspaces conflicting with walls/dividers
  PERFORM 1
  FROM public.map_elements workspace_element
  JOIN public.map_elements wall_element
    ON workspace_element.map_version_id = wall_element.map_version_id
   AND workspace_element.id <> wall_element.id
  WHERE workspace_element.map_version_id = v_draft.id
    AND workspace_element.element_role = 'WORKSPACE'
    AND wall_element.element_role = 'STRUCTURE'
    AND wall_element.element_type IN ('wall', 'divider')
    AND box(point(workspace_element.x, workspace_element.y), point(workspace_element.x + workspace_element.width, workspace_element.y + workspace_element.height)) &&
        box(point(wall_element.x, wall_element.y), point(wall_element.x + wall_element.width, wall_element.y + wall_element.height))
    AND workspace_element.x < wall_element.x + wall_element.width
    AND workspace_element.x + workspace_element.width > wall_element.x
    AND workspace_element.y < wall_element.y + wall_element.height
    AND workspace_element.y + workspace_element.height > wall_element.y
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains a workspace conflicting with a wall/divider';
  END IF;

  -- In-database atomic reconciliation of unmapped instances on the floor (Phase 1)
  -- 1. Deactivate unmapped instances that have active/historical reservations
  UPDATE public.workspace_instances
  SET
    operational_status = 'INACTIVE',
    updated_at = now()
  WHERE floor_id = v_draft.floor_id
    AND id NOT IN (
      SELECT workspace_instance_id
      FROM public.map_elements
      WHERE map_version_id = v_draft.id
        AND workspace_instance_id IS NOT NULL
    )
    AND id IN (
      SELECT DISTINCT workspace_instance_id
      FROM public.reservation_candidates
    )
    AND operational_status <> 'INACTIVE';

  -- 2. Delete unmapped instances that have zero reservations
  DELETE FROM public.workspace_instances
  WHERE floor_id = v_draft.floor_id
    AND id NOT IN (
      SELECT workspace_instance_id
      FROM public.map_elements
      WHERE map_version_id = v_draft.id
        AND workspace_instance_id IS NOT NULL
    )
    AND id NOT IN (
      SELECT DISTINCT workspace_instance_id
      FROM public.reservation_candidates
    );

  WITH locked_published AS (
    SELECT id
    FROM public.map_versions
    WHERE floor_id = v_draft.floor_id
      AND status = 'PUBLISHED'
    FOR UPDATE
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_previous_published_ids
  FROM locked_published;

  UPDATE public.map_versions
  SET status = 'ARCHIVED'
  WHERE id = ANY(v_previous_published_ids);

  -- Compile pre-materialized PublishedFloorMap document (Phase 2)
  SELECT jsonb_build_object(
    'floor', jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'floorNumber', f.floor_number,
      'displayOrder', f.display_order,
      'isActive', f.is_active
    ),
    'version', jsonb_build_object(
      'id', v_draft.id,
      'versionNumber', v_draft.version_number,
      'canvasWidth', v_draft.canvas_width,
      'canvasHeight', v_draft.canvas_height,
      'gridSize', v_draft.grid_size,
      'publishedAt', now()
    ),
    'elements', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'elementRole', CASE WHEN e.element_role = 'EDITOR_AID' THEN 'INFORMATION' ELSE e.element_role::text END,
            'elementType', e.element_type,
            'x', e.x,
            'y', e.y,
            'width', e.width,
            'height', e.height,
            'rotation', e.rotation,
            'zIndex', e.z_index,
            'label', e.label,
            'style', COALESCE(e.properties, '{}'::jsonb),
            'workspace', CASE
              WHEN e.workspace_instance_id IS NOT NULL AND wi.id IS NOT NULL AND wt.id IS NOT NULL THEN
                jsonb_build_object(
                  'workspaceInstanceId', wi.id,
                  'templateId', wt.id,
                  'floorId', wi.floor_id,
                  'instanceCode', wi.instance_code,
                  'displayName', wi.display_name,
                  'templateName', wt.name,
                  'description', wt.description,
                  'photoPath', wt.photo_path,
                  'photoPosition', wt.default_style->'photoPosition',
                  'capacity', wt.capacity,
                  'rateAmount', wt.rate_amount,
                  'pricingUnit', wt.pricing_unit,
                  'operationalStatus', wi.operational_status,
                  'maintenanceNote', wi.maintenance_note,
                  'isBookable', (wi.operational_status = 'ACTIVE' AND wt.is_active = true),
                  'blockingReason', CASE
                    WHEN wt.is_active = false THEN 'TEMPLATE_INACTIVE'
                    WHEN wi.operational_status <> 'ACTIVE' THEN 'OPERATIONAL_STATUS_BLOCKED'
                    ELSE NULL
                  END,
                  'tags', COALESCE(
                    e.properties->'recommendationTags',
                    e.properties->'recommendations',
                    e.properties->'tags',
                    wt.default_style->'recommendationTags',
                    wt.default_style->'recommendations',
                    wt.default_style->'tags'
                  )
                )
              ELSE NULL
            END
          )
          ORDER BY e.z_index ASC, e.id ASC
        )
        FROM public.map_elements e
        LEFT JOIN public.workspace_instances wi ON wi.id = e.workspace_instance_id
        LEFT JOIN public.workspace_templates wt ON wt.id = wi.template_id
        WHERE e.map_version_id = v_draft.id
          AND e.element_role <> 'EDITOR_AID'
          AND (e.element_role <> 'WORKSPACE' OR (wt.id IS NOT NULL AND wt.is_active = true))
      ),
      '[]'::jsonb
    )
  )
  INTO v_compiled_map
  FROM public.floors f
  WHERE f.id = v_draft.floor_id;

  UPDATE public.map_versions
  SET
    status = 'PUBLISHED',
    published_by_user_id = p_published_by_user_id,
    published_at = now(),
    compiled_map_cache = v_compiled_map
  WHERE id = v_draft.id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_published_by_user_id,
    'ADMIN',
    'map_published',
    'map_version',
    v_draft.id,
    jsonb_build_object(
      'floor_id', v_draft.floor_id,
      'archived_version_ids', v_previous_published_ids,
      'element_count', (
        SELECT count(*)
        FROM public.map_elements
        WHERE map_version_id = v_draft.id
      ),
      'workspace_instance_count', (
        SELECT count(*)
        FROM public.map_elements
        WHERE map_version_id = v_draft.id
          AND workspace_instance_id IS NOT NULL
      )
    )
  );

  SELECT jsonb_build_object(
    'floor', (
      SELECT to_jsonb(f)
      FROM public.floors f
      WHERE f.id = v_draft.floor_id
    ),
    'version', (
      SELECT to_jsonb(v)
      FROM public.map_versions v
      WHERE v.id = v_draft.id
    ),
    'elements', (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.z_index, e.id), '[]'::jsonb)
      FROM public.map_elements e
      WHERE e.map_version_id = v_draft.id
    )
  )
    INTO v_result
  ;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_map_version(uuid, uuid) TO service_role;

-- 5. Backfill compiled_map_cache for any existing published versions
DO $$
DECLARE
  v_pub RECORD;
  v_cache jsonb;
BEGIN
  FOR v_pub IN SELECT * FROM public.map_versions WHERE status = 'PUBLISHED' AND compiled_map_cache IS NULL LOOP
    SELECT jsonb_build_object(
      'floor', jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'floorNumber', f.floor_number,
        'displayOrder', f.display_order,
        'isActive', f.is_active
      ),
      'version', jsonb_build_object(
        'id', v_pub.id,
        'versionNumber', v_pub.version_number,
        'canvasWidth', v_pub.canvas_width,
        'canvasHeight', v_pub.canvas_height,
        'gridSize', v_pub.grid_size,
        'publishedAt', v_pub.published_at
      ),
      'elements', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', e.id,
              'elementRole', CASE WHEN e.element_role = 'EDITOR_AID' THEN 'INFORMATION' ELSE e.element_role::text END,
              'elementType', e.element_type,
              'x', e.x,
              'y', e.y,
              'width', e.width,
              'height', e.height,
              'rotation', e.rotation,
              'zIndex', e.z_index,
              'label', e.label,
              'style', COALESCE(e.properties, '{}'::jsonb),
              'workspace', CASE
                WHEN e.workspace_instance_id IS NOT NULL AND wi.id IS NOT NULL AND wt.id IS NOT NULL THEN
                  jsonb_build_object(
                    'workspaceInstanceId', wi.id,
                    'templateId', wt.id,
                    'floorId', wi.floor_id,
                    'instanceCode', wi.instance_code,
                    'displayName', wi.display_name,
                    'templateName', wt.name,
                    'description', wt.description,
                    'photoPath', wt.photo_path,
                    'photoPosition', wt.default_style->'photoPosition',
                    'capacity', wt.capacity,
                    'rateAmount', wt.rate_amount,
                    'pricingUnit', wt.pricing_unit,
                    'operationalStatus', wi.operational_status,
                    'maintenanceNote', wi.maintenance_note,
                    'isBookable', (wi.operational_status = 'ACTIVE' AND wt.is_active = true),
                    'blockingReason', CASE
                      WHEN wt.is_active = false THEN 'TEMPLATE_INACTIVE'
                      WHEN wi.operational_status <> 'ACTIVE' THEN 'OPERATIONAL_STATUS_BLOCKED'
                      ELSE NULL
                    END,
                    'tags', COALESCE(
                      e.properties->'recommendationTags',
                      e.properties->'recommendations',
                      e.properties->'tags',
                      wt.default_style->'recommendationTags',
                      wt.default_style->'recommendations',
                      wt.default_style->'tags'
                    )
                  )
                ELSE NULL
              END
            )
            ORDER BY e.z_index ASC, e.id ASC
          )
          FROM public.map_elements e
          LEFT JOIN public.workspace_instances wi ON wi.id = e.workspace_instance_id
          LEFT JOIN public.workspace_templates wt ON wt.id = wi.template_id
          WHERE e.map_version_id = v_pub.id
            AND e.element_role <> 'EDITOR_AID'
            AND (e.element_role <> 'WORKSPACE' OR (wt.id IS NOT NULL AND wt.is_active = true))
        ),
        '[]'::jsonb
      )
    )
    INTO v_cache
    FROM public.floors f
    WHERE f.id = v_pub.floor_id;

    UPDATE public.map_versions
    SET compiled_map_cache = v_cache
    WHERE id = v_pub.id;
  END LOOP;
END;
$$;

COMMIT;
