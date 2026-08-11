-- Run once in the Supabase SQL Editor before deploying the page-access update.
alter table public.occupancy_user_access
  add column if not exists page_codes text[] not null
  default array['HOTEL_OCCUPANCY']::text[];

-- Existing Master Admins retain full access. Existing full-portfolio users keep
-- both occupancy pages; other existing users keep their hotel dashboard.
update public.occupancy_user_access
set page_codes = case
  when role = 'MASTER_ADMIN' then array['ALL']::text[]
  when 'ALL' = any(hotel_codes) then array['HOTEL_OCCUPANCY','GROUP_OCCUPANCY']::text[]
  else array['HOTEL_OCCUPANCY']::text[]
end
where page_codes = array['HOTEL_OCCUPANCY']::text[];

alter table public.occupancy_user_access
  drop constraint if exists occupancy_user_access_page_codes_check;
alter table public.occupancy_user_access
  add constraint occupancy_user_access_page_codes_check check (
    cardinality(page_codes) > 0 and
    (page_codes = array['ALL']::text[] or page_codes <@ array[
      'HOTEL_OCCUPANCY','GROUP_OCCUPANCY','OTA_ALERTS','YIELD_ALERTS',
      'MARKETING','PROPERTIES','REPUTATION','REPORTS','SETTINGS'
    ]::text[])
  );

-- Page permission and hotel permission must both match before alert data is read.
drop policy if exists "Master Admin can view yield alerts" on public.yield_alerts;
drop policy if exists "Authorized yield alert reads" on public.yield_alerts;
create policy "Page-authorized yield alert reads"
  on public.yield_alerts for select to authenticated
  using (exists (
    select 1 from public.occupancy_user_access access
    where access.user_id=auth.uid() and access.active=true
      and ('ALL'=any(access.hotel_codes) or yield_alerts.hotel_code=any(access.hotel_codes))
      and (
        'ALL'=any(access.page_codes)
        or (yield_alerts.alert_type='RATE_UPDATE' and 'YIELD_ALERTS'=any(access.page_codes))
        or (yield_alerts.alert_type<>'RATE_UPDATE' and 'OTA_ALERTS'=any(access.page_codes))
      )
  ));
