begin;
create table if not exists public.orbit_ntd_libraries (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, version)
);
alter table public.orbit_ntd_libraries enable row level security;
revoke all on public.orbit_ntd_libraries from anon, authenticated;
grant select, insert on public.orbit_ntd_libraries to authenticated;
create policy "ntd_read_own" on public.orbit_ntd_libraries for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "ntd_insert_own" on public.orbit_ntd_libraries for insert to authenticated
  with check ((select auth.uid()) = owner_id);
commit;
