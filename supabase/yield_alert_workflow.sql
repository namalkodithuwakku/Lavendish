-- Lavendish alert follow-up workflow
-- Run after yield_change_detection.sql.

alter table public.yield_alerts
  add column if not exists followed_by uuid references auth.users(id),
  add column if not exists followed_at timestamptz,
  add column if not exists actioned_by uuid references auth.users(id),
  add column if not exists actioned_at timestamptz,
  add column if not exists dismissed_by uuid references auth.users(id),
  add column if not exists dismissed_at timestamptz;

create index if not exists yield_alert_status_date_idx
  on public.yield_alerts(status, stay_date, created_at desc);

-- Alert pages and alert data are restricted to the Master Admin.
-- Remove any older SELECT/ALL policies that allowed hotel-level viewers.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'yield_alerts'
      and cmd in ('SELECT', 'ALL')
  loop
    execute format(
      'drop policy if exists %I on public.yield_alerts',
      existing_policy.policyname
    );
  end loop;
end
$$;

create policy "Master Admin can view yield alerts"
  on public.yield_alerts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.occupancy_user_access access
      where access.user_id = auth.uid()
        and access.active = true
        and access.role = 'MASTER_ADMIN'
    )
  );
