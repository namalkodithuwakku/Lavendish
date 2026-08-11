-- Lavendish Marketing section permissions and editable workflow.
-- Run once in Supabase SQL Editor. Safe to rerun.

alter table public.occupancy_user_access
  add column if not exists marketing_section_codes text[] not null default array[]::text[];

update public.occupancy_user_access
set marketing_section_codes = case
  when role = 'MASTER_ADMIN' then array['ALL']::text[]
  when 'ALL' = any(page_codes) or 'MARKETING' = any(page_codes) then array[
    'MARKETING_OVERVIEW','MARKETING_CAMPAIGNS','MARKETING_CALENDAR',
    'MARKETING_CREATIVES','MARKETING_PLAYBOOKS'
  ]::text[]
  else array[]::text[]
end
where cardinality(marketing_section_codes) = 0;

alter table public.occupancy_user_access
  drop constraint if exists occupancy_user_access_marketing_sections_check;
alter table public.occupancy_user_access
  add constraint occupancy_user_access_marketing_sections_check check (
    marketing_section_codes = array['ALL']::text[] or
    marketing_section_codes <@ array[
      'MARKETING_OVERVIEW','MARKETING_CAMPAIGNS','MARKETING_CALENDAR',
      'MARKETING_CREATIVES','MARKETING_PLAYBOOKS','MARKETING_UPDATE_STATUS',
      'MARKETING_EDIT_PLANS'
    ]::text[]
  );

create or replace function public.can_access_marketing_section(requested_hotels text[], requested_section text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.occupancy_user_access access
    where access.user_id=auth.uid() and access.active=true
      and ('ALL'=any(access.page_codes) or 'MARKETING'=any(access.page_codes))
      and ('ALL'=any(access.hotel_codes) or requested_hotels && access.hotel_codes)
      and ('ALL'=any(access.marketing_section_codes) or requested_section=any(access.marketing_section_codes))
  );
$$;

drop policy if exists "Marketing campaign reads" on public.marketing_campaigns;
create policy "Marketing campaign reads" on public.marketing_campaigns for select to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_CAMPAIGNS') or public.can_access_marketing_section(hotel_codes,'MARKETING_OVERVIEW'));
drop policy if exists "Marketing event reads" on public.marketing_events;
create policy "Marketing event reads" on public.marketing_events for select to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_CAMPAIGNS') or public.can_access_marketing_section(hotel_codes,'MARKETING_OVERVIEW'));
drop policy if exists "Marketing content reads" on public.marketing_content;
create policy "Marketing content reads" on public.marketing_content for select to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_CALENDAR') or public.can_access_marketing_section(hotel_codes,'MARKETING_OVERVIEW'));
drop policy if exists "Marketing creative reads" on public.marketing_creatives;
create policy "Marketing creative reads" on public.marketing_creatives for select to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_CREATIVES'));
drop policy if exists "Marketing playbook reads" on public.marketing_hotel_playbooks;
create policy "Marketing playbook reads" on public.marketing_hotel_playbooks for select to authenticated
using(public.can_access_marketing_section(array[hotel_code],'MARKETING_PLAYBOOKS') or public.can_access_marketing_section(array[hotel_code],'MARKETING_OVERVIEW'));

drop policy if exists "Marketing team updates content" on public.marketing_content;
create policy "Marketing status or plan updates" on public.marketing_content for update to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_UPDATE_STATUS') or public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'))
with check(public.can_access_marketing_section(hotel_codes,'MARKETING_UPDATE_STATUS') or public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'));
drop policy if exists "Marketing team updates creatives" on public.marketing_creatives;
create policy "Marketing creative plan updates" on public.marketing_creatives for update to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'))
with check(public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'));
drop policy if exists "Marketing campaign plan updates" on public.marketing_campaigns;
create policy "Marketing campaign plan updates" on public.marketing_campaigns for update to authenticated
using(public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'))
with check(public.can_access_marketing_section(hotel_codes,'MARKETING_EDIT_PLANS'));
drop policy if exists "Marketing playbook plan updates" on public.marketing_hotel_playbooks;
create policy "Marketing playbook plan updates" on public.marketing_hotel_playbooks for update to authenticated
using(public.can_access_marketing_section(array[hotel_code],'MARKETING_EDIT_PLANS'))
with check(public.can_access_marketing_section(array[hotel_code],'MARKETING_EDIT_PLANS'));
