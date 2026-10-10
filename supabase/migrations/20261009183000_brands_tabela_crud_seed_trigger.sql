/* =========================================================================
   Migration: Tabela `brands` (Marcas) — CRUD oficial + integridade com máquinas
   Projeto: catalogo-eixo · Eixo-Catálogo Operação Comercial
   Data:    2026-10-09 19:00 UTC-3 (ATUALIZADA: patching para tabela pré-existente)
   Objetivo:
     · Criar tabela `public.brands` (id uuid PK, nome, acento visual, ativa, timestamps)
     · SE a tabela JÁ EXISTIR no banco (legada com 1 coluna só), ADICIONA as colunas faltantes
       SEM perder dados de nome já salvos.
     · Seed automático a partir de `public.machines.brand` (nomes JÁ cadastrados em máquinas)
     · Criar policies RLS SELECT/INSERT/UPDATE/DELETE (admin edita; authenticated/public só le)
     · Trigger function `sync_machine_brand_name_from_brands()`: quando renomear/excluir marca
       na tabela `brands`, atualiza a coluna texto `machines.brand` para manter compatibilidade
       com as queries que já usam `m.brand` (dual-read).
   Obs: 100% idempotente, pode rodar várias vezes sem medo.
        - Resolve o erro "column 'slug' of relation 'brands' does not exist" quando a tabela
          já existia sem as colunas novas.
   ========================================================================= */

-- 0) Garantir extensão pgcrypto (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================================
-- 1) CRIAR TABELA `public.brands` (ou PATCHAR se já existe com menos colunas)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (char_length(trim(name)) >= 2 AND char_length(trim(name)) <= 80),
  slug            text,
  accent_color    text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== PATCH: adicionar colunas FALTANTES se a tabela brands JÁ existia (legada) =====
-- (isso resolve o erro da linha 49 anterior: column "slug" does not exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='brands') THEN

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='slug') THEN
      ALTER TABLE public.brands ADD COLUMN slug text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='accent_color') THEN
      ALTER TABLE public.brands ADD COLUMN accent_color text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='is_active') THEN
      ALTER TABLE public.brands ADD COLUMN is_active boolean NOT NULL DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='created_at') THEN
      ALTER TABLE public.brands ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='updated_at') THEN
      ALTER TABLE public.brands ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    END IF;

    -- id uuid PK + default gen_random_uuid(): se a tabela legada tinha id text ou sem default, arruma
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_type='PRIMARY KEY' AND table_schema='public' AND table_name='brands') THEN
      -- tenta transformar coluna id em PK uuid
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='id') THEN
        ALTER TABLE public.brands ALTER COLUMN id TYPE uuid USING (id::text::uuid);
        ALTER TABLE public.brands ADD PRIMARY KEY (id);
      ELSE
        ALTER TABLE public.brands ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
      END IF;
    END IF;

    -- Garantir DEFAULT gen_random_uuid() no id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='id') THEN
      ALTER TABLE public.brands ALTER COLUMN id SET DEFAULT gen_random_uuid();
    END IF;

    -- Garantir UNIQUE em name (se ainda não existir)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brands_name_unique') THEN
      ALTER TABLE public.brands ADD CONSTRAINT brands_name_unique UNIQUE (name);
    END IF;

    -- Garantir CHECK char_length no name (se não existir)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='brands_name_check' AND conrelid='public.brands'::regclass) THEN
      ALTER TABLE public.brands
        ADD CONSTRAINT brands_name_check
        CHECK (char_length(trim(name)) >= 2 AND char_length(trim(name)) <= 80)
        NOT VALID;
      -- not valid: não revalida linhas antigas que poderiam ser curtas
    END IF;

  END IF;
END $$;

-- trigger de updated_at automático
CREATE OR REPLACE FUNCTION public.set_brands_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_brands_updated_at ON public.brands;
CREATE TRIGGER trg_brands_updated_at
BEFORE UPDATE ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.set_brands_updated_at();

-- =========================================================================
-- 2) SEED AUTOMÁTICO com marcas JÁ EXISTENTES EM public.machines.brand
--    (não duplica graças a UNIQUE(name) + ON CONFLICT DO NOTHING)
--    Executado DENTRO de DO $$ para só rodar se a coluna existir.
-- =========================================================================
DO $$
DECLARE
  v_has_slug         boolean;
  v_has_accent_color boolean;
  v_has_is_active    boolean;
BEGIN
  -- Detectar se as colunas existem (mesmo após patch acima)
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='slug') INTO v_has_slug;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='accent_color') INTO v_has_accent_color;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='is_active') INTO v_has_is_active;

  -- Caso BASE: só a coluna name existe (ou quase)
  IF NOT v_has_slug AND NOT v_has_accent_color AND NOT v_has_is_active THEN
    INSERT INTO public.brands (name)
    SELECT DISTINCT UPPER(TRIM(m.brand)) AS name
    FROM public.machines m
    WHERE m.brand IS NOT NULL AND char_length(trim(m.brand)) >= 2
    ON CONFLICT (name) DO NOTHING;

  ELSIF v_has_slug AND NOT v_has_accent_color AND NOT v_has_is_active THEN
    INSERT INTO public.brands (name, slug)
    SELECT
      UPPER(TRIM(m.brand))                                               AS name,
      REGEXP_REPLACE(LOWER(TRIM(m.brand)), '[^a-z0-9]+', '-', 'g')       AS slug
    FROM (SELECT DISTINCT brand FROM public.machines
          WHERE brand IS NOT NULL AND char_length(trim(brand)) >= 2) m
    ON CONFLICT (name) DO NOTHING;

  ELSIF v_has_slug AND v_has_accent_color AND NOT v_has_is_active THEN
    INSERT INTO public.brands (name, slug, accent_color)
    SELECT
      UPPER(TRIM(m.brand))                                               AS name,
      REGEXP_REPLACE(LOWER(TRIM(m.brand)), '[^a-z0-9]+', '-', 'g')       AS slug,
      '#B8963F'                                                          AS accent_color
    FROM (SELECT DISTINCT brand FROM public.machines
          WHERE brand IS NOT NULL AND char_length(trim(brand)) >= 2) m
    ON CONFLICT (name) DO NOTHING;

  ELSE
    -- CASO COMPLETO (todas as colunas existem — situação desejada)
    INSERT INTO public.brands (name, slug, accent_color, is_active)
    SELECT
      UPPER(TRIM(m.brand))                                               AS name,
      REGEXP_REPLACE(LOWER(TRIM(m.brand)), '[^a-z0-9]+', '-', 'g')       AS slug,
      '#B8963F'                                                          AS accent_color,
      TRUE                                                               AS is_active
    FROM (SELECT DISTINCT brand FROM public.machines
          WHERE brand IS NOT NULL AND char_length(trim(brand)) >= 2) m
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

-- Garantir que o campo slug esteja sempre populado p/ futuras marcas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='slug') THEN
    UPDATE public.brands
    SET    slug = REGEXP_REPLACE(LOWER(TRIM(name)), '[^a-z0-9]+', '-', 'g')
    WHERE  slug IS NULL OR char_length(trim(slug)) = 0;
  END IF;
END $$;

-- Garantir que is_active = true nas linhas antigas (se a coluna foi criada agora, DEFAULT já cuidou,
-- mas caso a coluna existia e tinha NULLs, aqui a gente pacha)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brands' AND column_name='is_active') THEN
    UPDATE public.brands SET is_active = true WHERE is_active IS NULL;
    ALTER TABLE public.brands ALTER COLUMN is_active SET DEFAULT true;
    ALTER TABLE public.brands ALTER COLUMN is_active SET NOT NULL;
  END IF;
END $$;

-- =========================================================================
-- 3) RLS + POLICIES
-- =========================================================================
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- Helper reutilizável (normalmente já existe das migrations anteriores, mas criamos se não)
CREATE OR REPLACE FUNCTION public.is_authenticated_admin()
RETURNS boolean AS $$
DECLARE
  v_id uuid;
  v_role text;
  v_papel text;
BEGIN
  v_id := auth.uid();
  IF v_id IS NULL THEN RETURN false; END IF;

  -- 1) usuarios_perfil.papel (estrutura NOVA pt-BR)
  BEGIN
    SELECT papel INTO v_papel
    FROM   public.usuarios_perfil
    WHERE  id = v_id
    LIMIT  1;
  EXCEPTION WHEN OTHERS THEN v_papel := NULL;
  END;
  IF upper(coalesce(v_papel,'')) = 'ADMIN' THEN RETURN true; END IF;

  -- 2) profiles.role (estrutura antiga)
  BEGIN
    SELECT role INTO v_role
    FROM   public.profiles
    WHERE  id = v_id
    LIMIT  1;
  EXCEPTION WHEN OTHERS THEN v_role := NULL;
  END;
  IF lower(coalesce(v_role,'')) = 'admin' THEN RETURN true; END IF;

  -- 3) user_roles legada
  BEGIN
    PERFORM 1
    FROM    public.user_roles ur
    JOIN    public.roles r ON r.id = ur.role_id
    WHERE   ur.user_id = v_id
    AND     lower(r.name) = 'admin'
    LIMIT   1;
    IF FOUND THEN RETURN true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- SELECT público (qualquer um, inclusive visitantes não autenticados da vitrine)
DROP POLICY IF EXISTS brands_select_public ON public.brands;
CREATE POLICY brands_select_public ON public.brands
  FOR SELECT
  USING (true);

-- INSERT apenas admin
DROP POLICY IF EXISTS brands_admin_insert ON public.brands;
CREATE POLICY brands_admin_insert ON public.brands
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_authenticated_admin() = true);

-- UPDATE apenas admin
DROP POLICY IF EXISTS brands_admin_update ON public.brands;
CREATE POLICY brands_admin_update ON public.brands
  FOR UPDATE
  TO authenticated
  USING   (public.is_authenticated_admin() = true)
  WITH CHECK (public.is_authenticated_admin() = true);

-- DELETE apenas admin
DROP POLICY IF EXISTS brands_admin_delete ON public.brands;
CREATE POLICY brands_admin_delete ON public.brands
  FOR DELETE
  TO authenticated
  USING (public.is_authenticated_admin() = true);

-- Grant público para SELECT (vitrine pública anon consegue ler)
GRANT SELECT ON public.brands TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;

-- Garante sequence id com permissões (se existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'brands_id_seq' AND relkind='S') THEN
    GRANT ALL ON SEQUENCE public.brands_id_seq TO authenticated;
  END IF;
END $$;

-- =========================================================================
-- 4) TRIGGER DE SINCRONIA: atualiza public.machines.brand = nome da marca nova
--    sempre que renomearem uma marca na tabela brands.
--    Motivo: muitas telas legadas usam `m.brand` texto diretamente
--    (ex.: display_name, busca, vitrine). Assim a edição em brands reflete
--    imediatamente em TODAS as máquinas dessa marca.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.sync_machine_brand_name_from_brands()
RETURNS trigger AS $$
DECLARE
  v_old_name text;
  v_new_name text;
BEGIN
  -- CASO 1: UPDATE — nome da marca mudou → atualiza máquinas associadas
  IF TG_OP = 'UPDATE' THEN
    v_old_name := COALESCE(OLD.name,'');
    v_new_name := COALESCE(NEW.name,'');
    IF v_old_name <> v_new_name AND char_length(v_new_name) >= 2 THEN
      UPDATE public.machines
      SET    brand = v_new_name,
             updated_at = now()
      WHERE  UPPER(COALESCE(brand,'')) = UPPER(v_old_name);
    END IF;
    RETURN NEW;
  END IF;

  -- CASO 2: DELETE — marca foi apagada; deixa o brand_text igual (compatibilidade)
  --    e as máquinas continuam mostrando o nome antigo.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_machine_brand_name ON public.brands;
CREATE TRIGGER trg_sync_machine_brand_name
AFTER UPDATE OR DELETE ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.sync_machine_brand_name_from_brands();

-- =========================================================================
-- 5) (OPCIONAL / NÃO DESTRUTIVO) se a tabela machines já tiver uma coluna
--    brand_id uuid para ligação FK estrita, cria a constraint e popula.
--    NÃO cria a coluna (perigoso se não existe), apenas aproveita se já existir.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns c
    WHERE  c.table_schema = 'public'
    AND    c.table_name   = 'machines'
    AND    c.column_name  = 'brand_id'
  ) THEN
    -- popula brand_id das máquinas JÁ existentes de acordo com o nome
    UPDATE public.machines m
    SET    brand_id = b.id
    FROM   public.brands b
    WHERE  UPPER(COALESCE(m.brand,'')) = UPPER(b.name)
    AND    m.brand_id IS NULL;
  END IF;
END $$;
