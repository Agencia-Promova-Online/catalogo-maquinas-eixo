-- =====================================================================
-- RPCs administrativas de usuários (SECURITY DEFINER, só admins usam)
-- Idempotente: CREATE OR REPLACE / DROP POLICY IF EXISTS etc.
-- =====================================================================

-- 1. Helper reutilizavel que usamos em TUDO: só deixa passar se quem CHAMA a função é admin
CREATE OR REPLACE FUNCTION public.is_authenticated_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.role IS NOT NULL AND lower(p.role::text) = 'admin')
          OR (p.role IS NOT NULL AND lower(p.role::text) = 'administrador')
        )
    )
    OR
    EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = 'user_roles'
    )
    AND
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (
          lower(ur.role::text) = 'admin'
          OR lower(ur.role::text) = 'administrador'
        )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_authenticated_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_authenticated_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authenticated_admin() TO postgres;

-- =====================================================================
-- 2. Cria usuário (auth.users + profile.role / active + sync user_roles)
--    Retorna UUID do perfil criado
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_full_name text,
  p_role text,
  p_is_active boolean,
  p_temp_password text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id   uuid;
  v_role_norm text;
BEGIN
  IF NOT public.is_authenticated_admin() THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores podem criar usuários.';
  END IF;

  p_email       := lower(btrim(p_email));
  p_full_name   := btrim(coalesce(p_full_name, ''));
  p_role        := lower(btrim(coalesce(p_role, 'seller')));
  p_is_active   := coalesce(p_is_active, true);

  IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;

  IF length(coalesce(p_temp_password, '')) < 6 THEN
    RAISE EXCEPTION 'A senha temporária deve ter pelo menos 6 caracteres.';
  END IF;

  -- Normaliza role para o formato novo (admin / seller), aceita pt-BR
  IF p_role IN ('vendedor', 'seller', 's', 'v')           THEN v_role_norm := 'seller';
  ELSIF p_role IN ('admin', 'administrador', 'a', 'adm')  THEN v_role_norm := 'admin';
  ELSE v_role_norm := 'seller';
  END IF;

  -- 1) Cria no auth.users (não envia email de confirmação, pois é admin criando)
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    banned_until
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_temp_password, gen_salt('bf')),
    now(),
    NULL,
    NULL,
    jsonb_build_object('provider','email','providers',ARRAY['email']),
    jsonb_build_object('full_name', p_full_name, 'name', p_full_name),
    false,
    now(),
    now(),
    '',
    '',
    '',
    '',
    NULL
  ) RETURNING id INTO v_user_id;

  -- 2) Garante profile
  INSERT INTO public.profiles (id, name, full_name, email, role, active, is_active, created_at, updated_at)
  VALUES (
    v_user_id,
    p_full_name,
    p_full_name,
    p_email,
    v_role_norm,
    p_is_active,
    p_is_active,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    full_name  = EXCLUDED.full_name,
    email      = EXCLUDED.email,
    role       = EXCLUDED.role,
    active     = EXCLUDED.active,
    is_active  = EXCLUDED.is_active,
    updated_at = now();

  -- 3) Se existir tabela user_roles (legada invest-catalog), sincroniza
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    INSERT INTO public.user_roles (user_id, role, app_role)
    VALUES (
      v_user_id,
      v_role_norm,
      CASE WHEN v_role_norm = 'admin' THEN 'admin'::app_role ELSE 'seller'::app_role END
    );
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, boolean, text) TO postgres;

-- =====================================================================
-- 3. Redefine senha temporária de um usuário (por profile_id)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_profile_id uuid,
  p_new_temp_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF NOT public.is_authenticated_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Use a tela "Esqueci minha senha" para redefinir a sua própria senha.';
  END IF;

  IF length(coalesce(p_new_temp_password, '')) < 6 THEN
    RAISE EXCEPTION 'A senha temporária deve ter pelo menos 6 caracteres.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_profile_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado.';
  END IF;

  UPDATE auth.users SET
    encrypted_password   = crypt(p_new_temp_password, gen_salt('bf')),
    updated_at           = now(),
    recovery_token       = '',
    confirmation_token   = ''
  WHERE id = p_profile_id;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, text) TO postgres;

-- =====================================================================
-- 4. Exclui usuário (auth.users + profiles + user_roles legado)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF NOT public.is_authenticated_admin() THEN
    RAISE EXCEPTION 'Permissão negada.';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode excluir a sua própria conta.';
  END IF;

  -- user_roles legado
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles') THEN
    DELETE FROM public.user_roles WHERE user_id = p_profile_id;
  END IF;

  -- profiles
  DELETE FROM public.profiles WHERE id = p_profile_id;

  -- auth identities (se existir)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    DELETE FROM auth.identities WHERE user_id = p_profile_id;
  END IF;

  -- auth.users
  DELETE FROM auth.users WHERE id = p_profile_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO postgres;
