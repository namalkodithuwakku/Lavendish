-- Safe additive storage for the internal AI daily occupancy report.
create table if not exists public.ai_daily_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  generated_at timestamptz not null default now(),
  report_data jsonb not null,
  hotel_count integer not null default 0,
  stale_hotel_codes text[] not null default array[]::text[],
  email_sent boolean not null default false,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_daily_report_snapshots enable row level security;

drop policy if exists "Master reads AI daily reports" on public.ai_daily_report_snapshots;
create policy "Master reads AI daily reports"
on public.ai_daily_report_snapshots for select to authenticated
using (public.is_occupancy_admin());

create index if not exists ai_daily_reports_date_idx
on public.ai_daily_report_snapshots(report_date desc);
