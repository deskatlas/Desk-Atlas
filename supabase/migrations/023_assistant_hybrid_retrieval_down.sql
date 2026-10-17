-- MS55-TC09: retain canonical content, hashes, publications and vector RPC.
BEGIN;
DROP FUNCTION IF EXISTS public.assistant_search_hybrid(uuid,text,text,jsonb,text[],double precision);
DROP FUNCTION IF EXISTS public.assistant_lexical_query(text,regconfig);
DROP INDEX IF EXISTS public.kb_chunks_lexical_simple;
DROP INDEX IF EXISTS public.kb_chunks_lexical_english;
ALTER TABLE public.kb_chunks DROP COLUMN IF EXISTS lexical_simple,DROP COLUMN IF EXISTS lexical_english;
COMMIT;
