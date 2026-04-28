-- ============================================================
-- Supabase Schema: Gebäude-Marker App
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Groups table
create table if not exists groups (
  id   text primary key,
  name text,
  email text unique
);

-- 2. Annotations table
create table if not exists annotations (
  id          uuid primary key default gen_random_uuid(),
  building_id text not null,
  group_id    text references groups(id) on delete cascade,
  color       text,
  comment     text,
  updated_at  timestamp default now(),

  -- Each group can only annotate each building once
  unique (building_id, group_id)
);

-- 3. Indexes
create index if not exists idx_annotations_building on annotations(building_id);
create index if not exists idx_annotations_group    on annotations(group_id);

-- 4. Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger annotations_updated_at
  before update on annotations
  for each row execute function update_updated_at();

-- ============================================================
-- Row Level Security (RLS) — recommended for production
-- ============================================================
-- Enable RLS
alter table annotations enable row level security;
alter table groups       enable row level security;

-- For MVP: allow all anon reads and writes (replace with proper auth later)
create policy "anon read annotations"  on annotations for select using (true);
create policy "anon write annotations" on annotations for all    using (true);
create policy "anon read groups"       on groups       for select using (true);
create policy "anon write groups"      on groups       for all    using (true);
