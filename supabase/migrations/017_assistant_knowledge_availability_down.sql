-- MS-45: disable assistant access before rollback.
BEGIN;
DROP FUNCTION IF EXISTS public.assistant_knowledge_availability(uuid,text,text);
COMMIT;
