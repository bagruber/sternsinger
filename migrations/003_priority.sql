-- ============================================================
-- Migration 003 — building priority flag
-- Safe to re-run; uses "if not exists".
-- ============================================================

-- Mark a building as easily-forgotten so its group sees it
-- highlighted on the map. Admin-controlled, shared across groups.
alter table building_assignments
  add column if not exists is_priority boolean not null default false;
