-- Migration Down: 051_allow_rotated_element_canvas_coordinates_down.sql
-- Description: Revert rotated map element bounds and restore non-negative constraints
-- Traceability: MS-101

BEGIN;

ALTER TABLE public.map_elements ADD CONSTRAINT map_elements_x_nonnegative CHECK (x >= 0);
ALTER TABLE public.map_elements ADD CONSTRAINT map_elements_y_nonnegative CHECK (y >= 0);

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

COMMIT;

