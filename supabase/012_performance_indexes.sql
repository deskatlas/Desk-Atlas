-- ===========================================================================
-- DeskAtlas Performance Indexes Migration
-- File: supabase/012_performance_indexes.sql
-- Purpose: Add high-impact composite & foreign-key B-Tree indexes for fast
--          availability checks, map rendering, and reservation queries.
-- ===========================================================================

-- 1. Reservation Candidates & Availability Lookups
CREATE INDEX IF NOT EXISTS idx_reservation_candidates_availability 
  ON public.reservation_candidates (workspace_instance_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_reservation_candidates_assigned_window 
  ON public.reservation_candidates (start_at, end_at, is_assigned);

CREATE INDEX IF NOT EXISTS idx_reservation_candidates_reservation_id 
  ON public.reservation_candidates (reservation_id);

-- 2. Reservations Lookups & Lifecycle Filtering
CREATE INDEX IF NOT EXISTS idx_reservations_status_created 
  ON public.reservations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_reference_code 
  ON public.reservations (reference_code);

-- 3. Schedule Blocks & Maintenance/Closure Windows
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_instance_window 
  ON public.schedule_blocks (workspace_instance_id, start_at, end_at, scope);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_business_window 
  ON public.schedule_blocks (start_at, end_at, scope);

-- 4. Published Map Versions & Floor Navigation
CREATE INDEX IF NOT EXISTS idx_map_versions_floor_status 
  ON public.map_versions (floor_id, status);

CREATE INDEX IF NOT EXISTS idx_map_elements_version_zindex 
  ON public.map_elements (map_version_id, z_index);

CREATE INDEX IF NOT EXISTS idx_map_elements_instance 
  ON public.map_elements (workspace_instance_id);

-- 5. Workspace Instances & Templates
CREATE INDEX IF NOT EXISTS idx_workspace_instances_template_status 
  ON public.workspace_instances (template_id, operational_status);

CREATE INDEX IF NOT EXISTS idx_workspace_instances_floor 
  ON public.workspace_instances (floor_id);

CREATE INDEX IF NOT EXISTS idx_workspace_templates_active 
  ON public.workspace_templates (is_active);

-- 6. Operating Hours & Floors Sorting
CREATE INDEX IF NOT EXISTS idx_operating_hours_day_active 
  ON public.operating_hours (day_of_week, is_active, opens_at);

CREATE INDEX IF NOT EXISTS idx_floors_active_display 
  ON public.floors (is_active, display_order, name);
