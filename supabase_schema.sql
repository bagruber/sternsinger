-- ============================================================
-- Supabase Schema: Gebäude-Marker App
-- Run this in: Supabase Dashboard → SQL Editor
-- (Drops and recreates the annotations table — no data preserved.)
-- ============================================================

drop table if exists annotations;

create table annotations (
  id          uuid primary key default gen_random_uuid(),
  building_id text not null,
  group_id    text not null,
  day          int     not null check (day between 1 and 4),
  period       text    check (period in ('morning', 'afternoon')),
  color        text,
  is_attention boolean not null default false,
  is_important boolean not null default false,
  comment      text,
  updated_at  timestamp default now(),

  unique (building_id, group_id)
);

create index if not exists idx_annotations_building on annotations(building_id);
create index if not exists idx_annotations_group    on annotations(group_id);
create index if not exists idx_annotations_day      on annotations(day);

drop table if exists group_amounts;

create table group_amounts (
  id           uuid primary key default gen_random_uuid(),
  group_id     text not null,
  day          int  not null check (day between 1 and 4),
  period       text not null check (period in ('morning', 'afternoon')),
  amount_cents int  not null default 0,
  notes        text,
  updated_at   timestamp default now(),

  unique (group_id, day, period)
);

create index if not exists idx_group_amounts_group on group_amounts(group_id);

drop table if exists building_assignments;

create table building_assignments (
  building_id text primary key,
  group_id    text not null,
  is_priority boolean not null default false,
  updated_at  timestamp default now()
);

create index if not exists idx_building_assignments_group on building_assignments(group_id);

drop table if exists group_access;

create table group_access (
  group_id         text not null,
  granted_group_id text not null,
  updated_at       timestamp default now(),
  primary key (group_id, granted_group_id)
);

create index if not exists idx_group_access_group on group_access(group_id);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists annotations_updated_at on annotations;
create trigger annotations_updated_at
  before update on annotations
  for each row execute function update_updated_at();

drop trigger if exists group_amounts_updated_at on group_amounts;
create trigger group_amounts_updated_at
  before update on group_amounts
  for each row execute function update_updated_at();

drop trigger if exists building_assignments_updated_at on building_assignments;
create trigger building_assignments_updated_at
  before update on building_assignments
  for each row execute function update_updated_at();

drop trigger if exists group_access_updated_at on group_access;
create trigger group_access_updated_at
  before update on group_access
  for each row execute function update_updated_at();

-- ============================================================
-- Row Level Security — MVP: offen für anon. Vor Produktion härten.
-- ============================================================
alter table annotations  enable row level security;
alter table group_amounts enable row level security;
alter table building_assignments enable row level security;
alter table group_access enable row level security;

drop policy if exists "anon read annotations"  on annotations;
drop policy if exists "anon write annotations" on annotations;
create policy "anon read annotations"  on annotations for select using (true);
create policy "anon write annotations" on annotations for all    using (true);

drop policy if exists "anon read group_amounts"  on group_amounts;
drop policy if exists "anon write group_amounts" on group_amounts;
create policy "anon read group_amounts"  on group_amounts for select using (true);
create policy "anon write group_amounts" on group_amounts for all    using (true);

drop policy if exists "anon read building_assignments"  on building_assignments;
drop policy if exists "anon write building_assignments" on building_assignments;
create policy "anon read building_assignments"  on building_assignments for select using (true);
create policy "anon write building_assignments" on building_assignments for all    using (true);

drop policy if exists "anon read group_access"  on group_access;
drop policy if exists "anon write group_access" on group_access;
create policy "anon read group_access"  on group_access for select using (true);
create policy "anon write group_access" on group_access for all    using (true);
