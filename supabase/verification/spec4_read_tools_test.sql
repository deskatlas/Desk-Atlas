-- SPEC4-TC03/09/11/14/15. Synthetic aggregates, rolled back after assertions.
BEGIN;
INSERT INTO auth.users VALUES ('123e4567-e89b-42d3-a456-426614174000'),('123e4567-e89b-42d3-a456-426614174001');
INSERT INTO public.staff_profiles(user_id,role,display_name) VALUES ('123e4567-e89b-42d3-a456-426614174000','ADMIN','Synthetic admin'),('123e4567-e89b-42d3-a456-426614174001','STAFF','Synthetic staff');
INSERT INTO public.business_settings(business_name,booking_interval_minutes,timezone) VALUES ('Synthetic',30,'Asia/Manila');
INSERT INTO public.floors(id,name,floor_number,display_order) VALUES ('123e4567-e89b-42d3-a456-426614174002','Synthetic floor',1,1);
INSERT INTO public.workspace_templates(id,name,rate_amount,pricing_unit,capacity,default_shape,default_color) VALUES ('123e4567-e89b-42d3-a456-426614174003','Synthetic desk',100,'HOURLY',1,'RECTANGLE','#ffffff');
INSERT INTO public.workspace_instances(id,template_id,floor_id,instance_code,display_name) VALUES ('123e4567-e89b-42d3-a456-426614174004','123e4567-e89b-42d3-a456-426614174003','123e4567-e89b-42d3-a456-426614174002','SYN-1','Synthetic desk');
INSERT INTO public.operating_hours(day_of_week,opens_at,closes_at) VALUES (3,'07:00','23:30');
INSERT INTO public.reservations(id,reference_code,source,customer_first_name,customer_last_name,customer_email,status,rate_snapshot,amount_due,created_at)
SELECT ('00000000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,'SYN-'||n,'WEB','Synthetic','Fixture','synthetic@example.invalid','PENDING_PAYMENT',100,100,'2026-09-01T00:00:00Z' FROM generate_series(1,1205) n;
INSERT INTO public.reservation_candidates(reservation_id,rank,workspace_instance_id,start_at,end_at)
SELECT id,0,'123e4567-e89b-42d3-a456-426614174004','2026-10-14T01:00:00Z','2026-10-14T02:00:00Z' FROM public.reservations;
INSERT INTO public.payment_attempts(reservation_id,attempt_number,channel,amount,status,processed_by_user_id,processed_at)
SELECT id,1,'KIOSK',0.10,'APPROVED','123e4567-e89b-42d3-a456-426614174000','2026-10-14T02:00:00Z' FROM public.reservations;
DO $$
DECLARE answer jsonb;
BEGIN
  answer:=public.assistant_read_tool('123e4567-e89b-42d3-a456-426614174000','booking_report','{"basis":"scheduled","grouping":"day"}','2026-10-13T16:00Z','2026-10-14T16:00Z','2026-10-14T04:30Z');
  IF answer->'tables'->0->'rows'->0->>3 <> '1205' THEN RAISE EXCEPTION 'Complete scheduled count failed: %',answer; END IF;
  answer:=public.assistant_read_tool('123e4567-e89b-42d3-a456-426614174000','booking_report','{"basis":"created","grouping":"day"}','2026-10-13T16:00Z','2026-10-14T16:00Z','2026-10-14T04:30Z');
  IF jsonb_array_length(answer->'tables'->0->'rows') <> 0 THEN RAISE EXCEPTION 'Creation basis failed'; END IF;
  answer:=public.assistant_read_tool('123e4567-e89b-42d3-a456-426614174000','payment_report','{"grouping":"day"}','2026-10-13T16:00Z','2026-10-14T16:00Z','2026-10-14T04:30Z');
  IF answer->'tables'->0->'rows'->0->>2 <> '120.50' THEN RAISE EXCEPTION 'Exact money aggregate failed: %',answer; END IF;
  answer:=public.assistant_read_tool('123e4567-e89b-42d3-a456-426614174001','workspace_availability','{"start_at":"2026-10-14T01:00:00Z","end_at":"2026-10-14T02:00:00Z"}','2026-10-13T16:00Z','2026-10-14T16:00Z','2026-10-14T04:30Z');
  IF answer->'tables'->0->'rows'->0->>2 <> 'AVAILABLE' THEN RAISE EXCEPTION 'No-hold availability failed: %',answer; END IF;
  BEGIN
    PERFORM public.assistant_read_tool('123e4567-e89b-42d3-a456-426614174001','payment_report','{}','2026-10-13T16:00Z','2026-10-14T16:00Z','2026-10-14T04:30Z');
    RAISE EXCEPTION 'Staff financial access was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
  END;
  IF has_function_privilege('anon','public.assistant_read_tool(uuid,text,jsonb,timestamptz,timestamptz,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous RPC access'; END IF;
END $$;
ROLLBACK;
