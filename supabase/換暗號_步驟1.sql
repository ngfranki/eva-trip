-- ════════════════════════════════════════════════════════════════
-- 換暗號 · 步驟一：睇清現況 ＋ 加入新暗號（舊暗號照用，唔會斷線）
-- ════════════════════════════════════════════════════════════════
-- 做法：只「加」新的 policy，完全唔改、唔刪任何現有 policy。
--       Postgres 的 permissive policy 是 OR 關係 —— 所以加完之後
--       舊暗號同新暗號兩個都通。確認手機、Mac 都正常之後，
--       才執行步驟二把舊的刪掉。
--
-- 🔴 執行前一定要做：把下面兩行的暗號換成你自己的
--    · 至少 12 個字，建議 16 個以上（例如四個無關英文字加數字）
--    · 兩個一定要不同
--    · 不要用真名、生日、app 名字加年份
--
-- 影響範圍（已核實）：
--    · 戰略中心的 board.py、eva-oura 的 5 個腳本用 service key，不受影響
--    · 飲食記錄 app（meal_log）完全不碰
-- ════════════════════════════════════════════════════════════════

-- ── ① 先睇現況（唔改嘢，只係印出嚟）────────────────────────────
select 'A. 現有 policy' as 區段, schemaname||'.'||tablename as 表,
       policyname as policy名, cmd as 指令,
       pg_get_expr(pol.polqual, pol.polrelid) as using表達式
from pg_policies pp
join pg_policy pol on pol.polname = pp.policyname
join pg_class c on c.oid = pol.polrelid and c.relname = pp.tablename
where pp.tablename in ('trip_log','wbh_board','meal_log')
   or (pp.schemaname = 'storage' and pp.tablename = 'objects')
order by 表, policy名;


-- ── ② 加新暗號 ─────────────────────────────────────────────────
do $$
declare
  -- 🔴🔴🔴 改呢兩行 🔴🔴🔴
  new_trip  text := '改我-旅程新暗號';
  new_board text := '改我-戰略中心新暗號';
  -- 🔴🔴🔴 改完上面兩行才執行 🔴🔴🔴

  gate_trip  text;
  gate_board text;
  n int;
begin
  -- 防呆
  if new_trip like '改我%' or new_board like '改我%' then
    raise exception '仲未改暗號：請把 SQL 上面兩行的「改我-…」換成你自己的新暗號';
  end if;
  if length(new_trip) < 12 or length(new_board) < 12 then
    raise exception '暗號太短（現在 % 同 % 個字），至少要 12 個', length(new_trip), length(new_board);
  end if;
  if new_trip = new_board then
    raise exception '兩個暗號一定要不同';
  end if;

  gate_trip  := format('(current_setting(''request.headers'', true)::json ->> ''x-client-info'') = %L', new_trip);
  gate_board := format('(current_setting(''request.headers'', true)::json ->> ''x-client-info'') = %L', new_board);

  -- 旅程資料
  execute 'drop policy if exists trip_log_gate_v2 on public.trip_log';
  execute format('create policy trip_log_gate_v2 on public.trip_log for all to anon using (%s) with check (%s)',
                 gate_trip, gate_trip);
  raise notice '✅ trip_log 已加新暗號閘';

  -- 戰略中心
  execute 'drop policy if exists wbh_board_gate_v2 on public.wbh_board';
  execute format('create policy wbh_board_gate_v2 on public.wbh_board for all to anon using (%s) with check (%s)',
                 gate_board, gate_board);
  raise notice '✅ wbh_board 已加新暗號閘';

  -- 旅程附件（只限 trip-files 這個桶，唔會波及其他桶）
  execute 'drop policy if exists trip_files_gate_v2 on storage.objects';
  execute format($f$create policy trip_files_gate_v2 on storage.objects for all to anon
                    using (bucket_id = 'trip-files' and %s)
                    with check (bucket_id = 'trip-files' and %s)$f$, gate_trip, gate_trip);
  raise notice '✅ storage trip-files 已加新暗號閘';

  select count(*) into n from pg_policies
   where policyname in ('trip_log_gate_v2','wbh_board_gate_v2','trip_files_gate_v2');
  raise notice '── 新 policy 共 % 條（應該係 3）', n;
end $$;


-- ── ③ 執行後再睇一次，應該見到 3 條 _v2 ─────────────────────────
select 'B. 加完之後' as 區段, schemaname||'.'||tablename as 表, policyname as policy名, cmd as 指令
from pg_policies
where policyname like '%_v2'
   or tablename in ('trip_log','wbh_board')
   or (schemaname='storage' and tablename='objects')
order by 表, policy名;
