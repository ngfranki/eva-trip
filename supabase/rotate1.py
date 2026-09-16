#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
換暗號 · 第一步：加新暗號（舊暗號照用，唔會斷線）
喺 Terminal 跑：  /usr/bin/python3 ~/eva-trip-pub/supabase/rotate1.py

做嘅嘢：
  ① 問你兩個新暗號（打嘅時候唔會顯示，唔會入 shell history，唔會入 log）
  ② 喺資料庫「加」三道新門（旅程資料／戰略中心／旅程附件）—— 一條現有嘅都唔改唔刪
  ③ 設定 TRIP_KEY（AI 同地圖搜尋要用）
  ④ 自己驗證一次：新暗號通、錯暗號擋、舊暗號仍然通

🔴 唔會碰：meal_log（飲食 app）、MEAL_KEY、service key
"""
import os, re, json, sys, getpass, urllib.request, urllib.error

REF  = 'lvwspnjysfyomuszzjay'
SB   = f'https://{REF}.supabase.co'
KEYS = os.path.expanduser('~/Eva_Brain/.secrets/keys.env')
HTML = os.path.expanduser('~/eva-trip-pub/index.html')

def die(msg):
    print('\n❌ ' + msg); sys.exit(1)

def kv(name):
    with open(KEYS, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith(name + '='):
                return ln.rstrip('\n').split('=', 1)[1]
    die(f'keys.env 搵唔到 {name}')

AT  = kv('SUPABASE_ACCESS_TOKEN')
SBK = open(HTML, encoding='utf-8').read().split("var SBK = '")[1].split("'")[0]

def sql(q):
    r = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': q}).encode(),
        headers={'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(r, timeout=40) as f:
            return json.loads(f.read() or b'null')
    except urllib.error.HTTPError as e:
        die('資料庫報錯：' + e.read().decode()[:400])

def probe(path, key):
    """回傳收到幾多 bytes。2 = 空陣列 = 被擋住。"""
    h = {'apikey': SBK, 'Authorization': 'Bearer ' + SBK}
    if key: h['x-client-info'] = key
    try:
        with urllib.request.urlopen(urllib.request.Request(SB + path, headers=h), timeout=20) as f:
            return len(f.read())
    except Exception:
        return -1

def ask(label):
    while True:
        a = getpass.getpass(f'  {label}（打嘅時候唔會顯示）：').strip()
        b = getpass.getpass(f'  再打一次確認：').strip()
        if a != b:
            print('  ⚠️  兩次唔同，再嚟一次\n'); continue
        if len(a) < 12:
            print(f'  ⚠️  太短（{len(a)} 個字），至少要 12 個\n'); continue
        # 2026-09-16 實測過：! ? # $ % & * ( : ; , / = ^ | 大細階 數字
        # 全部喺 x-client-info header、JSON、SQL literal 入面都安全過得去。
        # 只擋三樣真正會出事嘅：空格（header 會斷）、單引號同反斜線（SQL 逃逸）、
        # 同埋雙引號同反引號（穩陣起見）。
        bad = set(a) & set(' \'"\\`')
        if bad:
            print('  ⚠️  唔可以有 ' + '、'.join(('空格' if c==' ' else c) for c in sorted(bad))
                  + '（其他符號例如 ! ? # $ % & * 都用得）\n'); continue
        if not all(32 < ord(c) < 127 for c in a):
            print('  ⚠️  只可以用英文鍵盤打得出嘅字（唔好用中文字或者 emoji）\n'); continue
        return a

print(__doc__)
print('━━━ 請輸入兩個新暗號 ━━━')
print('建議格式：copper-lantern-quiet-42（四個無關英文字加數字）')
print('大細階、數字、!  ?  #  $  %  &  *  等符號全部用得。')
print("唔可以有：空格、單引號、雙引號、反斜線、反引號\n")
A = ask('① 旅程 app 嘅新暗號')
print()
B = ask('② 戰略中心嘅新暗號')
if A == B: die('兩個暗號一定要唔同（一個被猜中唔好連累另一個）')
print(f'\n✅ 收到（旅程 {len(A)} 個字、戰略中心 {len(B)} 個字）。我唔會印出嚟。\n')

gate = lambda p: ("(current_setting('request.headers', true)::json ->> 'x-client-info') = "
                  + "'" + p.replace("'", "''") + "'")

print('━━━ ① 加新門（唔改唔刪現有嘅）━━━')
jobs = [
    ('旅程資料',   'public.trip_log',  'trip_log_gate_v2',   'public', gate(A)),
    ('戰略中心',   'public.wbh_board', 'wbh_board_gate_v2',  'public', gate(B)),
    ('旅程附件',   'storage.objects',  'trip_files_gate_v2', 'anon',
                   "bucket_id = 'trip-files' and " + gate(A)),
]
for label, tbl, name, role, expr in jobs:
    sql(f'drop policy if exists {name} on {tbl}')
    sql(f'create policy {name} on {tbl} for all to {role} '
        f'using ({expr}) with check ({expr})')
    print(f'  ✅ {label}')

print('\n━━━ ② 設定 TRIP_KEY（AI ／ 地圖搜尋）━━━')
# 用 Management API 而唔用 `supabase secrets set`：JSON 編碼任何符號都安全，
# 而且個值唔會經過 shell、唔會出現喺 process list、唔會寫落任何檔案。
def set_secret(name, value):
    r = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/secrets',
        data=json.dumps([{'name': name, 'value': value}]).encode(),
        headers={'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(r, timeout=30) as f:
            f.read(); return None
    except urllib.error.HTTPError as e:
        return e.read().decode()[:300]
err = set_secret('TRIP_KEY', A)
print('  ' + ('✅ 設定好（MEAL_KEY 冇碰過）' if err is None else '❌ 失敗：' + err))

print('\n━━━ ③ 驗證 ━━━')
checks = [
    ('新暗號 → 旅程資料',      probe('/rest/v1/trip_log?id=eq.main&select=updated_at', A),  True),
    ('新暗號 → 戰略中心',      probe('/rest/v1/wbh_board?id=eq.main&select=updated_at', B), True),
    ('錯暗號 → 旅程資料',      probe('/rest/v1/trip_log?id=eq.main&select=updated_at', 'definitely-wrong'), False),
    ('舊暗號 → 旅程資料（過渡期應該仍然通）',
                              probe('/rest/v1/trip_log?id=eq.main&select=updated_at', 'meal2026'), True),
    ('飲食 app 冇受影響',      probe('/rest/v1/meal_log?id=eq.main&select=updated_at', 'meal2026'), True),
]
bad = 0
for label, n, want_open in checks:
    got_open = n > 100
    ok = (got_open == want_open)
    if not ok: bad += 1
    print(f'  {"✅" if ok else "❌"} {label:<38} {"開得到" if got_open else "擋住"}')

print()
if bad:
    print('❌ 有 %d 項唔對。想即刻回到原狀，跑：' % bad)
    print('     /usr/bin/python3 ~/eva-trip-pub/supabase/rotate_undo.py')
else:
    print('🎉 第一步完成。你嘅 app 而家新舊暗號都通，唔會斷線。')
    print()
    print('下一步（喺手機同 Mac 各做一次）：')
    print('  旅程 app → ☰ → 設定 → 登出 → 輸入新暗號')
    print('  確認三樣：行程載得出、地圖有點、「加地點」打兩個字有搜尋結果')
    print('            （第三樣證明 TRIP_KEY 設對）')
    print()
    print('兩部機都正常之後，跑第二步收緊（刪走舊暗號）：')
    print('  /usr/bin/python3 ~/eva-trip-pub/supabase/rotate2.py')
