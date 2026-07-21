-- Group Occupancy Intelligence: Supabase foundation
create extension if not exists pgcrypto;

create table if not exists public.occupancy_profiles (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null unique,
  hotel_name text not null,
  short_name text,
  location text,
  total_rooms integer check (total_rooms is null or total_rooms > 0),
  google_sheet_url text,
  google_spreadsheet_id text unique,
  active_year_tab text not null default extract(year from now())::text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  display_order integer not null default 0,
  last_sync_at timestamptz,
  last_sync_status text not null default 'Pending' check (last_sync_status in ('Pending','Healthy','Warning','Failed')),
  last_sync_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.occupancy_user_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('MASTER_ADMIN','HEAD_OFFICE','GM','VIEWER')),
  hotel_codes text[] not null default array['ALL']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.occupancy_aliases (
  id uuid primary key default gen_random_uuid(),
  hotel_code text not null default 'ALL',
  alias_type text not null check (alias_type in ('ROW','HEADER','MONTH','TAB')),
  canonical_key text not null,
  accepted_alias text not null,
  priority integer not null default 10,
  active boolean not null default true,
  unique (hotel_code,alias_type,accepted_alias)
);

alter table public.occupancy_profiles enable row level security;
alter table public.occupancy_user_access enable row level security;
alter table public.occupancy_aliases enable row level security;

create or replace function public.is_occupancy_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.occupancy_user_access where user_id=auth.uid() and active=true and role='MASTER_ADMIN');
$$;

create policy "Authorized profile reads" on public.occupancy_profiles for select to authenticated
using (exists(select 1 from public.occupancy_user_access ua where ua.user_id=auth.uid() and ua.active=true and ('ALL'=any(ua.hotel_codes) or occupancy_profiles.hotel_code=any(ua.hotel_codes))));
create policy "Admin profile management" on public.occupancy_profiles for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());
create policy "Own access read" on public.occupancy_user_access for select to authenticated
using (user_id=auth.uid() or public.is_occupancy_admin());
create policy "Admin access management" on public.occupancy_user_access for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());
create policy "Alias reads" on public.occupancy_aliases for select to authenticated
using (exists(select 1 from public.occupancy_user_access ua where ua.user_id=auth.uid() and ua.active=true));
create policy "Admin alias management" on public.occupancy_aliases for all to authenticated
using (public.is_occupancy_admin()) with check (public.is_occupancy_admin());

insert into public.occupancy_aliases(alias_type,canonical_key,accepted_alias,priority) values
('ROW','TOTAL','Total',1),('ROW','AVAILABILITY','Balance Rooms',1),('ROW','AVAILABILITY','Balance Room',2),
('ROW','AVAILABILITY','Total availability',3),('ROW','FUNCTIONS','Functions',1),('ROW','ALLOTMENT','Allotment',1),
('ROW','ALLOTMENT','Allowment',2),('HEADER','TOTAL_ROOMS','Total Rooms',1),('HEADER','LAST_UPDATED','Last updated Date',1)
on conflict do nothing;

insert into public.occupancy_profiles(hotel_code,hotel_name,short_name,location,total_rooms,active_year_tab,display_order) values
('MLR','Miridiya Lake Resort','Miridiya Lake Resort','Anuradhapura',38,'2026',1),
('GTL','Grand Tamarind Lake','Grand Tamarind Lake','Kataragama',25,'2026',2),
('LOH','Lavendish Okrin Hotel','Lavendish Okrin Hotel','Kataragama',17,'2026',3),
('LWS','Lavendish Wild Safari','Lavendish Wild Safari','Wasgamuwa',27,'2026',4),
('LWW','Lavendish Wild Wilpattu','Lavendish Wild Wilpattu','Wilpattu',12,'2026',5),
('LCR','Lavendish Country Resort','Lavendish Country Resort','Dambulla',18,'2026',6),
('LLG','Lavendish Lake Giritale','Lavendish Lake Giritale','Giritale',42,'2026',7),
('LHK','Lavendish Hills Kandy','Lavendish Hills Kandy','Kandy',43,'2026',8),
('TLK','Tamarind Lifestyle - Kataragama','Tamarind Lifestyle - Kataragama','Kataragama',17,'2026',9),
('LBU','Lavendish Beach Unawatuna','Lavendish Beach Unawatuna','Unawatuna',40,'2026',10)
on conflict(hotel_code) do update set hotel_name=excluded.hotel_name,short_name=excluded.short_name,location=excluded.location,total_rooms=excluded.total_rooms,display_order=excluded.display_order;
