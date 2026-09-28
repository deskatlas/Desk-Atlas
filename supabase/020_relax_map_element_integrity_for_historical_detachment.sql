-- Migration 020: Relax map element integrity trigger, check constraint, and fix publish_map_version aggregate FOR UPDATE
ALTER TABLE public.map_elements
  DROP CONSTRAINT IF EXISTS map_elements_workspace_role_consistency;

ALTER TABLE public.map_elements
  ADD CONSTRAINT map_elements_workspace_role_consistency CHECK (
    element_role = 'WORKSPACE'
    OR
    (element_role <> 'WORKSPACE' AND workspace_instance_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.validate_map_element_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status public.map_version_status;
  v_floor_id uuid;
  v_canvas_width integer;
  v_canvas_height integer;
  v_workspace_floor uuid;
  v_version_id uuid;
BEGIN
  v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.map_version_id ELSE NEW.map_version_id END;

  SELECT status, floor_id, canvas_width, canvas_height
    INTO v_status, v_floor_id, v_canvas_width, v_canvas_height
  FROM public.map_versions
  WHERE id = v_version_id;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Map version % does not exist', v_version_id;
  END IF;

  -- Historical Non-Draft Handling:
  -- Only DRAFT versions permit element geometry, positioning, or role mutations.
  -- For PUBLISHED or ARCHIVED versions, permit exclusively the detachment of workspace_instance_id
  -- (setting workspace_instance_id to NULL) to allow clean foreign key reconciliation upon publishing new versions.
  IF v_status <> 'DRAFT' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.workspace_instance_id IS NULL
       AND OLD.workspace_instance_id IS NOT NULL
       AND NEW.map_version_id = OLD.map_version_id
       AND NEW.x = OLD.x
       AND NEW.y = OLD.y
       AND NEW.width = OLD.width
       AND NEW.height = OLD.height
       AND NEW.rotation = OLD.rotation
       AND NEW.z_index = OLD.z_index
       AND NEW.element_role = OLD.element_role
       AND NEW.element_type = OLD.element_type
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Map elements may only be mutated inside a DRAFT map version';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.x + NEW.width > v_canvas_width OR NEW.y + NEW.height > v_canvas_height THEN
      RAISE EXCEPTION 'Map element must remain inside canvas bounds';
    END IF;

    IF NEW.element_role = 'WORKSPACE' AND NEW.workspace_instance_id IS NOT NULL THEN
      SELECT floor_id
        INTO v_workspace_floor
      FROM public.workspace_instances
      WHERE id = NEW.workspace_instance_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace instance % does not exist', NEW.workspace_instance_id;
      END IF;

      IF v_workspace_floor <> v_floor_id THEN
        RAISE EXCEPTION 'Workspace instance floor must match map-version floor';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

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
  v_colliding_ids uuid[];
BEGIN
  -- Authenticate and validate draft as active ADMIN
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

  -- Bounding box canvas check
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

  -- Overlap Collision Check 1: Workspaces overlapping Workspaces
  SELECT array_agg(DISTINCT a.id)
  INTO v_colliding_ids
  FROM public.map_elements a
  JOIN public.map_elements b
    ON a.map_version_id = b.map_version_id
   AND a.id <> b.id
  WHERE a.map_version_id = v_draft.id
    AND a.element_role = 'WORKSPACE'
    AND b.element_role = 'WORKSPACE'
    AND box(point(a.x, a.y), point(a.x + a.width, a.y + a.height)) &&
        box(point(b.x, b.y), point(b.x + b.width, b.y + b.height))
    AND a.x < b.x + b.width
    AND a.x + a.width > b.x
    AND a.y < b.y + b.height
    AND a.y + a.height > b.y;

  IF v_colliding_ids IS NOT NULL AND array_length(v_colliding_ids, 1) > 0 THEN
    RAISE EXCEPTION 'COLLISION_OVERLAP:Draft contains overlapping bookable workspaces: %', array_to_string(v_colliding_ids, ',');
  END IF;

  -- Overlap Collision Check 2: Workspaces conflicting with Walls/Dividers
  SELECT array_agg(DISTINCT workspace_element.id)
  INTO v_colliding_ids
  FROM public.map_elements workspace_element
  JOIN public.map_elements wall_element
    ON workspace_element.map_version_id = wall_element.map_version_id
  WHERE workspace_element.map_version_id = v_draft.id
    AND workspace_element.element_role = 'WORKSPACE'
    AND wall_element.element_role = 'STRUCTURE'
    AND wall_element.element_type IN ('wall', 'divider', 'thin_wall', 'thin-wall', 'glass')
    AND box(point(workspace_element.x, workspace_element.y), point(workspace_element.x + workspace_element.width, workspace_element.y + workspace_element.height)) &&
        box(point(wall_element.x, wall_element.y), point(wall_element.x + wall_element.width, wall_element.y + wall_element.height))
    AND workspace_element.x < wall_element.x + wall_element.width
    AND workspace_element.x + workspace_element.width > wall_element.x
    AND workspace_element.y < wall_element.y + wall_element.height
    AND workspace_element.y + workspace_element.height > wall_element.y;

  IF v_colliding_ids IS NOT NULL AND array_length(v_colliding_ids, 1) > 0 THEN
    RAISE EXCEPTION 'COLLISION_WALL:Draft contains a workspace conflicting with a wall/divider: %', array_to_string(v_colliding_ids, ',');
  END IF;

  -- Detach unmapped instances from older historical map_elements to guarantee FK integrity
  UPDATE public.map_elements
  SET workspace_instance_id = NULL
  WHERE workspace_instance_id IN (
    SELECT id
    FROM public.workspace_instances
    WHERE floor_id = v_draft.floor_id
      AND id NOT IN (
        SELECT workspace_instance_id
        FROM public.map_elements
        WHERE map_version_id = v_draft.id
          AND workspace_instance_id IS NOT NULL
      )
  )
  AND map_version_id <> v_draft.id;

  -- Deactivate unmapped instances that have active/historical reservations
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

  -- Safely delete unmapped instances that have zero reservations
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

  -- Archive prior published versions (Phase 3: using CTE to prevent FOR UPDATE on aggregate error)
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

  -- Compile pre-materialized PublishedFloorMap document
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
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_map_version(uuid, uuid) TO service_role;
