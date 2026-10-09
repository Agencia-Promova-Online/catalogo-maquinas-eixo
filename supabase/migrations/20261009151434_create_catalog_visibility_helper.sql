/*
# Add catalog visibility helper (idempotente - redefinido em 151518)
*/
CREATE OR REPLACE FUNCTION public.is_active_for_catalog(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_status IN ('available','negotiating','disponivel','em negociacao','em negociação') $$;
REVOKE ALL ON FUNCTION public.is_active_for_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_for_catalog(text) TO authenticated;
