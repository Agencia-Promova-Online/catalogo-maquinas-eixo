/*
# Eixo-Catálogo access policies (COMPATIBILIZADO)

1. Functions:
   - `is_admin()` funciona com AMBAS estruturas: coluna inline `profiles.role` OU tabela `user_roles`
   - `is_active_for_catalog()` helper de visibilidade
   - `next_proposal_number()` gerador de numeração por marca
2. Policies: compatíveis com RLS já habilitado
3. Storage: bucket machine-photos
*/

-- Helper unificado de admin (funciona com profiles.role OU user_roles antiga)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(is_active, active, true) = true
      AND (
        lower(COALESCE(role, '')) = 'admin'
        OR lower(COALESCE(role, '')) = 'administrador'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = 'user_roles'
  ) AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Helper unificado de usuário ativo (suporta is_active e active)
CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND COALESCE(is_active, active, true) = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_active_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;

-- Helper visibilidade catálogo
CREATE OR REPLACE FUNCTION public.is_active_for_catalog(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_status IN ('available','negotiating','disponivel','em negociacao','em negociação') $$;
REVOKE ALL ON FUNCTION public.is_active_for_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_for_catalog(text) TO authenticated;

-- Próximo número de proposta
CREATE OR REPLACE FUNCTION public.next_proposal_number(p_brand_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_active_member() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE brands SET proposal_sequence=proposal_sequence+1 WHERE id=p_brand_id RETURNING proposal_sequence INTO n;
  IF n IS NULL THEN RAISE EXCEPTION 'Brand not found'; END IF;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.next_proposal_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_proposal_number(uuid) TO authenticated;

-- Admin set profile access (reforçado)
CREATE OR REPLACE FUNCTION public.admin_set_profile_access(p_profile_id uuid, p_role text, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_role NOT IN ('admin', 'seller') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  UPDATE profiles SET role = p_role, is_active = p_is_active, active = p_is_active, updated_at = now() WHERE id = p_profile_id;
  -- Sincroniza também user_roles antiga se existir
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles') THEN
    DELETE FROM public.user_roles WHERE user_id = p_profile_id;
    INSERT INTO public.user_roles(user_id, role) VALUES (p_profile_id, (CASE WHEN p_role='seller' THEN 'vendedor' ELSE 'admin' END)::app_role)
    ON CONFLICT DO NOTHING;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_profile_access(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_access(uuid, text, boolean) TO authenticated;

-- ============================================================
-- POLICIES
-- ============================================================

-- PROFILES
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
USING(id=auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated
WITH CHECK(id=auth.uid() AND (
  COALESCE(role,'seller') IN ('seller','admin')
));

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
USING(id=auth.uid() OR public.is_admin())
WITH CHECK(id=auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete ON profiles FOR DELETE TO authenticated
USING(public.is_admin() AND id<>auth.uid());

-- Restringe UPDATE em colunas sensíveis via grant granular
REVOKE UPDATE (role, is_active, active) ON profiles FROM authenticated;
GRANT UPDATE (full_name, name, email) ON profiles TO authenticated;

-- CATEGORIES
DROP POLICY IF EXISTS categories_select ON categories;
CREATE POLICY categories_select ON categories FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS categories_insert ON categories;
CREATE POLICY categories_insert ON categories FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS categories_update ON categories;
CREATE POLICY categories_update ON categories FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS categories_delete ON categories;
CREATE POLICY categories_delete ON categories FOR DELETE TO authenticated USING(public.is_admin());

-- MACHINES
DROP POLICY IF EXISTS machines_select ON machines;
CREATE POLICY machines_select ON machines FOR SELECT TO authenticated
USING(public.is_admin() OR public.is_active_for_catalog(status));
DROP POLICY IF EXISTS machines_insert ON machines;
CREATE POLICY machines_insert ON machines FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS machines_update ON machines;
CREATE POLICY machines_update ON machines FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS machines_delete ON machines;
CREATE POLICY machines_delete ON machines FOR DELETE TO authenticated USING(public.is_admin());

-- MACHINE_PHOTOS (e fallback para machine_images)
DROP POLICY IF EXISTS photos_select ON machine_photos;
CREATE POLICY photos_select ON machine_photos FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS photos_insert ON machine_photos;
CREATE POLICY photos_insert ON machine_photos FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS photos_update ON machine_photos;
CREATE POLICY photos_update ON machine_photos FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS photos_delete ON machine_photos;
CREATE POLICY photos_delete ON machine_photos FOR DELETE TO authenticated USING(public.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='machine_images') THEN
    DROP POLICY IF EXISTS images_select ON public.machine_images;
    CREATE POLICY images_select ON public.machine_images FOR SELECT TO authenticated USING(true);
    DROP POLICY IF EXISTS images_insert ON public.machine_images;
    CREATE POLICY images_insert ON public.machine_images FOR INSERT TO authenticated WITH CHECK(public.is_admin());
    DROP POLICY IF EXISTS images_update ON public.machine_images;
    CREATE POLICY images_update ON public.machine_images FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
    DROP POLICY IF EXISTS images_delete ON public.machine_images;
    CREATE POLICY images_delete ON public.machine_images FOR DELETE TO authenticated USING(public.is_admin());
  END IF;
END $$;

-- COMPANY_SETTINGS (e fallback para app_settings)
DROP POLICY IF EXISTS settings_select ON company_settings;
CREATE POLICY settings_select ON company_settings FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS settings_insert ON company_settings;
CREATE POLICY settings_insert ON company_settings FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS settings_update ON company_settings;
CREATE POLICY settings_update ON company_settings FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS settings_delete ON company_settings;
CREATE POLICY settings_delete ON company_settings FOR DELETE TO authenticated USING(public.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_settings') THEN
    DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
    CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated USING(true);
    DROP POLICY IF EXISTS app_settings_all ON public.app_settings;
    CREATE POLICY app_settings_all ON public.app_settings FOR ALL TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
  END IF;
END $$;

-- AUDIT LOGS
DROP POLICY IF EXISTS audit_select ON catalog_audit_logs;
CREATE POLICY audit_select ON catalog_audit_logs FOR SELECT TO authenticated USING(public.is_admin());
DROP POLICY IF EXISTS audit_insert ON catalog_audit_logs;
CREATE POLICY audit_insert ON catalog_audit_logs FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS audit_update ON catalog_audit_logs;
CREATE POLICY audit_update ON catalog_audit_logs FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS audit_delete ON catalog_audit_logs;
CREATE POLICY audit_delete ON catalog_audit_logs FOR DELETE TO authenticated USING(public.is_admin());

-- BRANDS
DROP POLICY IF EXISTS brands_select ON brands;
CREATE POLICY brands_select ON brands FOR SELECT TO authenticated USING(is_active OR public.is_admin());
DROP POLICY IF EXISTS brands_insert ON brands;
CREATE POLICY brands_insert ON brands FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS brands_update ON brands;
CREATE POLICY brands_update ON brands FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS brands_delete ON brands;
CREATE POLICY brands_delete ON brands FOR DELETE TO authenticated USING(public.is_admin());

-- SEGMENTS
DROP POLICY IF EXISTS segments_select ON segments;
CREATE POLICY segments_select ON segments FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS segments_insert ON segments;
CREATE POLICY segments_insert ON segments FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS segments_update ON segments;
CREATE POLICY segments_update ON segments FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS segments_delete ON segments;
CREATE POLICY segments_delete ON segments FOR DELETE TO authenticated USING(public.is_admin());

-- RATE TABLES
DROP POLICY IF EXISTS rates_select ON rate_tables;
CREATE POLICY rates_select ON rate_tables FOR SELECT TO authenticated
USING(public.is_admin() OR EXISTS(SELECT 1 FROM seller_brands sb WHERE sb.seller_id=auth.uid() AND sb.brand_id=rate_tables.brand_id));
DROP POLICY IF EXISTS rates_insert ON rate_tables;
CREATE POLICY rates_insert ON rate_tables FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS rates_update ON rate_tables;
CREATE POLICY rates_update ON rate_tables FOR UPDATE TO authenticated USING(public.is_admin()) WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS rates_delete ON rate_tables;
CREATE POLICY rates_delete ON rate_tables FOR DELETE TO authenticated USING(public.is_admin());

-- SELLER_BRANDS
DROP POLICY IF EXISTS seller_brands_select ON seller_brands;
CREATE POLICY seller_brands_select ON seller_brands FOR SELECT TO authenticated USING(seller_id=auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS seller_brands_insert ON seller_brands;
CREATE POLICY seller_brands_insert ON seller_brands FOR INSERT TO authenticated WITH CHECK(public.is_admin());
DROP POLICY IF EXISTS seller_brands_delete ON seller_brands;
CREATE POLICY seller_brands_delete ON seller_brands FOR DELETE TO authenticated USING(public.is_admin());

-- PROPOSALS
DROP POLICY IF EXISTS proposals_select ON proposals;
CREATE POLICY proposals_select ON proposals FOR SELECT TO authenticated USING(seller_id=auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS proposals_insert ON proposals;
CREATE POLICY proposals_insert ON proposals FOR INSERT TO authenticated WITH CHECK(seller_id=auth.uid());
DROP POLICY IF EXISTS proposals_update ON proposals;
CREATE POLICY proposals_update ON proposals FOR UPDATE TO authenticated USING(seller_id=auth.uid() OR public.is_admin()) WITH CHECK(seller_id=auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS proposals_delete ON proposals;
CREATE POLICY proposals_delete ON proposals FOR DELETE TO authenticated USING(seller_id=auth.uid() OR public.is_admin());

-- STORAGE
DROP POLICY IF EXISTS storage_machine_select ON storage.objects;
CREATE POLICY storage_machine_select ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='machine-photos');
DROP POLICY IF EXISTS storage_machine_insert ON storage.objects;
CREATE POLICY storage_machine_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='machine-photos' AND public.is_admin());
DROP POLICY IF EXISTS storage_machine_update ON storage.objects;
CREATE POLICY storage_machine_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='machine-photos' AND public.is_admin())
WITH CHECK(bucket_id='machine-photos' AND public.is_admin());
DROP POLICY IF EXISTS storage_machine_delete ON storage.objects;
CREATE POLICY storage_machine_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='machine-photos' AND public.is_admin());

-- user_roles policies se existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles') THEN
    DROP POLICY IF EXISTS user_roles_read ON public.user_roles;
    CREATE POLICY user_roles_read ON public.user_roles FOR SELECT TO authenticated
    USING(user_id = auth.uid() OR public.is_admin());
  END IF;
END $$;
