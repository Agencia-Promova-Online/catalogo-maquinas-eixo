/*
# Harden profile permissions (compatível com banco legado invest-catalog)

1. Mantém a função `admin_set_profile_access` atualizada em OR REPLACE, agora
   compatível com AMBOS os esquemas:
     - usa `role` / `is_active` inline na tabela profiles (novo)
     - ATUALIZA TAMBÉM a tabela `user_roles` do invest-catalog legado, se existir
   (mesma implementação dual-schema da migration 151518, para idempotência).

2. Garante que authenticated só consegue dar UPDATE na coluna full_name
   (role / is_active ficam restritos ao admin via função SECURITY DEFINER).

3. Como grants e REVOKE podem falhar se a tabela tem dono diferente, envolvemos
   em DO $$ com EXCEPTION WHEN OTHERS.
*/

-- ===== Função helper: usuário atual é admin? (compat dual-schema) =====
CREATE OR REPLACE FUNCTION public._harden_is_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_table boolean;
BEGIN
  -- Nova estrutura (coluna inline): profiles.role = 'admin' AND profiles.is_active
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true) THEN
    RETURN true;
  END IF;
  -- Estrutura legada (tabela user_roles separada):
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) INTO has_table;
  IF has_table THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role::text = 'admin'
    );
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public._harden_is_admin() FROM PUBLIC;

-- ===== admin_set_profile_access (dual-schema) =====
CREATE OR REPLACE FUNCTION public.admin_set_profile_access(
  p_profile_id uuid,
  p_role text,
  p_is_active boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_user_roles boolean;
  mapped_role text;
BEGIN
  IF NOT public._harden_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_role NOT IN ('admin', 'seller') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  -- Nova estrutura
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('role','is_active')
    GROUP BY table_name HAVING COUNT(*) = 2
  ) THEN
    UPDATE public.profiles
    SET role = p_role, is_active = p_is_active, updated_at = now()
    WHERE id = p_profile_id;
  END IF;
  -- Colunas name/active legadas (fallback)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name = 'active'
  ) THEN
    UPDATE public.profiles SET active = p_is_active, updated_at = now()
    WHERE id = p_profile_id;
  END IF;

  -- Estrutura legada: tabela user_roles separada
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_roles'
  ) INTO has_user_roles;
  IF has_user_roles THEN
    -- Mapeamento admin/seller <-> admin/vendedor
    mapped_role := CASE p_role WHEN 'seller' THEN 'vendedor' ELSE p_role END;
    DELETE FROM public.user_roles WHERE user_id = p_profile_id;
    INSERT INTO public.user_roles(user_id, role)
    VALUES (p_profile_id, mapped_role::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_profile_access(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_access(uuid, text, boolean) TO authenticated;

-- ===== Restringe UPDATE em profiles (só full_name / name pode ser alterado diretamente) =====
DO $$
BEGIN
  REVOKE UPDATE ON public.profiles FROM authenticated;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='full_name'
  ) THEN
    GRANT UPDATE (full_name) ON public.profiles TO authenticated;
  END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='name'
  ) THEN
    GRANT UPDATE (name) ON public.profiles TO authenticated;
  END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ===== Policy de update no profiles =====
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public._harden_is_admin())
WITH CHECK (id = auth.uid() OR public._harden_is_admin());
