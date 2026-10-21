/*
 Garante que o cadastro/edição de máquinas use a regra de admin atual
 baseada em public.is_admin(), que já lê usuarios_perfil.papel.

 Contexto do bug:
 - existia uma policy legada "Admins manage machines" usando
   app_private.has_role(auth.uid(), 'admin')
 - novos admins criados em usuarios_perfil conseguiam logar,
   mas não passavam nessa policy antiga para INSERT
 - resultado: o botão "Salvar máquina" parecia não funcionar
*/

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active users read machines" ON public.machines;
DROP POLICY IF EXISTS "Admins manage machines" ON public.machines;
DROP POLICY IF EXISTS machines_select ON public.machines;
DROP POLICY IF EXISTS machines_insert ON public.machines;
DROP POLICY IF EXISTS machines_update ON public.machines;
DROP POLICY IF EXISTS machines_delete ON public.machines;

CREATE POLICY machines_select ON public.machines
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_active_for_catalog(status));

CREATE POLICY machines_insert ON public.machines
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY machines_update ON public.machines
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY machines_delete ON public.machines
  FOR DELETE TO authenticated
  USING (public.is_admin());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'machine_photos'
  ) THEN
    EXECUTE 'ALTER TABLE public.machine_photos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS photos_select ON public.machine_photos';
    EXECUTE 'DROP POLICY IF EXISTS photos_insert ON public.machine_photos';
    EXECUTE 'DROP POLICY IF EXISTS photos_update ON public.machine_photos';
    EXECUTE 'DROP POLICY IF EXISTS photos_delete ON public.machine_photos';

    EXECUTE 'CREATE POLICY photos_select ON public.machine_photos FOR SELECT TO authenticated USING (true)';
    EXECUTE '' ||
      'CREATE POLICY photos_insert ON public.machine_photos FOR INSERT TO authenticated ' ||
      'WITH CHECK (public.is_admin())';
    EXECUTE '' ||
      'CREATE POLICY photos_update ON public.machine_photos FOR UPDATE TO authenticated ' ||
      'USING (public.is_admin()) WITH CHECK (public.is_admin())';
    EXECUTE '' ||
      'CREATE POLICY photos_delete ON public.machine_photos FOR DELETE TO authenticated ' ||
      'USING (public.is_admin())';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'machine_images'
  ) THEN
    EXECUTE 'ALTER TABLE public.machine_images ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS images_select ON public.machine_images';
    EXECUTE 'DROP POLICY IF EXISTS images_insert ON public.machine_images';
    EXECUTE 'DROP POLICY IF EXISTS images_update ON public.machine_images';
    EXECUTE 'DROP POLICY IF EXISTS images_delete ON public.machine_images';

    EXECUTE 'CREATE POLICY images_select ON public.machine_images FOR SELECT TO authenticated USING (true)';
    EXECUTE '' ||
      'CREATE POLICY images_insert ON public.machine_images FOR INSERT TO authenticated ' ||
      'WITH CHECK (public.is_admin())';
    EXECUTE '' ||
      'CREATE POLICY images_update ON public.machine_images FOR UPDATE TO authenticated ' ||
      'USING (public.is_admin()) WITH CHECK (public.is_admin())';
    EXECUTE '' ||
      'CREATE POLICY images_delete ON public.machine_images FOR DELETE TO authenticated ' ||
      'USING (public.is_admin())';
  END IF;
END $$;

DROP POLICY IF EXISTS storage_machine_select ON storage.objects;
DROP POLICY IF EXISTS storage_machine_insert ON storage.objects;
DROP POLICY IF EXISTS storage_machine_update ON storage.objects;
DROP POLICY IF EXISTS storage_machine_delete ON storage.objects;

CREATE POLICY storage_machine_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'machine-photos');

CREATE POLICY storage_machine_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'machine-photos' AND public.is_admin());

CREATE POLICY storage_machine_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'machine-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'machine-photos' AND public.is_admin());

CREATE POLICY storage_machine_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'machine-photos' AND public.is_admin());
