-- N K Hotels Occupancy Intelligence - additive foundation
-- Existing occupancy_profiles, occupancy_user_access, occupancy snapshots and
-- the current Hotel/Group Occupancy pages are intentionally left unchanged.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legacy_hotel_code text,
  name text not null,
  location text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, legacy_hotel_code)
);

create table if not exists public.property_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  profile_data jsonb not null default '{}'::jsonb,
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  verification_status text not null default 'DRAFT' check (verification_status in ('DRAFT','AI_REVIEW','NEEDS_REVIEW','APPROVED')),
  marketing_readiness text not null default 'NOT_READY' check (marketing_readiness in ('NOT_READY','PARTIAL','READY')),
  locked_fields text[] not null default '{}'::text[],
  last_ai_scan_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_profile_sources (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source_type text not null check (source_type in ('WEBSITE','GOOGLE','FACEBOOK','INSTAGRAM','OTA','TRIPADVISOR','DOCUMENT','OTHER')),
  label text,
  source_url text,
  storage_path text,
  scan_status text not null default 'PENDING' check (scan_status in ('PENDING','SCANNING','READY','FAILED','DISABLED')),
  confidence numeric(5,2),
  extracted_data jsonb not null default '{}'::jsonb,
  last_scanned_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is not null or storage_path is not null)
);

create table if not exists public.property_profile_facts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source_id uuid references public.property_profile_sources(id) on delete set null,
  field_key text not null,
  field_value jsonb not null,
  confidence numeric(5,2),
  fact_status text not null default 'AI_SUGGESTED' check (fact_status in ('AI_SUGGESTED','NEEDS_REVIEW','MASTER_APPROVED','MASTER_EDITED','REJECTED')),
  locked boolean not null default false,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, field_key, source_id)
);

create table if not exists public.intelligence_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  category text not null check (category in ('OTA','YIELD','MARKETING','REPUTATION')),
  priority text not null check (priority in ('CRITICAL','HIGH','MEDIUM','INFORMATIONAL')),
  affected_from date,
  affected_to date,
  finding text not null,
  reason text not null,
  primary_action text not null,
  supporting_actions jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'DETECTED' check (status in ('DETECTED','AI_PREPARED','AWAITING_REVIEW','APPROVED','ASSIGNED','IN_PROGRESS','COMPLETED','MONITORING','RESOLVED','DISMISSED','EXPIRED')),
  dedupe_key text,
  owner_id uuid references auth.users(id),
  due_at timestamptz,
  review_at timestamptz,
  created_by_type text not null default 'SYSTEM' check (created_by_type in ('SYSTEM','AI','USER')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists active_intelligence_action_dedupe_idx
  on public.intelligence_actions(organization_id, dedupe_key)
  where dedupe_key is not null and status not in ('RESOLVED','DISMISSED','EXPIRED');

create table if not exists public.ai_generated_materials (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.intelligence_actions(id) on delete cascade,
  material_type text not null,
  title text,
  content jsonb not null,
  model_name text,
  prompt_version text,
  status text not null default 'DRAFT' check (status in ('DRAFT','NEEDS_REVIEW','APPROVED','REJECTED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.management_action_history (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.intelligence_actions(id) on delete cascade,
  event_type text not null,
  previous_value jsonb,
  next_value jsonb,
  note text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.intelligence_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module text not null check (module in ('PROFILE','MARKETING','REPUTATION')),
  enabled boolean not null default true,
  cadence text not null check (cadence in ('EVERY_6_HOURS','DAILY','WEEKLY','MONTHLY','MANUAL')),
  run_time time,
  timezone text not null default 'Asia/Colombo',
  next_run_at timestamptz,
  last_run_at timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module)
);

create table if not exists public.intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.intelligence_schedules(id) on delete set null,
  module text not null,
  run_type text not null check (run_type in ('SCHEDULED','MANUAL')),
  status text not null check (status in ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED')),
  started_at timestamptz,
  completed_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  error_message text,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.user_module_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (module in ('OVERVIEW','OTA','YIELD','MARKETING','PROPERTIES','REPUTATION','REPORTS','SETTINGS')),
  can_view boolean not null default false,
  can_manage boolean not null default false,
  can_approve boolean not null default false,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module)
);

alter table public.organizations enable row level security;
alter table public.properties enable row level security;
alter table public.property_profiles enable row level security;
alter table public.property_profile_sources enable row level security;
alter table public.property_profile_facts enable row level security;
alter table public.intelligence_actions enable row level security;
alter table public.ai_generated_materials enable row level security;
alter table public.management_action_history enable row level security;
alter table public.intelligence_schedules enable row level security;
alter table public.intelligence_runs enable row level security;
alter table public.user_module_permissions enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations','properties','property_profiles','property_profile_sources',
    'property_profile_facts','intelligence_actions','ai_generated_materials',
    'management_action_history','intelligence_schedules','intelligence_runs',
    'user_module_permissions'
  ] loop
    execute format('drop policy if exists "Master manages %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Master manages %s" on public.%I for all to authenticated using (public.is_occupancy_admin()) with check (public.is_occupancy_admin())',
      table_name, table_name
    );
  end loop;
end $$;

insert into public.organizations(name,slug)
values ('Lavendish Leisure','lavendish-leisure')
on conflict(slug) do update set name=excluded.name,updated_at=now();

insert into public.properties(organization_id,legacy_hotel_code,name,location,status)
select organization.id,profile.hotel_code,profile.hotel_name,profile.location,
  case when profile.status='Active' then 'ACTIVE' else 'INACTIVE' end
from public.occupancy_profiles profile
cross join public.organizations organization
where organization.slug='lavendish-leisure'
on conflict(organization_id,legacy_hotel_code) do update
set name=excluded.name,location=excluded.location,status=excluded.status,updated_at=now();

insert into public.property_profiles(property_id,profile_data)
select property.id,jsonb_build_object(
  'identity',jsonb_build_object('name',property.name,'location',property.location,'hotelCode',property.legacy_hotel_code),
  'hotelInformation',jsonb_build_object(),
  'rooms','[]'::jsonb,
  'facilities','[]'::jsonb,
  'brandKit',jsonb_build_object(),
  'contacts',jsonb_build_object(),
  'marketingProfile',jsonb_build_object()
)
from public.properties property
join public.organizations organization on organization.id=property.organization_id
where organization.slug='lavendish-leisure'
on conflict(property_id) do nothing;

insert into public.intelligence_schedules(organization_id,module,cadence,run_time,configuration)
select organization.id,module,cadence,run_time,configuration
from public.organizations organization
cross join (values
  ('PROFILE','MONTHLY',time '02:00',jsonb_build_object('manualRefresh',true,'requiresApproval',true)),
  ('MARKETING','DAILY',time '05:30',jsonb_build_object('windows',jsonb_build_array(7,14,30),'requiresApproval',true)),
  ('REPUTATION','EVERY_6_HOURS',null,jsonb_build_object('requiresApproval',true,'autoPublish',false))
) as defaults(module,cadence,run_time,configuration)
where organization.slug='lavendish-leisure'
on conflict(organization_id,module) do nothing;
