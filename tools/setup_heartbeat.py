#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
裝「小恩心跳監察」—— iMac 死咗、停咗喺密碼畫面，雲端會經 Telegram 通知你

喺 Terminal 跑：
  /usr/bin/python3 ~/eva-trip-pub/tools/setup_heartbeat.py

做嘅嘢（全部自動，你唔使打任何嘢）：
  ① 喺 Supabase 開一張細表 heartbeat（只有 service key 讀寫得，瀏覽器睇唔到）
  ② iMac 裝 launchd：每 5 分鐘報一次平安（連 bridge／responder 有冇行）
  ③ 雲端排 pg_cron：每 10 分鐘檢查，超過 20 分鐘冇報平安就通知你
  ④ 即刻報一次平安 ＋ 檢查一次，確認成條線通

🔴 通知由雲端直接經 Telegram bot 發，唔經 iMac —— iMac 死咗都送得到。
🔴 唔會改小恩本身任何 code。

用法：
  setup_heartbeat.py            裝
  setup_heartbeat.py --status   睇現狀
  setup_heartbeat.py --test     模擬斷線（將最後心跳改做 30 分鐘前）→ 你會收到通知
  setup_heartbeat.py --remove   拆走
"""
import os, sys, json, re, subprocess, datetime, urllib.request, urllib.error

REF = 'lvwspnjysfyomuszzjay'
KEYS = os.path.expanduser('~/Eva_Brain/.secrets/keys.env')
HB = os.path.expanduser('~/eva-trip-pub/tools/heartbeat.sh')
PLIST = os.path.expanduser('~/Library/LaunchAgents/com.eva.imac.heartbeat.plist')
FN = f'https://{REF}.supabase.co/functions/v1/hb-check'
JOB = 'imac_heartbeat_check'


def die(m): print('\n❌ ' + m); sys.exit(1)


def kv(n):
    with open(KEYS, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith(n + '='): return ln.rstrip('\n').split('=', 1)[1]
    die(f'keys.env 搵唔到 {n}')


AT = kv('SUPABASE_ACCESS_TOKEN')
SRV = kv('SUPABASE_SERVICE_KEY')


def sql(q):
    r = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': q}).encode(),
        headers={'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(r, timeout=40) as f:
            raw = f.read(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {'__err': e.read().decode()[:300]}


def brief_key():
    rows = sql("select command from cron.job where jobname='trip_brief_morning'")
    if not isinstance(rows, list) or not rows:
        die('搵唔到 trip_brief_morning cron job（要先跑 setup_brief_cloud.py）')
    m = re.search(r'"key":\s*"([^"]+)"', rows[0]['command'])
    if not m: die('讀唔到 BRIEF_KEY')
    return m.group(1)


def check(key):
    r = urllib.request.Request(FN, data=json.dumps({'key': key}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(r, timeout=40) as f: return json.loads(f.read())
    except urllib.error.HTTPError as e:
        return {'HTTP': e.code, 'body': e.read().decode()[:200]}


def status():
    rows = sql("select id, at, detail, alert_kind, alerted_at from heartbeat")
    if isinstance(rows, dict): print('heartbeat 表：❌', rows.get('__err', '')[:120]); return
    for r in rows:
        at = datetime.datetime.fromisoformat(r['at'].replace('Z', '+00:00'))
        age = (datetime.datetime.now(datetime.timezone.utc) - at).total_seconds() / 60
        print(f"  最後報平安：{age:.1f} 分鐘前　{r['detail']}")
        print(f"  通知狀態：{r['alert_kind'] or '正常'}")
    jobs = sql(f"select schedule, active from cron.job where jobname='{JOB}'")
    print('  雲端檢查：', f"✅ {jobs[0]['schedule']}" if isinstance(jobs, list) and jobs else '❌ 未排')
    print('  iMac launchd：', '✅ 已裝' if os.path.exists(PLIST) else '❌ 未裝')


def setup():
    print(__doc__)
    print('━━━ ① 開 heartbeat 表 ━━━')
    r = sql("""
      create table if not exists public.heartbeat (
        id text primary key,
        at timestamptz not null default now(),
        detail jsonb not null default '{}'::jsonb,
        alert_kind text,
        alerted_at timestamptz
      );
      alter table public.heartbeat enable row level security;
      -- 唔加任何 policy：anon（瀏覽器）完全讀寫唔到，只有 service key 得
    """)
    if isinstance(r, dict) and '__err' in r: die('開表失敗：' + r['__err'])
    print('  ✅ heartbeat（RLS 開咗、冇 policy → 只有 service key 讀寫得）')

    print('\n━━━ ② iMac 裝每 5 分鐘報平安 ━━━')
    plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.eva.imac.heartbeat</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>{HB}</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/eva-heartbeat.log</string>
  <key>StandardErrorPath</key><string>/tmp/eva-heartbeat.log</string>
</dict></plist>
'''
    with open(PLIST, 'w', encoding='utf-8') as f: f.write(plist)
    subprocess.run(['launchctl', 'unload', PLIST], capture_output=True)
    r2 = subprocess.run(['launchctl', 'load', PLIST], capture_output=True, text=True)
    print('  ✅ com.eva.imac.heartbeat（開機即報、之後每 5 分鐘）' if r2.returncode == 0
          else '  ❌ ' + r2.stderr)

    print('\n━━━ ③ 雲端每 10 分鐘檢查 ━━━')
    key = brief_key()
    sql(f"select cron.unschedule('{JOB}')")
    body = json.dumps({'key': key}).replace("'", "''")
    cmd = (f"select net.http_post(url := '{FN}', "
           f"headers := '{{\"Content-Type\": \"application/json\"}}'::jsonb, "
           f"body := '{body}'::jsonb, timeout_milliseconds := 30000)")
    r3 = sql(f"select cron.schedule('{JOB}', '*/10 * * * *', $c${cmd}$c$)")
    if isinstance(r3, dict) and '__err' in r3: die('排 cron 失敗：' + r3['__err'])
    print('  ✅ 每 10 分鐘（超過 20 分鐘冇報平安就通知）')

    print('\n━━━ ④ 即刻試一次 ━━━')
    subprocess.run(['/bin/bash', HB], capture_output=True)
    import time; time.sleep(2)
    d = check(key)
    print('  報平安 → 檢查結果：', d)
    if d.get('state') == 'healthy':
        det = d.get('detail', {})
        print(f"  ✅ 成條線通。bridge={'行緊' if det.get('bridge') else '❌冇行'}　"
              f"responder={'行緊' if det.get('responder') else '❌冇行'}　開咗機 {det.get('uptime')}")
    print('\n想確認真係收得到通知：setup_heartbeat.py --test')


def test():
    print('模擬斷線：將最後心跳改做 30 分鐘前，再叫雲端檢查…')
    sql("update heartbeat set at = now() - interval '30 minutes', alert_kind = null where id='imac'")
    d = check(brief_key())
    print('  檢查結果：', d)
    print('  → 你 Telegram 應該收到「⚠️ 小恩斷咗線」。' if d.get('alerted') else '  ❌ 冇發到通知')
    print('\n5 分鐘內 iMac 會自己報平安，之後雲端下一輪檢查會發「🌿 小恩返嚟喇」。')


def remove():
    sql(f"select cron.unschedule('{JOB}')")
    subprocess.run(['launchctl', 'unload', PLIST], capture_output=True)
    if os.path.exists(PLIST): os.remove(PLIST)
    print('✅ 拆咗（heartbeat 表留住冇害）')


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--status' in a: status()
    elif '--test' in a: test()
    elif '--remove' in a: remove()
    else: setup()
