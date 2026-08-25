-- Wild Safari occupancy section support
-- Safe additive migration. Existing snapshots and all other hotels remain unchanged.

alter table public.yield_occupancy_snapshots
  add column if not exists section_breakdown jsonb not null default '[]'::jsonb;

comment on column public.yield_occupancy_snapshots.section_breakdown is
  'Optional per-day occupancy sections. Used for Wild Safari Main Hotel and Cottages while the parent LWS total remains combined.';
