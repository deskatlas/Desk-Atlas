-- PRD-F6/F9, SDD-C5/C12, ERD-E10/E11/E13, QAD-TC35/48.
-- Counts are live and read-only. No queue hydration or inventory caching.
BEGIN;
CREATE FUNCTION public.admin_badge_counts(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reservations_count bigint; kiosk_count bigint; active_count bigint; overdue_count bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND role='ADMIN' AND is_active) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 SELECT count(*),count(*) FILTER(WHERE r.status='PENDING_COUNTER_CONFIRMATION')
 INTO reservations_count,kiosk_count
 FROM reservations r
 LEFT JOIN LATERAL (
  SELECT p.status,p.expires_at FROM payment_attempts p WHERE p.reservation_id=r.id
  ORDER BY p.created_at DESC,p.id LIMIT 1
 ) p ON true
 LEFT JOIN LATERAL (
  SELECT c.end_at FROM reservation_candidates c WHERE c.reservation_id=r.id
  ORDER BY c.is_assigned DESC,c.rank LIMIT 1
 ) c ON true
 WHERE r.status IN ('PENDING_PAYMENT','PAYMENT_UNDER_REVIEW','PENDING_COUNTER_CONFIRMATION')
  AND p.status IS DISTINCT FROM 'REJECTED' AND r.checked_out_at IS NULL
  AND (c.end_at IS NULL OR c.end_at>now())
  AND (r.status<>'PENDING_PAYMENT' OR coalesce(p.expires_at,r.created_at+interval '1 hour')>now());

 SELECT count(*) FILTER(WHERE c.start_at IS NULL OR c.start_at>now()),
        count(*) FILTER(WHERE c.start_at<=now()) INTO active_count,overdue_count
 FROM payment_attempts p JOIN reservations r ON r.id=p.reservation_id
 LEFT JOIN LATERAL (
  SELECT rc.start_at FROM reservation_candidates rc WHERE rc.reservation_id=r.id
  ORDER BY rc.is_assigned DESC,(rc.rank=0) DESC,rc.start_at,rc.rank LIMIT 1
 ) c ON true
 WHERE p.channel='WEB' AND p.status='UNDER_REVIEW' AND p.refund_status IS DISTINCT FROM 'REFUNDED';
 RETURN jsonb_build_object(
  'reservationsCount',reservations_count,'kioskCount',kiosk_count,'paymentsCount',active_count+overdue_count,
  'awaitingProof',reservations_count,'counterQueue',kiosk_count,'paymentReviews',active_count+overdue_count,
  'awaitingReviewCount',active_count,'overdueCount',overdue_count);
END $$;
REVOKE ALL ON FUNCTION public.admin_badge_counts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_badge_counts(uuid) TO service_role;
COMMIT;
