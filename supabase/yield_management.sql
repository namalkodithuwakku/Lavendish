-- Lavendish Yield Management
-- Run once in Supabase SQL Editor after supabase/schema.sql.
-- Rates and notification rules are data, never application constants.

create extension if not exists pgcrypto;

create table if not exists public.yield_rate_plans (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null references public.occupancy_profiles(hotel_code) on update cascade on delete cascade,
  plan_code text not null,
  plan_name text not null,
  currency text not null default 'USD',
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  review_note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(hotel_code, plan_code, effective_from)
);

create table if not exists public.yield_rate_bands (
  id uuid primary key default gen_random_uuid(),
  rate_plan_id uuid not null references public.yield_rate_plans(id) on delete cascade,
  sold_from integer not null check (sold_from >= 0),
  sold_to integer not null check (sold_to >= sold_from),
  rate numeric(12,2) not null check (rate >= 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rate_plan_id, sold_from, sold_to)
);

create table if not exists public.yield_settings (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null unique references public.occupancy_profiles(hotel_code) on update cascade on delete cascade,
  alert_thresholds integer[] not null default array[75,90,100],
  enabled_rate_durations text[] not null default array['1_DAY','3_DAYS','7_DAYS','1_MONTH','3_MONTHS','6_MONTHS'],
  default_rate_duration text not null default '3_DAYS',
  closure_action text not null default 'CREATE_TASK' check (closure_action in ('NOTIFY','RECOMMEND','CREATE_TASK')),
  threshold_75_action text not null default 'NOTIFY' check (threshold_75_action in ('OFF','NOTIFY','RECOMMEND','CREATE_TASK')),
  threshold_90_action text not null default 'RECOMMEND' check (threshold_90_action in ('OFF','NOTIFY','RECOMMEND','CREATE_TASK')),
  threshold_100_action text not null default 'CREATE_TASK' check (threshold_100_action in ('OFF','NOTIFY','RECOMMEND','CREATE_TASK')),
  future_check_days integer not null default 180 check (future_check_days between 1 and 366),
  active boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (
    cardinality(alert_thresholds) = 3
    and alert_thresholds[1] between 1 and 100
    and alert_thresholds[2] between 1 and 100
    and alert_thresholds[3] between 1 and 100
    and alert_thresholds[1] < alert_thresholds[2]
    and alert_thresholds[2] < alert_thresholds[3]
  )
);

create table if not exists public.yield_alerts (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null references public.occupancy_profiles(hotel_code) on update cascade on delete cascade,
  stay_date date not null,
  alert_type text not null check (alert_type in ('OCCUPANCY','RATE_UPDATE','OTA_CLOSURE','OTA_REOPEN')),
  threshold integer,
  total_rooms integer not null,
  rooms_sold integer not null,
  available_rooms integer not null,
  occupancy_percent numeric(6,2) not null,
  recommended_rate numeric(12,2),
  currency text,
  rate_plan_code text,
  action text not null default 'NOTIFY',
  status text not null default 'PENDING' check (status in ('PENDING','STARTED','COMPLETED','DISMISSED','WITHDRAWN')),
  task_external_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists yield_alert_no_duplicates
  on public.yield_alerts(hotel_code, stay_date, alert_type, coalesce(threshold,-1), coalesce(rate_plan_code,''))
  where status in ('PENDING','STARTED');

alter table public.yield_rate_plans enable row level security;
alter table public.yield_rate_bands enable row level security;
alter table public.yield_settings enable row level security;
alter table public.yield_alerts enable row level security;

drop policy if exists "Authorized yield plan reads" on public.yield_rate_plans;
create policy "Authorized yield plan reads" on public.yield_rate_plans for select to authenticated
using (exists(select 1 from public.occupancy_user_access ua where ua.user_id=auth.uid() and ua.active=true and ('ALL'=any(ua.hotel_codes) or yield_rate_plans.hotel_code=any(ua.hotel_codes))));
drop policy if exists "Master yield plan management" on public.yield_rate_plans;
create policy "Master yield plan management" on public.yield_rate_plans for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());

drop policy if exists "Authorized yield band reads" on public.yield_rate_bands;
create policy "Authorized yield band reads" on public.yield_rate_bands for select to authenticated
using (exists(select 1 from public.yield_rate_plans p join public.occupancy_user_access ua on ua.user_id=auth.uid() where p.id=yield_rate_bands.rate_plan_id and ua.active=true and ('ALL'=any(ua.hotel_codes) or p.hotel_code=any(ua.hotel_codes))));
drop policy if exists "Master yield band management" on public.yield_rate_bands;
create policy "Master yield band management" on public.yield_rate_bands for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());

drop policy if exists "Authorized yield setting reads" on public.yield_settings;
create policy "Authorized yield setting reads" on public.yield_settings for select to authenticated
using (exists(select 1 from public.occupancy_user_access ua where ua.user_id=auth.uid() and ua.active=true and ('ALL'=any(ua.hotel_codes) or yield_settings.hotel_code=any(ua.hotel_codes))));
drop policy if exists "Master yield setting management" on public.yield_settings;
create policy "Master yield setting management" on public.yield_settings for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());

drop policy if exists "Authorized yield alert reads" on public.yield_alerts;
create policy "Authorized yield alert reads" on public.yield_alerts for select to authenticated
using (exists(select 1 from public.occupancy_user_access ua where ua.user_id=auth.uid() and ua.active=true and ('ALL'=any(ua.hotel_codes) or yield_alerts.hotel_code=any(ua.hotel_codes))));
drop policy if exists "Master yield alert management" on public.yield_alerts;
create policy "Master yield alert management" on public.yield_alerts for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());

-- Editable defaults transcribed from the supplied OTA-BB sheet.
insert into public.yield_rate_plans(hotel_code,plan_code,plan_name,currency,effective_from,review_note)
values
('MLR','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01',null),
('GTL','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Original printed bands overlap at 16 and 20; boundaries were normalised without changing rates.'),
('LOH','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Printed code OKR. Original band overlaps at 11; boundary was normalised.'),
('LWS','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01',null),
('LWS','OTA_BB_C','OTA Bed & Breakfast - C','USD','2026-08-01','Band boundaries inferred from the adjacent 17-room structure; Master should confirm.'),
('LWW','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01',null),
('LCR','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Printed sheet shows USD 25 for every band, stored as one complete range.'),
('TLK','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Printed code LTL.'),
('LBU','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Printed code LBR.'),
('LHK','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01','Printed range ends at 46 while current profile capacity is 43; Master should confirm capacity.'),
('LLG','OTA_BB','OTA Bed & Breakfast','USD','2026-08-01',null)
on conflict(hotel_code,plan_code,effective_from) do nothing;

with plans as (select id,hotel_code,plan_code from public.yield_rate_plans where effective_from='2026-08-01')
insert into public.yield_rate_bands(rate_plan_id,sold_from,sold_to,rate,display_order)
select p.id,v.sold_from,v.sold_to,v.rate,v.ord
from plans p
join (values
('MLR','OTA_BB',0,10,50,1),('MLR','OTA_BB',11,20,53,2),('MLR','OTA_BB',21,30,59,3),('MLR','OTA_BB',31,38,65,4),
('GTL','OTA_BB',0,12,55,1),('GTL','OTA_BB',13,16,68,2),('GTL','OTA_BB',17,20,75,3),('GTL','OTA_BB',21,25,83,4),
('LOH','OTA_BB',0,6,40,1),('LOH','OTA_BB',7,11,47,2),('LOH','OTA_BB',12,15,47,3),('LOH','OTA_BB',16,17,47,4),
('LWS','OTA_BB',0,12,35,1),('LWS','OTA_BB',13,16,40,2),('LWS','OTA_BB',17,24,42,3),('LWS','OTA_BB',25,27,45,4),
('LWS','OTA_BB_C',0,6,30,1),('LWS','OTA_BB_C',7,11,30,2),('LWS','OTA_BB_C',12,15,30,3),('LWS','OTA_BB_C',16,17,35,4),
('LWW','OTA_BB',0,4,30,1),('LWW','OTA_BB',5,8,32,2),('LWW','OTA_BB',9,10,32,3),('LWW','OTA_BB',11,12,32,4),
('LCR','OTA_BB',0,18,25,1),
('TLK','OTA_BB',0,5,40,1),('TLK','OTA_BB',6,10,47,2),('TLK','OTA_BB',11,14,50,3),('TLK','OTA_BB',15,17,50,4),
('LBU','OTA_BB',0,20,45,1),('LBU','OTA_BB',21,30,52,2),('LBU','OTA_BB',31,35,57,3),('LBU','OTA_BB',36,40,63,4),
('LHK','OTA_BB',0,20,45,1),('LHK','OTA_BB',21,30,55,2),('LHK','OTA_BB',31,37,60,3),('LHK','OTA_BB',38,46,66,4),
('LLG','OTA_BB',0,20,50,1),('LLG','OTA_BB',21,30,55,2),('LLG','OTA_BB',31,37,60,3),('LLG','OTA_BB',38,46,68,4)
) as v(hotel_code,plan_code,sold_from,sold_to,rate,ord)
on p.hotel_code=v.hotel_code and p.plan_code=v.plan_code
on conflict do nothing;

insert into public.yield_settings(hotel_code)
select hotel_code from public.occupancy_profiles
on conflict(hotel_code) do nothing;
