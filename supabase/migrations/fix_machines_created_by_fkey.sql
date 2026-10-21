/*
 Corrige o erro ao salvar máquina:
   insert or update on table "machines" violates foreign key constraint
   "machines_created_by_fkey"

 Contexto do bug:
 - machines.created_by foi criada com FK para public.profiles(id) e DEFAULT auth.uid()
 - public.profiles é a tabela LEGADA de perfis e não recebe mais registros novos:
   usuários criados hoje (trigger handle_new_user / RPC admin_create_user / convite)
   existem apenas em public.usuarios_perfil
 - Resultado: qualquer usuário sem linha em profiles falhava o INSERT, porque o
   DEFAULT auth.uid() não satisfazia a FK.

 Correção:
 - a FK passa a apontar para public.usuarios_perfil(id), a tabela canônica de perfis
   do projeto, preservando o DEFAULT auth.uid() e o ON DELETE SET NULL.
*/

-- 1) Garante que todo usuário do Auth tenha linha em usuarios_perfil
--    (evita que a nova FK falhe por perfil ausente)
INSERT INTO public.usuarios_perfil (id, nome, papel, criado_em)
SELECT
  u.id,
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
    SPLIT_PART(u.email, '@', 1),
    'Sem nome'
  ),
  CASE
    WHEN lower(COALESCE(u.raw_user_meta_data->>'papel', '')) IN ('admin', 'administrador') THEN 'admin'
    ELSE 'vendedor'
  END,
  COALESCE(u.created_at::timestamptz, now())
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.usuarios_perfil up WHERE up.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2) Remove a FK antiga (apontava para public.profiles)
ALTER TABLE public.machines DROP CONSTRAINT IF EXISTS machines_created_by_fkey;

-- 3) Zera created_by órfãos (evita falha ao recriar a constraint)
UPDATE public.machines m
SET created_by = NULL
WHERE m.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.usuarios_perfil up WHERE up.id = m.created_by);

-- 4) Recria a FK apontando para a tabela canônica de perfis
ALTER TABLE public.machines
  ADD CONSTRAINT machines_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.usuarios_perfil(id) ON DELETE SET NULL;

-- 5) Mantém o DEFAULT auth.uid() explícito
ALTER TABLE public.machines ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 6) Revalida o cache de schema do PostgREST (evita "schema cache" desatualizado)
NOTIFY pgrst, 'reload schema';
