#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
把「旅程早／午／晚報」搬上 Supabase 雲端 —— 唔再靠你部 Mac。

喺 Terminal 跑：
  /usr/bin/python3 ~/eva-trip-pub/tools/setup_brief_cloud.py

做嘅嘢（全部自動，你唔使打任何嘢）：
  ① 由 keys.env 讀小恩嘅 bot token，設成 Supabase secret
     （值唔會印出嚟、唔會經 shell、唔會寫落任何檔案）
  ② 開 pg_cron 同 pg_net（Supabase 內建，未裝）
  ③ 排三個 cron job：日本時間 07:00 / 12:30 / 19:30
  ④ 即刻試跑一次（--dry，唔會 send），確認條線通
  ⑤ 熄咗部機上面嗰個舊 launchd（唔想收兩封）

🔴 只係「發」，唔碰「收」—— 所以唔會搶走 eva-telegram-private/bridge.js
   嘅 updates，你私人助理熱線照用。
🔴 唔喺旅程日期範圍就一個字都唔會發（功能自己會 check，唔使你理）。

用法：
  setup_brief_cloud.py              裝
  setup_brief_cloud.py --status     只睇現狀
  setup_brief_cloud.py --remove     拆走（刪 cron job、開返 launchd）
"""
import os, sys, json, secrets as pysec, subprocess, urllib.request, urllib.error

REF = 'lvwspnjysfyomuszzjay'
KEYS = os.path.expanduser('~/Eva_Brain/.secrets/keys.env')
CHAT = '8862911059'
PLIST = os.path.expanduser('~/Library/LaunchAgents/com.eva.trip.brief.plist')
FN = f'https://{REF}.supabase.co/functions/v1/trip-brief'

SLOTS = [                      # 日本時間 → UTC（cron 用 UTC）
    ('trip_brief_morning', 'morning', '0 22 * * *', '07:00 JST'),
    ('trip_brief_noon',    'noon',    '30 3 * * *', '12:30 JST'),
    ('trip_brief_evening', 'evening', '30 10 * * *', '19:30 JST'),
]


def die(m):
    print('\n❌ ' + m); sys.exit(1)


def kv(n):
    with open(KEYS, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith(n + '='):
                return ln.rstrip('\n').split('=', 1)[1]
    die(f'keys.env 搵唔到 {n}')


AT = kv('SUPABASE_ACCESS_TOKEN')
API = 'https://api.supabase.com/v1/projects/' + REF


def mapi(path, method='GET', body=None):
    r = urllib.request.Request(API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'},
        method=method)
    try:
        with urllib.request.urlopen(r, timeout=40) as f:
            raw = f.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {'__err': e.read().decode()[:300], '__code': e.code}


def sql(q):
    return mapi('/database/query', 'POST', {'query': q})


def secrets_now():
    d = mapi('/secrets')
    return {} if isinstance(d, dict) else {s['name']: 1 for s in d}


def status():
    have = secrets_now()
    print('Supabase secrets：')
    for n in ('TELEGRAM_BOT_TOKEN_SIUYAN', 'TELEGRAM_CHAT_FRANKI', 'BRIEF_KEY',
              'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_MAPS_KEY'):
        print(f'  {"✅" if n in have else "❌"} {n}')
    ext = sql("select extname from pg_extension where extname in ('pg_cron','pg_net')")
    got = {x['extname'] for x in ext} if isinstance(ext, list) else set()
    print('擴充：')
    for n in ('pg_cron', 'pg_net'):
        print(f'  {"✅" if n in got else "❌"} {n}')
    if 'pg_cron' in got:
        jobs = sql("select jobname, schedule, active from cron.job where jobname like 'trip_brief%' order by jobname")
        print('Cron job：')
        if isinstance(jobs, list) and jobs:
            for j in jobs:
                print(f"  ✅ {j['jobname']:<22} {j['schedule']:<14} active={j['active']}")
        else:
            print('  ❌ 未排')
    print('部機上面嘅舊 launchd：', '仍然開住 ⚠️' if os.path.exists(PLIST) else '已拆 ✅')


def setup():
    print(__doc__)

    # ── ① secrets ──
    print('━━━ ① 設定 secrets ━━━')
    have = secrets_now()
    want = {
        'TELEGRAM_BOT_TOKEN_SIUYAN': kv('TELEGRAM_BOT_TOKEN_SIUYAN'),
        'TELEGRAM_CHAT_FRANKI': CHAT,
    }
    if 'BRIEF_KEY' not in have:
        want['BRIEF_KEY'] = pysec.token_urlsafe(24)
    payload = [{'name': k, 'value': v} for k, v in want.items()]
    r = mapi('/secrets', 'POST', payload)
    if isinstance(r, dict) and '__err' in r:
        die('設 secret 失敗：' + r['__err'])
    for k in want:
        print(f'  ✅ {k}' + ('（新生成）' if k == 'BRIEF_KEY' else ''))

    brief_key = want.get('BRIEF_KEY')
    if not brief_key:
        die('BRIEF_KEY 之前已經設過，但我讀唔返個值（Supabase 唔畀讀）。\n'
            '   請先喺 Supabase 後台刪咗 BRIEF_KEY，再跑一次呢個腳本。')

    # ── ② 擴充 ──
    print('\n━━━ ② 開 pg_cron ／ pg_net ━━━')
    for e in ('pg_cron', 'pg_net'):
        r = sql(f'create extension if not exists {e} with schema extensions')
        if isinstance(r, dict) and '__err' in r:
            r2 = sql(f'create extension if not exists {e}')
            if isinstance(r2, dict) and '__err' in r2:
                die(f'開 {e} 失敗：' + r2['__err'])
        print(f'  ✅ {e}')

    # ── ③ 排 cron ──
    print('\n━━━ ③ 排三個 cron job ━━━')
    for jobname, slot, sched, human in SLOTS:
        sql(f"select cron.unschedule('{jobname}')")     # 有就拆，冇就報錯（無害）
        body = json.dumps({'key': brief_key, 'slot': slot}).replace("'", "''")
        cmd = (f"select net.http_post("
               f"url := '{FN}', "
               f"headers := '{{\"Content-Type\": \"application/json\"}}'::jsonb, "
               f"body := '{body}'::jsonb, "
               f"timeout_milliseconds := 30000)")
        r = sql(f"select cron.schedule('{jobname}', '{sched}', $cron${cmd}$cron$)")
        if isinstance(r, dict) and '__err' in r:
            die(f'排 {jobname} 失敗：' + r['__err'])
        print(f'  ✅ {jobname:<22} {human}')

    # ── ④ 試跑 ──
    print('\n━━━ ④ 試跑（--dry，唔會 send）━━━')
    for slot in ('morning', 'noon', 'evening'):
        req = urllib.request.Request(FN,
            data=json.dumps({'key': brief_key, 'slot': slot, 'dry': True}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=40) as f:
                d = json.loads(f.read())
            if d.get('text'):
                print(f'  ✅ {slot}：')
                for ln in d['text'].split('\n')[:6]:
                    print('       ' + ln)
                print('       …')
            else:
                print(f'  ✅ {slot}：{d.get("why", d)}')
        except urllib.error.HTTPError as e:
            print(f'  ❌ {slot}：HTTP {e.code} {e.read().decode()[:120]}')

    # ── ⑤ 拆走部機上面嗰個 ──
    print('\n━━━ ⑤ 拆走部機上面嗰個舊定時 ━━━')
    if os.path.exists(PLIST):
        subprocess.run(['launchctl', 'unload', PLIST], capture_output=True)
        os.rename(PLIST, PLIST + '.disabled')
        print('  ✅ 已熄（檔案改名為 .disabled，想要返就改返名）')
    else:
        print('  （本來就冇）')

    print('\n🎉 搞完。之後：')
    print('  · 日本時間 07:00 早報、12:30 午報、19:30 晚報（講聽日）')
    print('  · 唔喺旅程日期範圍就一個字都唔發')
    print('  · 完全喺 Supabase 雲端跑，你部 Mac 熄機都照出')
    print('  · 想改時間或者拆走：setup_brief_cloud.py --remove')


def remove():
    print('拆走雲端定時…')
    for jobname, *_ in SLOTS:
        sql(f"select cron.unschedule('{jobname}')")
        print(f'  ✅ 拆咗 {jobname}')
    if os.path.exists(PLIST + '.disabled'):
        os.rename(PLIST + '.disabled', PLIST)
        subprocess.run(['launchctl', 'load', PLIST], capture_output=True)
        print('  ✅ 開返部機上面嗰個（每日 06:30 香港時間）')
    print('（secrets 留住冇害，想清就去 Supabase 後台）')


if __name__ == '__main__':
    if '--status' in sys.argv:
        status()
    elif '--remove' in sys.argv:
        remove()
    else:
        setup()
