#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
換暗號 · 第二步：收緊（刪走舊暗號）
喺 Terminal 跑：  /usr/bin/python3 ~/eva-trip-pub/supabase/換暗號2_收緊.py

🔴 做之前一定要：手機同 Mac 嘅旅程 app 都已經用新暗號開過、一切正常。

做嘅嘢：刪走三條舊 policy（trip_log_gate／board_key／trip_files_gate）。
做完之後舊暗號 meal2026 打唔開旅程、打唔開戰略中心。

唔會碰：meal_log 嘅 meal_key policy（飲食 app 繼續用 meal2026）、MEAL_KEY secret。
下次開戰略中心，佢會自己彈出「暗號唔啱——再入一次」，你入新暗號就得。

鎖唔死你：就算入錯，重新跑第一步就再開一道門。
"""
import os, json, sys, urllib.request, urllib.error

REF  = 'lvwspnjysfyomuszzjay'
SB   = f'https://{REF}.supabase.co'
HTML = os.path.expanduser('~/eva-trip-pub/index.html')

def kv(n):
    for ln in open(os.path.expanduser('~/Eva_Brain/.secrets/keys.env'), encoding='utf-8'):
        if ln.startswith(n + '='): return ln.rstrip('\n').split('=', 1)[1]
    sys.exit(f'keys.env 搵唔到 {n}')

AT  = kv('SUPABASE_ACCESS_TOKEN')
SBK = open(HTML, encoding='utf-8').read().split("var SBK = '")[1].split("'")[0]

def sql(q):
    r = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': q}).encode(),
        headers={'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(r, timeout=40) as f: return json.loads(f.read() or b'null')
    except urllib.error.HTTPError as e:
        print('  ⚠️ ' + e.read().decode()[:300]); return None

def probe(path, key):
    h = {'apikey': SBK, 'Authorization': 'Bearer ' + SBK}
    if key: h['x-client-info'] = key
    try:
        with urllib.request.urlopen(urllib.request.Request(SB + path, headers=h), timeout=20) as f:
            return len(f.read())
    except Exception:
        return -1

print(__doc__)

# 安全檢查：一定要已經有新門，否則刪咗舊門就冇門
rows = sql("select policyname from pg_policies where policyname in "
           "('trip_log_gate_v2','wbh_board_gate_v2','trip_files_gate_v2')")
have = {r['policyname'] for r in (rows or [])}
missing = {'trip_log_gate_v2', 'wbh_board_gate_v2', 'trip_files_gate_v2'} - have
if missing:
    sys.exit('❌ 搵唔到新門：' + '、'.join(sorted(missing)) +
             '\n   請先跑第一步：/usr/bin/python3 ~/eva-trip-pub/supabase/換暗號1_加新暗號.py')

ans = input('手機同 Mac 都已經用新暗號開過旅程 app、一切正常？（打 yes 繼續）： ').strip().lower()
if ans != 'yes':
    sys.exit('冇改任何嘢。確認之後再跑。')

print('\n━━━ 刪走舊門 ━━━')
for label, tbl, name in [('旅程資料', 'public.trip_log',  'trip_log_gate'),
                         ('戰略中心', 'public.wbh_board', 'board_key'),
                         ('旅程附件', 'storage.objects',  'trip_files_gate')]:
    sql(f'drop policy if exists {name} on {tbl}')
    print(f'  ✅ {label}（{name}）')

print('\n━━━ 驗證 ━━━')
checks = [
    ('舊暗號 → 旅程資料（應該擋住）',   probe('/rest/v1/trip_log?id=eq.main&select=updated_at', 'meal2026'), False),
    ('舊暗號 → 戰略中心（應該擋住）',   probe('/rest/v1/wbh_board?id=eq.main&select=updated_at', 'meal2026'), False),
    ('舊暗號 → 飲食 app（應該仍然通）', probe('/rest/v1/meal_log?id=eq.main&select=updated_at', 'meal2026'), True),
]
bad = 0
for label, n, want in checks:
    got = n > 100
    ok = (got == want)
    if not ok: bad += 1
    print(f'  {"✅" if ok else "❌"} {label:<34} {"開得到" if got else "擋住"}')

rows = sql("select schemaname||'.'||tablename as t, policyname from pg_policies "
           "where tablename in ('trip_log','wbh_board','meal_log') "
           "or (schemaname='storage' and tablename='objects') order by t, policyname")
print('\n━━━ 而家剩返嘅門 ━━━')
for r in (rows or []):
    print(f"  {r['t']:<22} {r['policyname']}")

print()
if bad:
    print(f'❌ 有 {bad} 項唔對，同我講聲。')
else:
    print('🎉 換完。')
    print('  · 旅程 app：新暗號')
    print('  · 戰略中心：下次開會彈出問你，入新暗號')
    print('  · 飲食 app：繼續用 meal2026，冇受影響')
    print('  · board.py／eva-oura 自動腳本：用 service key，照跑')
