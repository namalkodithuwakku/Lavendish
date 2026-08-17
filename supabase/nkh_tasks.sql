create extension if not exists pgcrypto;

create table if not exists public.nkh_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  hotel_code text,
  category text not null check (category in ('OTA','YIELD','RESERVATIONS','MARKETING','REPUTATION','OPERATIONS','FINANCE','OTHER')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'NEW' check (status in ('NEW','IN_PROGRESS','DONE')),
  assigned_to uuid not null references auth.users(id) on delete cascade,
  assigned_name text not null,
  due_date date,
  remarks text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists nkh_tasks_assigned_to_idx on public.nkh_tasks(assigned_to);
create index if not exists nkh_tasks_status_idx on public.nkh_tasks(status);
create index if not exists nkh_tasks_due_date_idx on public.nkh_tasks(due_date);
alter table public.nkh_tasks enable row level security;
notify pgrst, 'reload schema';