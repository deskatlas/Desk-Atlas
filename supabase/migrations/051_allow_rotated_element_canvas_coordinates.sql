-- Migration: 051_allow_rotated_element_canvas_coordinates.sql
-- Description: Allow rotated map elements to position flush against canvas boundaries by evaluating rotated AABB bounds
-- Traceability: MS-101, PRD-F1, PRD-F2, PRD-F14, SDD-C5, SDD-C11, ERD-E7, ERD-E8, QAD-TC14, QAD-TC31

BEGIN;

-- 1. Relax check constraints on map_elements table
ALTER TABLE public.map_elements DROP CONSTRAINT IF EXISTS map_elements_x_nonnegative;
ALTER TABLE public.map_elements DROP CONSTRAINT IF EXISTS map_elements_y_nonnegative;

-- 2. Update trigger function validate_map_element_integrity to check rotated bounds
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
  v_aabb_w numeric;
  v_aabb_h numeric;
  v_cx numeric;
  v_cy numeric;
  v_min_x numeric;
  v_max_x numeric;
  v_min_y numeric;
  v_max_y numeric;
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
    IF NEW.rotation IN (90, 270) THEN
      v_aabb_w := NEW.height;
      v_aabb_h := NEW.width;
    ELSE
      v_aabb_w := NEW.width;
      v_aabb_h := NEW.height;
    END IF;

    v_cx := NEW.x + NEW.width / 2.0;
    v_cy := NEW.y + NEW.height / 2.0;
    v_min_x := v_cx - v_aabb_w / 2.0;
    v_max_x := v_cx + v_aabb_w / 2.0;
    v_min_y := v_cy - v_aabb_h / 2.0;
    v_max_y := v_cy + v_aabb_h / 2.0;

    IF v_min_x < -0.01 OR v_max_x > v_canvas_width + 0.01 OR v_min_y < -0.01 OR v_max_y > v_canvas_height + 0.01 THEN
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

COMMIT;

