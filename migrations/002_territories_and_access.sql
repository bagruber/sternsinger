-- ============================================================
-- Migration 002 — Territories & cross-group access
-- Safe to re-run; uses "if not exists". Preserves existing data.
-- Run in: Supabase Dashboard → SQL Editor.
-- ============================================================

-- Territory assignment: which group owns which building.
create table if not exists building_assignments (
  building_id text primary key,
  group_id    text not null,
  updated_at  timestamp default now()
);
create index if not exists idx_building_assignments_group on building_assignments(group_id);

-- Cross-group access: which additional territories a group may paint.
-- (group_id) is granted access to (granted_group_id)'s buildings.
create table if not exists group_access (
  group_id         text not null,
  granted_group_id text not null,
  updated_at       timestamp default now(),
  primary key (group_id, granted_group_id)
);
create index if not exists idx_group_access_group on group_access(group_id);

-- Shared updated_at trigger (no-op if already defined by 001).
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists building_assignments_updated_at on building_assignments;
create trigger building_assignments_updated_at
  before update on building_assignments
  for each row execute function update_updated_at();

drop trigger if exists group_access_updated_at on group_access;
create trigger group_access_updated_at
  before update on group_access
  for each row execute function update_updated_at();

-- RLS — MVP: open for anon, same as existing tables.
alter table building_assignments enable row level security;
alter table group_access         enable row level security;

drop policy if exists "anon read building_assignments"  on building_assignments;
drop policy if exists "anon write building_assignments" on building_assignments;
create policy "anon read building_assignments"  on building_assignments for select using (true);
create policy "anon write building_assignments" on building_assignments for all    using (true);

drop policy if exists "anon read group_access"  on group_access;
drop policy if exists "anon write group_access" on group_access;
create policy "anon read group_access"  on group_access for select using (true);
create policy "anon write group_access" on group_access for all    using (true);
