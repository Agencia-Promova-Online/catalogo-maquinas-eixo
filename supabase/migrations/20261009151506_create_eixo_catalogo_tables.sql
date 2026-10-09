/*
# Eixo-Catálogo tables (adaptado para banco legado invest-catalog)

O banco alvo JÁ POSSUI tabelas com dados reais das migrações do invest-catalog
(profiles, categories, machines, machine_images, app_settings, machine_change_log).
Por isso, NÃO recriamos tabelas que já existem — a migração
160000_compatibilizar_tabelas_existentes.sql é quem adiciona as colunas novas
compatíveis (ADD COLUMN IF NOT EXISTS) e faz o backfill.

Aqui criamos apenas as tabelas COMPLETAMENTE NOVAS do Eixo-Catálogo que não
existiam no invest-catalog: brands, segments, rate_tables, seller_brands, proposals.
Também garantimos o bucket de storage de fotos (idempotente via ON CONFLICT).

Cada CREATE TABLE usa IF NOT EXISTS para esta migration ser re-executável.
*/
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  -- profiles: tabela já existe no banco legado (invest-catalog) com colunas
  -- name, email, active. A compatibilização (full_name, role, is_active etc)
  -- fica a cargo da migration 160000.
  -- categories, machines: idem, já existem com estrutura legada.
  -- machine_photos, company_settings, catalog_audit_logs: serão criadas pela
  -- migration 160000 com migração de dados a partir das tabelas antigas
  -- (machine_images, app_settings, machine_change_log). Criar aqui antes
  -- causaria a tabela vazia antes da migração de dados.
  NULL;
END $$;

-- ============================================================
-- TABELAS EXCLUSIVAS DO EIXO-CATÁLOGO (NÃO EXISTIAM NO LEGADO)
-- ============================================================

CREATE TABLE IF NOT EXISTS brands (
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
CREATE UNIQUE INDEX IF NOT EXISTS brands_name_lower_key ON brands(lower(name));

CREATE TABLE IF NOT EXISTS segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_term integer NOT NULL DEFAULT 1 CHECK(min_term>0),
  max_term integer NOT NULL DEFAULT 240 CHECK(max_term>=min_term),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS segments_name_lower_key ON segments(lower(name));

CREATE TABLE IF NOT EXISTS rate_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  admin_rate numeric(7,3) NOT NULL CHECK(admin_rate>=0),
  reserve_rate numeric(7,3) NOT NULL CHECK(reserve_rate>=0),
  insurance_rate numeric(7,3) NOT NULL CHECK(insurance_rate>=0),
  valid_from date NOT NULL,
  valid_until date,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(valid_until IS NULL OR valid_until>=valid_from)
);

CREATE TABLE IF NOT EXISTS seller_brands (
  seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(seller_id,brand_id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_number integer NOT NULL,
  seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE RESTRICT,
  rate_table_id uuid NOT NULL REFERENCES rate_tables(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS proposals_seller_idx ON proposals(seller_id,created_at DESC);

-- ===== RLS =====
DO $$ BEGIN
  ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE rate_tables ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE seller_brands ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ===== Seed básico de segments =====
INSERT INTO segments(name, min_term, max_term)
SELECT name, min_term, max_term FROM (
  VALUES
    ('MÁQUINAS PESADAS', 24, 120),
    ('VEÍCULOS LEVES', 12, 60),
    ('IMOBILIÁRIO', 120, 240),
    ('AGRO', 36, 180)
) s(name, min_term, max_term)
WHERE NOT EXISTS (SELECT 1 FROM segments seg WHERE lower(seg.name) = lower(s.name));

-- ===== Bucket de storage para fotos de máquinas =====
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('machine-photos','machine-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
