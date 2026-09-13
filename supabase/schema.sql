-- 旅程記錄 · Supabase 表 + 暗號閘（跟 meal_log 同一套 RLS 模式）
-- 喺 Supabase SQL Editor 行一次。'你嘅暗號' 換做真嘅（同飲食記錄可以用同一個）。

create table if not exists public.trip_log (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.trip_log enable row level security;

drop policy if exists trip_log_gate on public.trip_log;
create policy trip_log_gate on public.trip_log
  for all
  using  ( current_setting('request.headers', true)::json ->> 'x-client-info' = '你嘅暗號' )
  with check ( current_setting('request.headers', true)::json ->> 'x-client-info' = '你嘅暗號' );

grant select, insert, update on public.trip_log to anon;
