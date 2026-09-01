create table if not exists public.orbit_tasks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now()
);

create index if not exists orbit_tasks_owner_updated_idx
  on public.orbit_tasks (owner_id, updated_at desc);

alter table public.orbit_tasks enable row level security;

revoke all on table public.orbit_tasks from anon, authenticated;
grant select, insert, update on table public.orbit_tasks to authenticated;

drop policy if exists "orbit_tasks_select_own" on public.orbit_tasks;
create policy "orbit_tasks_select_own"
  on public.orbit_tasks for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "orbit_tasks_insert_own" on public.orbit_tasks;
create policy "orbit_tasks_insert_own"
  on public.orbit_tasks for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "orbit_tasks_update_own" on public.orbit_tasks;
create policy "orbit_tasks_update_own"
  on public.orbit_tasks for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
