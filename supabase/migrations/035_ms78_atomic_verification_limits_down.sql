BEGIN;
DROP FUNCTION IF EXISTS public.consume_customer_access_limits(jsonb);
DELETE FROM public.rate_limit_events WHERE scope='ASSISTANT_TOKEN';
ALTER TABLE public.rate_limit_events DROP CONSTRAINT rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
 'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER',
 'PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR'));
COMMIT;
