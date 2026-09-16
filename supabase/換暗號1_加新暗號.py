#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
換暗號 · 第一步：加新暗號（舊暗號照用，唔會斷線）
喺 Terminal 跑：  /usr/bin/python3 ~/eva-trip-pub/supabase/換暗號1_加新暗號.py

做嘅嘢：
  ① 問你兩個新暗號（打嘅時候唔會顯示，唔會入 shell history，唔會入 log）
  ② 喺資料庫「加」三道新門（旅程資料／戰略中心／旅程附件）—— 一條現有嘅都唔改唔刪
  ③ 設定 TRIP_KEY（AI 同地圖搜尋要用）
  ④ 自己驗證一次：新暗號通、錯暗號擋、舊暗號仍然通

🔴 唔會碰：meal_log（飲食 app）、MEAL_KEY、service key
"""
import os, re, json, sys, getpass, subprocess, tempfile, urllib.request, urllib.error

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
        if not re.fullmatch(r'[A-Za-z0-9._@~+-]+', a):
            print('  ⚠️  只可以用英文字母、數字、同 - _ . @ ~ +（唔好有空格同引號）\n'); continue
        return a

print(__doc__)
print('━━━ 請輸入兩個新暗號 ━━━')
print('建議格式：copper-lantern-quiet-42（四個無關英文字加數字）\n')
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
fd, tmp = tempfile.mkstemp(); os.close(fd); os.chmod(tmp, 0o600)
try:
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(f'TRIP_KEY={A}\n')
    r = subprocess.run(['supabase', 'secrets', 'set', '--env-file', tmp,
                        '--project-ref', REF], capture_output=True, text=True)
    print('  ' + ('✅ 設定好' if r.returncode == 0
                  else '❌ 失敗：' + (r.stderr or r.stdout)[:300]))
finally:
    os.remove(tmp)

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
    print('     /usr/bin/python3 ~/eva-trip-pub/supabase/換暗號_取消.py')
else:
    print('🎉 第一步完成。你嘅 app 而家新舊暗號都通，唔會斷線。')
    print()
    print('下一步（喺手機同 Mac 各做一次）：')
    print('  旅程 app → ☰ → 設定 → 登出 → 輸入新暗號')
    print('  確認三樣：行程載得出、地圖有點、「加地點」打兩個字有搜尋結果')
    print('            （第三樣證明 TRIP_KEY 設對）')
    print()
    print('兩部機都正常之後，跑第二步收緊（刪走舊暗號）：')
    print('  /usr/bin/python3 ~/eva-trip-pub/supabase/換暗號2_收緊.py')
