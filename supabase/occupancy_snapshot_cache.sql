-- Lavendish fast occupancy cache
-- Safe additive migration. Google Sheets remain read-only and authoritative.
-- Run once after schema.sql. It can be rerun safely.

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

alter table public.yield_occupancy_snapshots
  add column if not exists source_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists functions integer not null default 0,
  add column if not exists allotment integer not null default 0;

alter table public.yield_occupancy_snapshots enable row level security;

drop policy if exists "Authorized yield snapshot reads" on public.yield_occupancy_snapshots;
drop policy if exists "Authorized occupancy snapshot reads" on public.yield_occupancy_snapshots;
create policy "Authorized occupancy snapshot reads"
on public.yield_occupancy_snapshots for select to authenticated
using (
  exists (
    select 1
    from public.occupancy_user_access access
    where access.user_id = auth.uid()
      and access.active = true
      and (
        'ALL' = any(access.hotel_codes)
        or yield_occupancy_snapshots.hotel_code = any(access.hotel_codes)
      )
  )
);

drop policy if exists "Master yield snapshot management" on public.yield_occupancy_snapshots;
drop policy if exists "Master occupancy snapshot management" on public.yield_occupancy_snapshots;
create policy "Master occupancy snapshot management"
on public.yield_occupancy_snapshots for all to authenticated
using (public.is_occupancy_admin())
with check (public.is_occupancy_admin());

create index if not exists occupancy_snapshot_hotel_date_idx
  on public.yield_occupancy_snapshots(hotel_code, stay_date);

create index if not exists occupancy_snapshot_checked_idx
  on public.yield_occupancy_snapshots(last_checked_at desc);

-- Short server-side locks stop several users from launching the same Sheet
-- read at the same time. Expired locks recover automatically.
create table if not exists public.occupancy_sync_locks (
  hotel_code text not null references public.occupancy_profiles(hotel_code) on update cascade on delete cascade,
  month_start date not null,
  locked_until timestamptz not null,
  primary key(hotel_code, month_start)
);

alter table public.occupancy_sync_locks enable row level security;

create or replace function public.claim_occupancy_sync(
  requested_hotel text,
  requested_month date,
  lock_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.occupancy_sync_locks(hotel_code, month_start, locked_until)
  values (
    requested_hotel,
    requested_month,
    now() + make_interval(secs => greatest(30, least(lock_seconds, 180)))
  )
  on conflict(hotel_code, month_start) do update
    set locked_until = excluded.locked_until
    where public.occupancy_sync_locks.locked_until < now();

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.claim_occupancy_sync(text,date,integer) from public;
grant execute on function public.claim_occupancy_sync(text,date,integer) to service_role;
