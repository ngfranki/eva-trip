-- 旅程記錄 trip_log：表 + RLS 暗號閘
-- 暗號直接由 meal_log 個 policy 抄過來，唔使打，兩個 app 共用同一個暗號。
-- 喺 Supabase SQL Editor 行一次。（2026-09-13 已經喺 wbh-sales-coach project 行咗）

create table if not exists public.trip_log (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.trip_log enable row level security;
grant select, insert, update on public.trip_log to anon;

do $$
declare q text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into q
  from pg_policy pol
  where pol.polrelid = 'public.meal_log'::regclass
  order by pol.polname limit 1;

  if q is null then raise exception 'meal_log 冇 policy，抄唔到'; end if;

  execute 'drop policy if exists trip_log_gate on public.trip_log';
  execute format('create policy trip_log_gate on public.trip_log for all using (%s) with check (%s)', q, q);
end $$;

select tablename, policyname, cmd from pg_policies where tablename in ('meal_log','trip_log') order by tablename;
