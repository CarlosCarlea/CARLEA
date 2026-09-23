-- CARLÉA 3.2.2: mínimo privilegio para perfil y publicaciones de creadora.
begin;

grant insert on public.content to authenticated;
grant update (caption, audience, visibility, updated_at) on public.content to authenticated;
grant delete on public.content to authenticated;

grant update (
  stage_name, bio, links, accent, chat_open, cover_path, updated_at
) on public.creators to authenticated;

-- Realtime sigue sujeto a los GRANT y a las políticas RLS de cada tabla.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='creators'
  ) then
    alter publication supabase_realtime add table public.creators;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='content'
  ) then
    alter publication supabase_realtime add table public.content;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
