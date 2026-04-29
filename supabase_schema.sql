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

-- ============================================================
-- Row Level Security — MVP: offen für anon. Vor Produktion härten.
-- ============================================================
alter table annotations  enable row level security;
alter table group_amounts enable row level security;

drop policy if exists "anon read annotations"  on annotations;
drop policy if exists "anon write annotations" on annotations;
create policy "anon read annotations"  on annotations for select using (true);
create policy "anon write annotations" on annotations for all    using (true);

drop policy if exists "anon read group_amounts"  on group_amounts;
drop policy if exists "anon write group_amounts" on group_amounts;
create policy "anon read group_amounts"  on group_amounts for select using (true);
create policy "anon write group_amounts" on group_amounts for all    using (true);
