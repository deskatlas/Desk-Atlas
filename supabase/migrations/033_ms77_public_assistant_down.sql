BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.customer_assistant_controls WHERE permit_until>clock_timestamp() AND NOT cancelled AND stage<>'complete')
  OR EXISTS(SELECT 1 FROM public.rate_limit_events WHERE scope IN ('PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR') AND created_at>clock_timestamp()-interval '1 hour')
  THEN RAISE EXCEPTION 'MS77_ROLLBACK_INCOMPATIBLE: disable, drain and expire public quotas first'; END IF;
END $$;
-- Only already-expired quota metadata can be retired with the feature.
DELETE FROM public.rate_limit_events WHERE scope IN ('PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR') AND created_at<=clock_timestamp()-interval '1 hour';
DROP FUNCTION public.customer_spot_candidates(uuid[],uuid,uuid);
DROP FUNCTION public.admit_public_assistant(text,text,uuid);
DROP FUNCTION public.customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text);
ALTER FUNCTION public.customer_assistant_control_ms76(text,text,text,text,uuid,uuid,uuid,text) RENAME TO customer_assistant_control;
GRANT EXECUTE ON FUNCTION public.customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) TO service_role;
ALTER TABLE public.rate_limit_events DROP CONSTRAINT rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
 'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER'));
COMMIT;
