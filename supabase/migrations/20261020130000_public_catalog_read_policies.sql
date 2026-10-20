/*
# Leitura pública da vitrine (role `anon`)

As políticas de SELECT de `machines`, `machine_photos`, `machine_images` e `categories`
foram criadas com `TO authenticated`. Visitantes não autenticados (role `anon`) recebem
0 linhas — por isso a vitrine (`/` e `/vitrine`) só exibia máquinas depois do login.

Como políticas RLS permissivas são somadas (OR), esta migration adiciona políticas de
SELECT para `anon` sem afetar as regras de escrita (INSERT/UPDATE/DELETE continuam
restritas a admin).

Regra de visibilidade pública:
  - `machines`: apenas status visível no catálogo (`is_active_for_catalog(status)`)
  - `machine_photos` / `machine_images`: todas as fotos das máquinas visíveis
  - `categories`: todas (filtro de visibilidade é feito na aplicação)
*/

-- ============================================================
-- Helper de visibilidade precisa ser executável por `anon`
-- ============================================================
GRANT EXECUTE ON FUNCTION public.is_active_for_catalog(text) TO anon;

-- ============================================================
-- MACHINES — somente registros visíveis no catálogo
-- ============================================================
DROP POLICY IF EXISTS machines_select_public ON public.machines;
CREATE POLICY machines_select_public ON public.machines
  FOR SELECT TO anon
  USING (public.is_active_for_catalog(status));
GRANT SELECT ON public.machines TO anon;

-- ============================================================
-- MACHINE_PHOTOS
-- ============================================================
DROP POLICY IF EXISTS photos_select_public ON public.machine_photos;
CREATE POLICY photos_select_public ON public.machine_photos
  FOR SELECT TO anon
  USING (true);
GRANT SELECT ON public.machine_photos TO anon;

-- ============================================================
-- MACHINE_IMAGES (tabela legada, se existir)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'machine_images') THEN
    EXECUTE 'DROP POLICY IF EXISTS images_select_public ON public.machine_images';
    EXECUTE 'CREATE POLICY images_select_public ON public.machine_images FOR SELECT TO anon USING (true)';
    EXECUTE 'GRANT SELECT ON public.machine_images TO anon';
  END IF;
END $$;

-- ============================================================
-- CATEGORIES (filtros da vitrine)
-- ============================================================
DROP POLICY IF EXISTS categories_select_public ON public.categories;
CREATE POLICY categories_select_public ON public.categories
  FOR SELECT TO anon
  USING (true);
GRANT SELECT ON public.categories TO anon;

-- ============================================================
-- STORAGE — leitura pública do bucket de fotos da vitrine
-- ============================================================
DROP POLICY IF EXISTS storage_machine_select_public ON storage.objects;
CREATE POLICY storage_machine_select_public ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'machine-photos');
