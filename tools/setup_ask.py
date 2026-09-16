#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
開「識你行程嘅問答端點」（畀 Rokid Glasses ／ 任何 client 用）

喺 Terminal 跑：
  /usr/bin/python3 ~/eva-trip-pub/tools/setup_ask.py

做嘅嘢（全部自動，你唔使打任何嘢）：
  ① 生成一條 ASK_KEY，設成 Supabase secret
     （同 BRIEF_KEY 分開 —— 眼鏡上面嗰條洩漏都唔會影響每日推播）
  ② 試問幾條真問題，印答案出嚟睇
  ③ 印出你要喺眼鏡／瀏覽器用嘅完整 URL 同 body

用法：
  setup_ask.py            裝＋測
  setup_ask.py --ask "問題"   用現有 key 問一條（key 由 cron 表讀返）
  setup_ask.py --show     只印出調用方法
"""
import os, sys, json, secrets as pysec, urllib.request, urllib.error

REF = 'lvwspnjysfyomuszzjay'
KEYS = os.path.expanduser('~/Eva_Brain/.secrets/keys.env')
FN = f'https://{REF}.supabase.co/functions/v1/trip-ask'
API = 'https://api.supabase.com/v1/projects/' + REF
KEYFILE = os.path.expanduser('~/eva-trip-pub/tools/.ask_key')   # 本機留一份，方便再測


def kv(n):
    with open(KEYS, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith(n + '='):
                return ln.rstrip('\n').split('=', 1)[1]
    sys.exit(f'keys.env 搵唔到 {n}')


AT = kv('SUPABASE_ACCESS_TOKEN')


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
        return {'__err': e.read().decode()[:300]}


def ask(key, q, fmt='hud'):
    r = urllib.request.Request(FN,
        data=json.dumps({'key': key, 'q': q, 'fmt': fmt}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(r, timeout=45) as f:
            return json.loads(f.read())
    except urllib.error.HTTPError as e:
        return {'error': f'HTTP {e.code}', 'detail': e.read().decode()[:200]}


def load_key():
    if os.path.exists(KEYFILE):
        return open(KEYFILE, encoding='utf-8').read().strip()
    return None


def show(key):
    print('━━━ 喺眼鏡／瀏覽器／任何 client 噉樣叫 ━━━')
    print(f'  POST {FN}')
    print('  Content-Type: application/json')
    print('  Body: {"key":"<ASK_KEY>","q":"下一站幾點關門？","fmt":"hud"}')
    print('  → {"text":"…"}')
    print()
    print('  curl 例（本機 key 已經填好）：')
    print(f"""  curl -s -X POST {FN} \\
    -H 'Content-Type: application/json' \\
    -d '{{"key":"{key or "<ASK_KEY>"}","q":"今日仲有幾多站？"}}'""")
    print()
    print('  fmt="hud"  → 最多兩行、≤90 字、冇 emoji（眼鏡用）')
    print('  fmt="full" → 最多五行（手機用）')


def main():
    args = sys.argv[1:]
    if '--show' in args:
        show(load_key()); return

    if '--ask' in args:
        key = load_key()
        if not key: sys.exit('本機冇 ASK_KEY，先跑一次 setup_ask.py')
        q = args[args.index('--ask') + 1]
        d = ask(key, q)
        print(d.get('text') or d)
        return

    print(__doc__)
    print('━━━ ① 設定 ASK_KEY ━━━')
    key = load_key() or pysec.token_urlsafe(24)
    r = mapi('/secrets', 'POST', [{'name': 'ASK_KEY', 'value': key}])
    if isinstance(r, dict) and '__err' in r:
        sys.exit('設 secret 失敗：' + r['__err'])
    os.makedirs(os.path.dirname(KEYFILE), exist_ok=True)
    with open(KEYFILE, 'w', encoding='utf-8') as f:
        f.write(key)
    os.chmod(KEYFILE, 0o600)
    print(f'  ✅ ASK_KEY 已設（{len(key)} 個字，本機副本存喺 tools/.ask_key，權限 600）')

    print('\n━━━ ② 試問真問題（fmt=hud，眼鏡格式）━━━')
    for q in ['下一站係邊度？幾點關門？',
              '今日天氣點？幾點天黑？',
              '今日仲有幾多個地方未去？',
              '我間酒店嘅訂房編號係咩？',
              '今日開幾多車？',
              '附近有咩溫泉？']:
        d = ask(key, q)
        t = d.get('text')
        print(f'  Q: {q}')
        if t:
            for ln in t.split('\n'):
                print(f'     → {ln}')
            print(f'     （{len(t)} 字 · {d.get("ms")}ms）')
        else:
            print(f'     ❌ {d}')
    print()
    show(key)


if __name__ == '__main__':
    main()
