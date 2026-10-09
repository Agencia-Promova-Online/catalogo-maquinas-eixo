/*
# Compatibiliza tabelas existentes do invest-catalog para estrutura eixo-catalogo
# PRESERVA TODOS OS DADOS
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. PROFILES
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;

UPDATE public.profiles
SET full_name = COALESCE(NULLIF(btrim(full_name), ''), name, '')
WHERE full_name IS NULL OR btrim(full_name) = '';

UPDATE public.profiles
SET is_active = COALESCE(is_active, active, true)
WHERE is_active IS NULL;

UPDATE public.profiles p
SET role = COALESCE(p.role, CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin') THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'vendedor') THEN 'seller'
    ELSE 'seller'
END)
WHERE p.role IS NULL;

ALTER TABLE public.profiles ALTER COLUMN full_name SET DEFAULT '';
UPDATE public.profiles SET full_name = '' WHERE full_name IS NULL;
ALTER TABLE public.profiles ALTER COLUMN full_name SET NOT NULL;

ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT true;
UPDATE public.profiles SET is_active = true WHERE is_active IS NULL;
ALTER TABLE public.profiles ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'seller';
UPDATE public.profiles SET role = 'seller' WHERE role IS NULL;
ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'seller'));

DROP INDEX IF EXISTS profiles_email_lower_key;
CREATE UNIQUE INDEX profiles_email_lower_key ON profiles(lower(email));

-- ============================================================
-- 2. CATEGORIES
-- ============================================================
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
UPDATE public.categories SET is_visible = COALESCE(active, true);

DROP INDEX IF EXISTS categories_name_lower_key;
CREATE UNIQUE INDEX categories_name_lower_key ON categories(lower(name));

INSERT INTO public.categories(name, is_visible)
SELECT name, true FROM (VALUES
  ('ESCAVADEIRA'),('RETROESCAVADEIRA'),('MINI ESCAVADEIRA'),
  ('MINI CARREGADEIRA'),('PÁ CARREGADEIRA'),('MÁQUINA AGRÍCOLA'),('CAMINHÃO')
) s(name)
WHERE NOT EXISTS(SELECT 1 FROM public.categories c WHERE lower(c.name)=lower(s.name));

-- ============================================================
-- 3. MACHINES
-- ============================================================
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS value numeric(14,2);
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS manufacture_year integer;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS category_id uuid
  REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS internal_code text;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS configuration text;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS validation jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS applications text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS qualities text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS created_by uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid();

UPDATE public.machines SET value = COALESCE(value, price, 0) WHERE value IS NULL;
UPDATE public.machines SET manufacture_year = year WHERE manufacture_year IS NULL AND year IS NOT NULL;

ALTER TABLE public.machines ALTER COLUMN value SET DEFAULT 0;
UPDATE public.machines SET value = 0 WHERE value IS NULL;
ALTER TABLE public.machines ALTER COLUMN value SET NOT NULL;

CREATE EXTENSION IF NOT EXISTS unaccent;
UPDATE public.machines SET status = CASE
    WHEN lower(regexp_replace(unaccent(COALESCE(status,'')), '[^a-z]','','g')) IN ('disponivel','available','ativo') THEN 'available'
    WHEN lower(regexp_replace(unaccent(COALESCE(status,'')), '[^a-z]','','g')) IN ('negociacao','emnegociacao','negotiating') THEN 'negotiating'
    WHEN lower(regexp_replace(unaccent(COALESCE(status,'')), '[^a-z]','','g')) IN ('vendido','sold') THEN 'sold'
    WHEN lower(regexp_replace(unaccent(COALESCE(status,'')), '[^a-z]','','g')) IN ('indisponivel','unavailable','inativo') THEN 'unavailable'
    ELSE 'available'
END;

ALTER TABLE public.machines DROP CONSTRAINT IF EXISTS machines_status_check;
ALTER TABLE public.machines ADD CONSTRAINT machines_status_check
  CHECK (status IN ('available','negotiating','sold','unavailable'));

INSERT INTO public.categories(name, is_visible)
SELECT DISTINCT upper(btrim(m.category)), true
FROM public.machines m
WHERE btrim(COALESCE(m.category,'')) <> ''
  AND NOT EXISTS(SELECT 1 FROM public.categories c WHERE lower(c.name)=lower(btrim(m.category)));

UPDATE public.machines m
SET category_id = c.id
FROM public.categories c
WHERE m.category_id IS NULL AND lower(btrim(m.category)) = lower(c.name);

CREATE INDEX IF NOT EXISTS machines_category_idx ON machines(category_id);
CREATE INDEX IF NOT EXISTS machines_brand_idx ON machines(brand);
CREATE INDEX IF NOT EXISTS machines_updated_at_idx ON machines(updated_at DESC);

-- ============================================================
-- 4. MACHINE_IMAGES -> MACHINE_PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.machine_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    public_url text,
    photo_type text NOT NULL DEFAULT 'other',
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='machine_images' AND table_schema='public') THEN
        INSERT INTO public.machine_photos (id, machine_id, storage_path, public_url, photo_type, is_primary, created_at)
        SELECT
            mi.id,
            mi.machine_id,
            COALESCE(mi.storage_path, ''),
            mi.image_url,
            COALESCE(NULLIF(btrim(mi.label),''), 'other'),
            COALESCE(mi.is_main, false),
            mi.created_at
        FROM public.machine_images mi
        WHERE NOT EXISTS (SELECT 1 FROM public.machine_photos mp WHERE mp.id = mi.id);
    END IF;
END $$;

-- ============================================================
-- 5. APP_SETTINGS -> COMPANY_SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name text NOT NULL DEFAULT 'Eixo-Catálogo',
    phone text,
    whatsapp_template text NOT NULL DEFAULT '🚜 {MODELO}
💰 Valor: {VALOR}
💳 Entrada: {ENTRADA}
📆 Parcelas a partir de: {PARCELA}
Tenho fotos e informações completas dessa máquina. Posso te enviar?',
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='app_settings' AND table_schema='public') THEN
        INSERT INTO public.company_settings(company_name, phone, whatsapp_template)
        SELECT
            COALESCE(a.company_name,'Eixo-Catálogo'),
            COALESCE(a.phone, a.whatsapp),
            COALESCE(NULLIF(btrim(a.whatsapp_template),''),
'🚜 {MODELO}
💰 Valor: {VALOR}
💳 Entrada: {ENTRADA}
📆 Parcelas a partir de: {PARCELA}
Tenho fotos e informações completas dessa máquina. Posso te enviar?')
        FROM public.app_settings a
        WHERE NOT EXISTS (SELECT 1 FROM public.company_settings);
    END IF;
END $$;

INSERT INTO public.company_settings(company_name)
SELECT 'Eixo-Catálogo' WHERE NOT EXISTS(SELECT 1 FROM public.company_settings);

-- ============================================================
-- 6. MACHINE_CHANGE_LOG -> CATALOG_AUDIT_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.catalog_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
    actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    field_name text NOT NULL,
    old_value text,
    new_value text,
    created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='machine_change_log' AND table_schema='public') THEN
        INSERT INTO public.catalog_audit_logs(machine_id, actor_id, field_name, old_value, new_value, created_at)
        SELECT machine_id, user_id, field, old_value, new_value, created_at
        FROM public.machine_change_log
        WHERE NOT EXISTS (SELECT 1 FROM public.catalog_audit_logs);
    END IF;
END $$;

-- ============================================================
-- 7. TABELAS NOVAS (brands, segments, rate_tables, seller_brands, proposals)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.brands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    logo_url text,
    accent_color text NOT NULL DEFAULT '#B8963F',
    cnpj text,
    address text,
    representative text,
    phone text,
    site text,
    instagram text,
    is_active boolean NOT NULL DEFAULT true,
    proposal_sequence integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
DROP INDEX IF EXISTS brands_name_lower_key;
CREATE UNIQUE INDEX brands_name_lower_key ON public.brands(lower(name));

INSERT INTO public.brands(name, is_active)
SELECT DISTINCT upper(btrim(m.brand)), true
FROM public.machines m
WHERE btrim(COALESCE(m.brand,'')) <> ''
  AND NOT EXISTS(SELECT 1 FROM public.brands b WHERE lower(b.name)=lower(btrim(m.brand)));

CREATE TABLE IF NOT EXISTS public.segments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    min_term integer NOT NULL DEFAULT 1 CHECK(min_term>0),
    max_term integer NOT NULL DEFAULT 240 CHECK(max_term>=min_term),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
DROP INDEX IF EXISTS segments_name_lower_key;
CREATE UNIQUE INDEX segments_name_lower_key ON public.segments(lower(name));

INSERT INTO public.segments(name, min_term, max_term)
SELECT 'BENS PESADOS', 12, 120 WHERE NOT EXISTS(SELECT 1 FROM public.segments WHERE lower(name)='bens pesados');
INSERT INTO public.segments(name, min_term, max_term)
SELECT 'VEÍCULOS', 12, 84 WHERE NOT EXISTS(SELECT 1 FROM public.segments WHERE lower(name)='veículos');
INSERT INTO public.segments(name, min_term, max_term)
SELECT 'IMÓVEIS', 60, 240 WHERE NOT EXISTS(SELECT 1 FROM public.segments WHERE lower(name)='imóveis');

CREATE TABLE IF NOT EXISTS public.rate_tables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    segment_id uuid NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
    admin_rate numeric(7,3) NOT NULL CHECK(admin_rate>=0),
    reserve_rate numeric(7,3) NOT NULL CHECK(reserve_rate>=0),
    insurance_rate numeric(7,3) NOT NULL CHECK(insurance_rate>=0),
    valid_from date NOT NULL,
    valid_until date,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(valid_until IS NULL OR valid_until>=valid_from)
);

CREATE TABLE IF NOT EXISTS public.seller_brands (
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(seller_id, brand_id)
);

CREATE TABLE IF NOT EXISTS public.proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_number integer NOT NULL,
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT auth.uid(),
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
    segment_id uuid NOT NULL REFERENCES public.segments(id) ON DELETE RESTRICT,
    rate_table_id uuid NOT NULL REFERENCES public.rate_tables(id) ON DELETE RESTRICT,
    client_name text NOT NULL,
    credit_value numeric(14,2) NOT NULL CHECK(credit_value>0),
    entry_value numeric(14,2) NOT NULL CHECK(entry_value>=0),
    monthly_installment numeric(14,2) NOT NULL CHECK(monthly_installment>0),
    term_months integer NOT NULL CHECK(term_months>0),
    admin_rate_snapshot numeric(7,3) NOT NULL,
    reserve_rate_snapshot numeric(7,3) NOT NULL,
    insurance_rate_snapshot numeric(7,3) NOT NULL,
    status text NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','sent','viewed')),
    pdf_url text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposals_seller_idx ON public.proposals(seller_id, created_at DESC);

-- ============================================================
-- 8. RLS + HELPERS
-- ============================================================
DO $$ BEGIN ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.machine_photos ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.catalog_audit_logs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.rate_tables ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.seller_brands ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN NULL; END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('machine-photos','machine-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
