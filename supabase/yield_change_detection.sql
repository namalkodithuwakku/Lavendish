-- Lavendish Yield Change Detection
-- Run after supabase/yield_management.sql.

create table if not exists public.yield_occupancy_snapshots (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null references public.occupancy_profiles(hotel_code) on update cascade on delete cascade,
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

alter table public.yield_occupancy_snapshots enable row level security;

drop policy if exists "Authorized yield snapshot reads" on public.yield_occupancy_snapshots;
create policy "Authorized yield snapshot reads"
on public.yield_occupancy_snapshots for select to authenticated
using (
  exists (
    select 1
    from public.occupancy_user_access ua
    where ua.user_id = auth.uid()
      and ua.active = true
      and ('ALL' = any(ua.hotel_codes) or yield_occupancy_snapshots.hotel_code = any(ua.hotel_codes))
  )
);

drop policy if exists "Master yield snapshot management" on public.yield_occupancy_snapshots;
create policy "Master yield snapshot management"
on public.yield_occupancy_snapshots for all to authenticated
using (public.is_occupancy_admin())
with check (public.is_occupancy_admin());

create index if not exists yield_snapshot_stay_date_idx
  on public.yield_occupancy_snapshots(stay_date);

create index if not exists yield_alert_created_at_idx
  on public.yield_alerts(created_at desc);

-- Alert payload contains the full previous/current comparison and every
-- suggested active rate. These columns make the key change visible quickly.
alter table public.yield_alerts
  add column if not exists previous_rooms_sold integer,
  add column if not exists rooms_change integer,
  add column if not exists previous_available_rooms integer,
  add column if not exists previous_occupancy_percent numeric(6,2),
  add column if not exists suggested_rates jsonb not null default '[]'::jsonb;
