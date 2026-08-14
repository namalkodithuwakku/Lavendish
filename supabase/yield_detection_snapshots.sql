-- Dedicated comparison baseline for Yield and OTA change detection.
-- Run once before deploying the matching application update.
--
-- The dashboard cache intentionally remains in yield_occupancy_snapshots.
-- Keeping this baseline separate prevents normal calendar refreshes from
-- erasing the previous value before the monitoring engine compares it.

create table if not exists public.yield_detection_snapshots (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null references public.occupancy_profiles(hotel_code)
    on update cascade on delete cascade,
  stay_date date not null,
  total_rooms integer not null check (total_rooms > 0),
  rooms_sold integer not null check (rooms_sold >= 0),
  available_rooms integer not null,
  occupancy_percent numeric(6,2) not null,
  threshold_level integer,
  suggested_rates jsonb not null default '[]'::jsonb,
  source_updated_at text,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(hotel_code, stay_date)
);

alter table public.yield_detection_snapshots enable row level security;

create index if not exists yield_detection_stay_date_idx
  on public.yield_detection_snapshots(stay_date);

create index if not exists yield_detection_checked_idx
  on public.yield_detection_snapshots(last_checked_at desc);

-- Seed the private baseline from the current dashboard cache. This avoids a
-- flood of false alerts on the first monitoring run after deployment.
insert into public.yield_detection_snapshots (
  hotel_code,
  stay_date,
  total_rooms,
  rooms_sold,
  available_rooms,
  occupancy_percent,
  threshold_level,
  suggested_rates,
  source_updated_at,
  last_checked_at
)
select
  hotel_code,
  stay_date,
  total_rooms,
  rooms_sold,
  available_rooms,
  occupancy_percent,
  threshold_level,
  coalesce(suggested_rates, '[]'::jsonb),
  source_updated_at,
  last_checked_at
from public.yield_occupancy_snapshots
on conflict (hotel_code, stay_date) do nothing;

