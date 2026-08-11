-- NKH Performance Hub - Lavendish Marketing Command Centre
-- Run once after page_access.sql. Safe to rerun.

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null unique,
  name text not null,
  objective text,
  hotel_codes text[] not null,
  hotel_label text,
  booking_start date,
  booking_end date,
  stay_start date,
  stay_end date,
  campaign_type text,
  direct_offer text,
  direct_discount numeric(6,4) not null default 0,
  ota_rule text,
  fb_offer text,
  value_add text,
  revenue_guardrail text,
  booking_channels text,
  primary_kpis text,
  status text not null default 'PLANNED',
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  start_date date not null,
  end_date date,
  month_label text,
  name text not null,
  confidence text,
  category text,
  primary_market text,
  demand text,
  lead_days integer not null default 0,
  campaign_launch date,
  hotel_codes text[] not null,
  hotel_label text,
  recommended_product text,
  creative_angle text,
  operations_action text,
  channels text,
  primary_kpi text,
  source_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_content (
  id uuid primary key default gen_random_uuid(),
  content_id text not null unique,
  post_date date not null,
  month_label text,
  page_name text,
  hotel_codes text[] not null,
  hotel_label text,
  pillar text,
  subject text not null,
  campaign_linked boolean not null default false,
  campaign_name text,
  format text,
  design_id text,
  collaboration text,
  cta text,
  channels text,
  design_status text not null default 'NOT_STARTED',
  approval_status text not null default 'PENDING',
  publish_status text not null default 'PLANNED',
  notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_creatives (
  id uuid primary key default gen_random_uuid(),
  design_id text not null unique,
  post_date date,
  page_name text,
  hotel_codes text[] not null,
  hotel_label text,
  pillar text,
  subject text,
  campaign_name text,
  headline text,
  subheadline text,
  asset_format text,
  presentation_rule text,
  design_prompt text,
  caption text,
  hashtags text,
  cta text,
  status text not null default 'NOT_STARTED',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_hotel_playbooks (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null unique references public.occupancy_profiles(hotel_code) on update cascade,
  hotel_name text not null,
  best_segments text,
  strongest_periods text,
  core_story text,
  lead_events text,
  cautions text,
  best_channels text,
  campaign_role text,
  promotion_ideas text,
  photography_priority text,
  website_cta text,
  status text not null default 'ACTIVE',
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_activity_history (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_key text not null,
  event_type text not null,
  previous_value jsonb,
  next_value jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaign_window_idx on public.marketing_campaigns(booking_start,booking_end);
create index if not exists marketing_event_date_idx on public.marketing_events(start_date);
create index if not exists marketing_content_date_idx on public.marketing_content(post_date);
create index if not exists marketing_content_status_idx on public.marketing_content(publish_status,approval_status,design_status);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_events enable row level security;
alter table public.marketing_content enable row level security;
alter table public.marketing_creatives enable row level security;
alter table public.marketing_hotel_playbooks enable row level security;
alter table public.marketing_activity_history enable row level security;

create or replace function public.can_access_marketing(requested_hotels text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.occupancy_user_access access
    where access.user_id=auth.uid() and access.active=true
      and ('ALL'=any(access.page_codes) or 'MARKETING'=any(access.page_codes))
      and ('ALL'=any(access.hotel_codes) or requested_hotels && access.hotel_codes)
  );
$$;

drop policy if exists "Marketing campaign reads" on public.marketing_campaigns;
create policy "Marketing campaign reads" on public.marketing_campaigns for select to authenticated using(public.can_access_marketing(hotel_codes));
drop policy if exists "Marketing event reads" on public.marketing_events;
create policy "Marketing event reads" on public.marketing_events for select to authenticated using(public.can_access_marketing(hotel_codes));
drop policy if exists "Marketing content reads" on public.marketing_content;
create policy "Marketing content reads" on public.marketing_content for select to authenticated using(public.can_access_marketing(hotel_codes));
drop policy if exists "Marketing creative reads" on public.marketing_creatives;
create policy "Marketing creative reads" on public.marketing_creatives for select to authenticated using(public.can_access_marketing(hotel_codes));
drop policy if exists "Marketing playbook reads" on public.marketing_hotel_playbooks;
create policy "Marketing playbook reads" on public.marketing_hotel_playbooks for select to authenticated using(public.can_access_marketing(array[hotel_code]));

drop policy if exists "Marketing team updates content" on public.marketing_content;
create policy "Marketing team updates content" on public.marketing_content for update to authenticated
using(public.can_access_marketing(hotel_codes)) with check(public.can_access_marketing(hotel_codes));
drop policy if exists "Marketing team updates creatives" on public.marketing_creatives;
create policy "Marketing team updates creatives" on public.marketing_creatives for update to authenticated
using(public.can_access_marketing(hotel_codes)) with check(public.can_access_marketing(hotel_codes));

drop policy if exists "Master manages marketing campaigns" on public.marketing_campaigns;
create policy "Master manages marketing campaigns" on public.marketing_campaigns for all to authenticated using(public.is_occupancy_admin()) with check(public.is_occupancy_admin());
drop policy if exists "Master manages marketing events" on public.marketing_events;
create policy "Master manages marketing events" on public.marketing_events for all to authenticated using(public.is_occupancy_admin()) with check(public.is_occupancy_admin());
drop policy if exists "Master manages marketing content" on public.marketing_content;
create policy "Master manages marketing content" on public.marketing_content for all to authenticated using(public.is_occupancy_admin()) with check(public.is_occupancy_admin());
drop policy if exists "Master manages marketing creatives" on public.marketing_creatives;
create policy "Master manages marketing creatives" on public.marketing_creatives for all to authenticated using(public.is_occupancy_admin()) with check(public.is_occupancy_admin());
drop policy if exists "Master manages marketing playbooks" on public.marketing_hotel_playbooks;
create policy "Master manages marketing playbooks" on public.marketing_hotel_playbooks for all to authenticated using(public.is_occupancy_admin()) with check(public.is_occupancy_admin());
drop policy if exists "Own marketing activity reads" on public.marketing_activity_history;
create policy "Own marketing activity reads" on public.marketing_activity_history for select to authenticated using(actor_id=auth.uid() or public.is_occupancy_admin());
drop policy if exists "Marketing activity inserts" on public.marketing_activity_history;
create policy "Marketing activity inserts" on public.marketing_activity_history for insert to authenticated with check(actor_id=auth.uid());
