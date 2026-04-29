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
  day         int  not null check (day between 1 and 4),
  color       text,
  tag         text check (tag in ('attention', 'important')),
  comment     text,
  updated_at  timestamp default now(),

  unique (building_id, group_id)
);

create index if not exists idx_annotations_building on annotations(building_id);
create index if not exists idx_annotations_group    on annotations(group_id);
create index if not exists idx_annotations_day      on annotations(day);

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

-- ============================================================
-- Row Level Security — MVP: offen für anon. Vor Produktion härten.
-- ============================================================
alter table annotations enable row level security;

drop policy if exists "anon read annotations"  on annotations;
drop policy if exists "anon write annotations" on annotations;
create policy "anon read annotations"  on annotations for select using (true);
create policy "anon write annotations" on annotations for all    using (true);
