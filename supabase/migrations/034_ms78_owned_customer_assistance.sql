-- MS78-R01/R02/R03, SDD-C15/C20, ERD-E10/E22. No mutations or private free-text projection.
BEGIN;
CREATE OR REPLACE FUNCTION public.customer_assistance_owned_bookings(
  p_customer_id uuid, p_reservation_id uuid DEFAULT NULL, p_history boolean DEFAULT false,
  p_cursor_start timestamptz DEFAULT NULL, p_cursor_id uuid DEFAULT NULL
) RETURNS TABLE(snapshot jsonb, sort_start timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'reference', r.reference_code, 'status', r.status, 'channel', r.source,
    'start_at', candidate.start_at, 'end_at', candidate.end_at,
    'workspace', workspace.display_name, 'assigned', coalesce(candidate.is_assigned, false),
    'checked_in_at', r.checked_in_at, 'checked_out_at', r.checked_out_at,
    'payment_status', payment.status, 'reschedule_count', r.reschedule_count,
    'closure_pending', coalesce(r.is_closure_impacted AND r.closure_impact_status IN ('AFFECTED_PENDING_ACTION', 'MANUAL_RESOLUTION_REQUIRED'), false),
    'timezone', settings.timezone, 'reschedule_cutoff_hours', settings.customer_reschedule_cutoff_hours,
    'cancellation_cutoff_value', settings.customer_cancellation_cutoff_value,
    'cancellation_cutoff_unit', settings.customer_cancellation_cutoff_unit
  ), coalesce(candidate.start_at, r.created_at)
  FROM public.customers customer
  JOIN public.reservations r ON (r.customer_id = customer.id OR
    (r.customer_id IS NULL AND lower(btrim(r.customer_email)) = lower(btrim(customer.email))))
  LEFT JOIN public.business_settings settings ON settings.id = 1
  LEFT JOIN LATERAL (
    SELECT c.start_at, c.end_at, c.workspace_instance_id, c.is_assigned
    FROM public.reservation_candidates c WHERE c.reservation_id = r.id
    ORDER BY c.is_assigned DESC, c.rank ASC LIMIT 1
  ) candidate ON true
  LEFT JOIN public.workspace_instances workspace ON workspace.id = candidate.workspace_instance_id
  LEFT JOIN LATERAL (
    SELECT p.status FROM public.payment_attempts p WHERE p.reservation_id = r.id
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1
  ) payment ON true
  WHERE customer.id = p_customer_id
    AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    AND (p_reservation_id IS NOT NULL OR p_history OR
      (r.status IN ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'NEEDS_MANUAL_RESOLUTION') AND candidate.end_at > statement_timestamp()))
    AND (p_cursor_start IS NULL OR (coalesce(candidate.start_at, r.created_at), r.id) < (p_cursor_start, p_cursor_id))
  ORDER BY coalesce(candidate.start_at, r.created_at) DESC, r.id DESC LIMIT 11;
$$;
REVOKE ALL ON FUNCTION public.customer_assistance_owned_bookings(uuid, uuid, boolean, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_assistance_owned_bookings(uuid, uuid, boolean, timestamptz, uuid) TO service_role;
COMMIT;
