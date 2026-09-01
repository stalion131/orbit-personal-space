create table if not exists public.orbit_catalogs (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.orbit_catalogs enable row level security;
revoke all on table public.orbit_catalogs from anon, authenticated;
grant select, insert, update on table public.orbit_catalogs to authenticated;

create policy "orbit_catalogs_select_own" on public.orbit_catalogs for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "orbit_catalogs_insert_own" on public.orbit_catalogs for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "orbit_catalogs_update_own" on public.orbit_catalogs for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

grant delete on table public.orbit_tasks to authenticated;
create policy "orbit_tasks_delete_own" on public.orbit_tasks for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
