-- =====================================================================
-- Estrutura: auth.users (Supabase) 1:1 public.usuarios_perfil
-- Nomes de colunas em PT-BR EXATAMENTE como na estrutura do usuário:
--   id (uuid FK auth.users), nome (text), papel (text), criado_em (timestamptz)
-- Idempotente: CREATE IF NOT EXISTS, DO $$ blocks, INSERT ... ON CONFLICT
-- =====================================================================

-- 1) Tabela usuarios_perfil (se não existir)
CREATE TABLE IF NOT EXISTS public.usuarios_perfil (
  id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome      text NOT NULL,
  papel     text NOT NULL DEFAULT 'vendedor',
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- 2) Migração de profiles antigos para usuarios_perfil (preserva dados já cadastrados!)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    INSERT INTO public.usuarios_perfil (id, nome, papel, criado_em)
    SELECT
      p.id,
      COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(p.name::text), ''), 'Sem nome') AS nome,
      CASE
        WHEN lower(COALESCE(p.role::text, '')) IN ('admin','administrador','adm') THEN 'admin'
        ELSE 'vendedor'
      END AS papel,
      COALESCE(p.created_at::timestamptz, now()) AS criado_em
    FROM public.profiles p
    ON CONFLICT (id) DO UPDATE SET
      nome      = EXCLUDED.nome,
      papel     = CASE
                    WHEN lower(usuarios_perfil.papel) NOT IN ('admin','vendedor')
                      OR usuarios_perfil.papel IS NULL
                    THEN EXCLUDED.papel ELSE usuarios_perfil.papel END;
  END IF;
END $$;

-- 3) Migração da tabela legada user_roles para usuarios_perfil.papel se existir
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    UPDATE public.usuarios_perfil up SET papel = 'admin'
    WHERE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = up.id AND lower(COALESCE(ur.role::text, '')) IN ('admin','administrador')
    ) AND lower(COALESCE(up.papel,'')) != 'admin';
  END IF;
END $$;

-- 4) RLS + Policies permissivas
ALTER TABLE public.usuarios_perfil ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_perfil_select ON public.usuarios_perfil;
CREATE POLICY usuarios_perfil_select ON public.usuarios_perfil
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS usuarios_perfil_self_update ON public.usuarios_perfil;
CREATE POLICY usuarios_perfil_self_update ON public.usuarios_perfil
  FOR UPDATE TO authenticated USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS usuarios_perfil_insert_own ON public.usuarios_perfil;
CREATE POLICY usuarios_perfil_insert_own ON public.usuarios_perfil
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- 5b) PATCH: atualiza public.is_admin() existente (da migration 151518) para
--     TAMBÉM ler a tabela nova usuarios_perfil.papel (compatibilidade dupla)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN (
    -- 1) TABELA NOVA usuarios_perfil (estrutura do usuário: id, nome, papel, criado_em)
    EXISTS (
      SELECT 1 FROM public.usuarios_perfil up
      WHERE up.id = auth.uid()
        AND lower(COALESCE(up.papel,'')) IN ('admin','administrador','adm')
    )
    -- 2) fallback profiles antiga (coluna role inline)
    OR EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'profiles'
    ) AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(COALESCE(p.role::text,'')) IN ('admin','administrador','adm')
    )
    -- 3) fallback user_roles legada
    OR EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_roles'
    ) AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND lower(COALESCE(ur.role::text,'')) IN ('admin','administrador','adm')
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, postgres;

-- 5) Helper: is_authenticated_admin baseado em usuarios_perfil.papel
CREATE OR REPLACE FUNCTION public.is_authenticated_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN (
    -- tabela nova usuarios_perfil
    EXISTS (
      SELECT 1 FROM public.usuarios_perfil up
      WHERE up.id = auth.uid()
        AND lower(COALESCE(up.papel,'')) IN ('admin','administrador')
    )
    -- fallback profiles antiga (se ainda existir)
    OR EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'profiles'
    ) AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(COALESCE(p.role::text,'')) IN ('admin','administrador')
    )
    -- fallback user_roles legada
    OR EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_roles'
    ) AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND lower(COALESCE(ur.role::text,'')) IN ('admin','administrador')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_authenticated_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_authenticated_admin() TO authenticated, postgres;

-- 6) Policies ADMIN globais: só admin pode fazer INSERT/UPDATE/DELETE de TERCEIROS em usuarios_perfil
DROP POLICY IF EXISTS usuarios_perfil_admin_all ON public.usuarios_perfil;
CREATE POLICY usuarios_perfil_admin_all ON public.usuarios_perfil
  FOR ALL TO authenticated
  USING (public.is_authenticated_admin())
  WITH CHECK (public.is_authenticated_admin());

-- 7) Trigger que cria automaticamente a row usuarios_perfil quando um user é criado no Supabase Auth
--    (funciona com signUp SDK e convite do dashboard)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome  text;
  v_papel text;
BEGIN
  v_nome  := COALESCE(
               NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
               NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
               NULLIF(TRIM(NEW.raw_user_meta_data->>'nome'), ''),
               SPLIT_PART(NEW.email, '@', 1)
             );
  v_papel := CASE
               WHEN lower(COALESCE(NEW.raw_user_meta_data->>'papel','')) IN ('admin','administrador') THEN 'admin'
               ELSE 'vendedor'
             END;
  INSERT INTO public.usuarios_perfil (id, nome, papel, criado_em)
  VALUES (NEW.id, v_nome, v_papel, COALESCE(NEW.created_at::timestamptz, now()))
  ON CONFLICT (id) DO UPDATE SET
    nome      = COALESCE(NULLIF(TRIM(usuarios_perfil.nome),''), EXCLUDED.nome),
    papel     = CASE WHEN lower(COALESCE(usuarios_perfil.papel,'')) IN ('admin','vendedor')
                     THEN usuarios_perfil.papel ELSE EXCLUDED.papel END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8) RPC admin_set_perfil_acesso (equivalente ao admin_set_profile_access antigo, para usuarios_perfil)
CREATE OR REPLACE FUNCTION public.admin_set_perfil_acesso(
  p_perfil_id uuid,
  p_papel     text,
  p_ativo     boolean DEFAULT true
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_papel_norm text;
BEGIN
  IF NOT public.is_authenticated_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;
  v_papel_norm := CASE WHEN lower(COALESCE(p_papel,'')) IN ('admin','administrador','adm') THEN 'admin' ELSE 'vendedor' END;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios_perfil WHERE id = p_perfil_id) THEN
    RAISE EXCEPTION 'Perfil não encontrado.';
  END IF;
  UPDATE public.usuarios_perfil SET papel = v_papel_norm WHERE id = p_perfil_id;
  -- também atualiza profiles antiga e user_roles se existirem
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') THEN
    UPDATE public.profiles SET
      role       = v_papel_norm,
      is_active  = p_ativo,
      active     = p_ativo,
      updated_at = now()
    WHERE id = p_perfil_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles') THEN
    DELETE FROM public.user_roles WHERE user_id = p_perfil_id;
    BEGIN
      INSERT INTO public.user_roles (user_id, role, app_role)
      VALUES (p_perfil_id, v_papel_norm, CASE WHEN v_papel_norm='admin' THEN 'admin'::app_role ELSE 'seller'::app_role END);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  -- ativa/desativa o auth.users (banned_until) se p_ativo for false
  IF p_ativo = false THEN
    UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = p_perfil_id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = p_perfil_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_perfil_acesso(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_perfil_acesso(uuid, text, boolean) TO authenticated, postgres;

-- 9) RPC admin_excluir_usuario = deleta auth.users (cascade em usuarios_perfil)
CREATE OR REPLACE FUNCTION public.admin_excluir_usuario(p_perfil_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_authenticated_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;
  IF p_perfil_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode excluir a sua própria conta.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles') THEN
    DELETE FROM public.user_roles WHERE user_id = p_perfil_id;
  END IF;
  DELETE FROM public.usuarios_perfil WHERE id = p_perfil_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    DELETE FROM auth.identities WHERE user_id = p_perfil_id;
  END IF;
  DELETE FROM auth.users WHERE id = p_perfil_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_excluir_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario(uuid) TO authenticated, postgres;
