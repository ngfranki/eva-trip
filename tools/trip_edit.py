#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
trip_edit.py — 改旅程 app 嘅資料（Telegram 小恩同 Terminal 都用得）

🔴 規矩：
  ① 每次寫入之前自動備份成個 state 落 ~/eva-trip-pub/backups/，改錯行 `undo` 還原
  ② 一定要加 --yes 才會寫，冇 --yes 只會講「準備做咩」（畀小恩先問 Franki 一次）
  ③ 關鍵字撞到多過一個項目就唔會寫，會列出候選叫你講清楚

用法：
  trip_edit.py list [日期]                          睇行程（唔寫入）
  trip_edit.py done   "大通公園"        --yes       打勾
  trip_edit.py undone "大通公園"        --yes       拆勾
  trip_edit.py time   "屈斜路湖" 10:00  --yes       排時間（HH:MM，用 "" 清空）
  trip_edit.py memo   "蟹一" "要訂位"   --yes       標註加一行
  trip_edit.py cost   "蟹一" 8000 JPY   --yes       記開支
  trip_edit.py rename "かつ之" "炸豬扒" --yes       改名
  trip_edit.py move   "Muji" 2026-12-05 --yes       搬去另一日（"" ＝變未排期）
  trip_edit.py add    2026-12-13 "すすきの 蟹一" --yes   加地點（自動搵 Google 資料）
  trip_edit.py del    "Muji"            --yes       刪走（有墓碑，其他裝置同步都會刪）
  trip_edit.py undo                     --yes       還原上一次改動
"""
import json, os, sys, re, time, datetime, urllib.request, urllib.error

HTML = os.path.expanduser('~/eva-trip-pub/index.html')
BK = os.path.expanduser('~/eva-trip-pub/backups')
KEY = 'meal2026'
TRIP_NAME = None          # None ＝自動揀（包住今日嘅行程，否則 app 上次開嗰個）


def die(m, code=1):
    print(m)
    sys.exit(code)


def cfg():
    s = open(HTML, encoding='utf-8').read()
    sb = re.search(r"var SB\s*=\s*'([^']+)'", s).group(1)
    sbk = re.search(r"var SBK\s*=\s*'([^']+)'", s).group(1)
    return sb, sbk


SB, SBK = cfg()
H = {'apikey': SBK, 'Authorization': 'Bearer ' + SBK, 'x-client-info': KEY,
     'Content-Type': 'application/json'}


def req(url, data=None, method='GET', extra=None):
    h = dict(H)
    if extra:
        h.update(extra)
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                               headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=40) as f:
            raw = f.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die('❌ 雲端報錯 %s：%s' % (e.code, e.read().decode()[:200]))


PRE = {}   # 改之前嘅原狀（備份用；備份一定要係「改之前」，唔係 undo 會變無效）


def load():
    row = req(SB + '/rest/v1/trip_log?id=eq.main&select=state,updated_at')[0]
    if not PRE:
        PRE['state'] = json.loads(json.dumps(row['state']))
        PRE['ver'] = row['updated_at']
    return row['state'], row['updated_at']


def trip_of(st):
    today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
    trips = st.get('trips') or []
    if TRIP_NAME:
        t = [x for x in trips if x['name'] == TRIP_NAME]
        if t:
            return t[0]
    live = [t for t in trips if t.get('start') and t.get('end') and t['start'] <= today <= t['end']]
    if live:
        return live[0]
    cur = (st.get('settings') or {}).get('curTrip')
    return next((t for t in trips if t['id'] == cur), trips[0] if trips else None)


def items_of(st, trip):
    return [x for x in st['items'] if x['tripId'] == trip['id']]


def find(st, trip, kw):
    kw = kw.strip().lower()
    its = items_of(st, trip)
    exact = [x for x in its if x['name'].strip().lower() == kw]
    if len(exact) == 1:
        return exact[0]
    hit = [x for x in its if kw in x['name'].lower()]
    if not hit:
        die('❌ 搵唔到「%s」。行 `list` 睇吓個名點寫。' % kw)
    if len(hit) > 1:
        print('⚠️ 「%s」撞到 %d 個，請講清楚邊個：' % (kw, len(hit)))
        for x in hit:
            print('   · %s（%s）' % (x['name'], x.get('date') or '未排期'))
        sys.exit(2)
    return hit[0]


def backup(st, ver, what):
    os.makedirs(BK, exist_ok=True)
    p = os.path.join(BK, 'state_%s.json' % time.strftime('%Y%m%d-%H%M%S'))
    json.dump({'state': PRE.get('state', st), 'updated_at': PRE.get('ver', ver), 'what': what},
              open(p, 'w'), ensure_ascii=False)
    for old in sorted(os.listdir(BK))[:-40]:      # 留最近 40 份
        os.remove(os.path.join(BK, old))
    return p


def save(st, ver, what, retry=None):
    """寫入。撞版（手機／小恩同步）會自動重做一次 —— 實測 25 秒內就會撞到。"""
    bp = backup(st, ver, what)
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out = req(SB + '/rest/v1/trip_log?id=eq.main&updated_at=eq.' + urllib.parse.quote(ver),
              {'state': st, 'updated_at': ts}, 'PATCH', {'Prefer': 'return=representation'})
    if not out:
        if retry:
            for _ in range(3):
                st2, ver2 = load()
                if retry(st2):
                    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    out = req(SB + '/rest/v1/trip_log?id=eq.main&updated_at=eq.' + urllib.parse.quote(ver2),
                              {'state': st2, 'updated_at': ts}, 'PATCH', {'Prefer': 'return=representation'})
                    if out:
                        break
                    continue
                die('❌ 資料變咗，搵唔到原本嗰項，冇寫入。')
        if not out:
            die('❌ 有人（或者你部手機）啱啱改過資料，我冇寫入。再行一次就得。')
    print('✅ %s' % what)
    print('   備份：%s（改錯行 trip_edit.py undo --yes）' % os.path.basename(bp))


def uid():
    import random, string
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))


def gcall(payload):
    return req(SB + '/functions/v1/trip-ai', payload, 'POST')


def cmd_list(args, st, trip, ver):
    day = args[0] if args else None
    its = [x for x in items_of(st, trip) if (not day or x.get('date') == day)]
    its.sort(key=lambda x: ((x.get('date') or '9999'), x.get('ord') or 0))
    print('【%s】%s～%s　共 %d 項' % (trip['name'], trip['start'], trip['end'], len(its)))
    cur = None
    for x in its:
        d = x.get('date') or '未排期'
        if d != cur:
            print(' ' + d)
            cur = d
        print('   %s%s%s%s%s' % ('✓ ' if x.get('done') else '', x['name'],
              '　' + x['time'] if x.get('time') else '',
              '　$%s' % x['cost'] if x.get('cost') else '',
              '　[標註]' if x.get('memo') else ''))


def main():
    a = [x for x in sys.argv[1:] if x != '--yes']
    yes = '--yes' in sys.argv
    if not a:
        die(__doc__)
    op = a[0]
    st, ver = load()

    if op == 'undo':
        fs = sorted(os.listdir(BK)) if os.path.isdir(BK) else []
        if not fs:
            die('❌ 冇備份可以還原')
        d = json.load(open(os.path.join(BK, fs[-1])))
        if not yes:
            die('（準備）還原到 %s 之前嘅狀態：%s。加 --yes 就做。' % (fs[-1], d.get('what')))
        # 只還原備份同現狀之間有分別嘅項目，唔係整份蓋返去 ——
        # 唔係咁樣嘅話，手機喺中間加嘅嘢會俾還原殺埋。
        snap = {y['id']: y for y in d['state']['items']}
        out = None
        for _ in range(4):
            st2, ver2 = load()
            now = {y['id']: y for y in st2['items']}
            changed = [i for i in set(snap) | set(now)
                       if json.dumps(snap.get(i), sort_keys=True) != json.dumps(now.get(i), sort_keys=True)]
            if not changed:
                print('（唔使做）而家同備份一樣。')
                return
            st2['items'] = [y for y in st2['items'] if y['id'] not in changed] + \
                           [snap[i] for i in changed if i in snap]
            for i in changed:
                if i not in snap:
                    st2.setdefault('del', {})[i] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
            out = req(SB + '/rest/v1/trip_log?id=eq.main&updated_at=eq.' + urllib.parse.quote(ver2),
                      {'state': st2, 'updated_at': ts}, 'PATCH', {'Prefer': 'return=representation'})
            if out:
                print('   還原咗 %d 個項目' % len(changed))
                break
        if not out:
            die('❌ 試咗幾次都撞版，冇還原。再行一次。')
        os.rename(os.path.join(BK, fs[-1]), os.path.join(BK, 'used-' + fs[-1]))
        print('✅ 已經還原（%s）' % d.get('what'))
        return

    trip = trip_of(st)
    if not trip:
        die('❌ 冇任何行程')

    if op == 'list':
        return cmd_list(a[1:], st, trip, ver)

    if op == 'add':
        if len(a) < 3:
            die('用法：add <日期 YYYY-MM-DD 或 ""> "地點名"')
        date, name = a[1], a[2]
        its = items_of(st, trip)
        geo = [x for x in its if x.get('date') == date and x.get('lat')]
        bias = geo[len(geo) // 2] if geo else next((x for x in its if x.get('lat')), None)
        pay = {'op': 'autocomplete', 'q': name}
        if bias:
            pay['lat'], pay['lng'] = bias['lat'], bias['lng']
        sug = (gcall(pay) or {}).get('suggestions') or []
        if not sug:
            die('❌ Google 搵唔到「%s」' % name)
        top = sug[0]
        if not yes:
            print('（準備）喺 %s 加：%s（%s）' % (date or '未排期', top['name'], top.get('addr', '')))
            if len(sug) > 1:
                print('   其他可能：' + '、'.join(s['name'] for s in sug[1:4]))
            die('加 --yes 就做。', 0)
        d = gcall({'op': 'details', 'placeId': top['placeId']}) or {}
        ts = (d.get('types') or [])
        j = ','.join(ts)
        kind = ('eat' if re.search(r'restaurant|cafe|bakery|bar|food', j) else
                'buy' if re.search(r'store|shopping_mall|supermarket', j) else
                'car' if re.search(r'airport|station|parking|car_rental', j) else
                'stay' if re.search(r'lodging|hotel', j) else 'place')
        ords = [x.get('ord') or 0 for x in its if x.get('date') == date] or [0]
        x = {'id': uid(), 'tripId': trip['id'], 'kind': kind, 'listId': None,
             'date': date or None, 'ord': max(ords) + 10, 'time': '',
             'name': d.get('name') or top['name'], 'lat': d.get('lat'), 'lng': d.get('lng'),
             'addr': d.get('addr') or '', 'note': '', 'cost': 0, 'done': False, 'checks': [],
             'placeId': d.get('placeId') or top['placeId'], 'utcOff': d.get('utcOff') or 540}
        for k_, v_ in (('rating', 'rating'), ('ratingCount', 'ratingCount'),
                       ('site', 'site'), ('phone', 'phone')):
            if d.get(v_) is not None:
                x[k_] = d[v_]
        if ts:
            x['gtypes'] = ts[:4]
        st['items'].append(x)
        return save(st, ver, '加咗「%s」落 %s' % (x['name'], date or '未排期'))

    if len(a) < 2:
        die(__doc__)
    x = find(st, trip, a[1])
    where = x.get('date') or '未排期'

    if op in ('done', 'undone'):
        want = (op == 'done')
        if x.get('done') == want:
            die('（唔使做）「%s」已經係%s。' % (x['name'], '打咗勾' if want else '未打勾'), 0)
        if not yes:
            die('（準備）%s「%s」（%s）。加 --yes 就做。' % ('打勾' if want else '拆勾', x['name'], where), 0)
        x['done'] = want
        def again(st2):
            y = next((i for i in items_of(st2, trip_of(st2)) if i['id'] == x['id']), None)
            if not y: return False
            y['done'] = want; return True
        return save(st, ver, '%s「%s」' % ('打勾' if want else '拆勾', x['name']), again)

    if op == 'time':
        t = a[2] if len(a) > 2 else ''
        if t and not re.match(r'^\d{1,2}:\d{2}$', t):
            die('❌ 時間要寫 HH:MM，例如 10:00')
        if not yes:
            die('（準備）「%s」（%s）時間改做 %s。加 --yes 就做。' % (x['name'], where, t or '（清空）'), 0)
        x['time'] = t
        def again(st2):
            y = next((i for i in st2['items'] if i['id'] == x['id']), None)
            if not y: return False
            y['time'] = t; return True
        return save(st, ver, '「%s」時間 → %s' % (x['name'], t or '清空'), again)

    if op == 'memo':
        if len(a) < 3:
            die('用法：memo "關鍵字" "要記嘅嘢"')
        add = a[2]
        if not yes:
            die('（準備）「%s」（%s）標註加一行：%s。加 --yes 就做。' % (x['name'], where, add), 0)
        old = x.get('memo') or ''
        piece = '<div>' + add.replace('&', '&amp;').replace('<', '&lt;') + '</div>'
        x['memo'] = old + piece
        def again(st2):
            y = next((i for i in st2['items'] if i['id'] == x['id']), None)
            if not y: return False
            if piece not in (y.get('memo') or ''):
                y['memo'] = (y.get('memo') or '') + piece
            return True
        return save(st, ver, '「%s」加咗標註' % x['name'], again)

    if op == 'cost':
        if len(a) < 3:
            die('用法：cost "關鍵字" 金額 [幣種]')
        amt = float(a[2])
        ccy = a[3].upper() if len(a) > 3 else 'JPY'
        if not yes:
            die('（準備）「%s」（%s）開支記 %s %s。加 --yes 就做。' % (x['name'], where, amt, ccy), 0)
        x['cost'] = amt
        x['ccy'] = ccy
        return save(st, ver, '「%s」開支 %s %s' % (x['name'], amt, ccy))

    if op == 'rename':
        if len(a) < 3:
            die('用法：rename "關鍵字" "新名"')
        if not yes:
            die('（準備）「%s」改名做「%s」。加 --yes 就做。' % (x['name'], a[2]), 0)
        old = x['name']
        x['name'] = a[2][:140]
        return save(st, ver, '「%s」改名做「%s」' % (old, x['name']))

    if op == 'move':
        d2 = a[2] if len(a) > 2 else ''
        if d2 and not re.match(r'^\d{4}-\d{2}-\d{2}$', d2):
            die('❌ 日期要寫 YYYY-MM-DD')
        if d2 and not (trip['start'] <= d2 <= trip['end']):
            die('❌ %s 唔喺行程範圍（%s～%s）' % (d2, trip['start'], trip['end']))
        if not yes:
            die('（準備）「%s」由 %s 搬去 %s。加 --yes 就做。' % (x['name'], where, d2 or '未排期'), 0)
        ords = [y.get('ord') or 0 for y in items_of(st, trip) if y.get('date') == (d2 or None)] or [0]
        x['date'] = d2 or None
        x['ord'] = max(ords) + 10
        return save(st, ver, '「%s」搬去 %s' % (x['name'], d2 or '未排期'))

    if op == 'del':
        if not yes:
            die('（準備）刪走「%s」（%s）。加 --yes 就做。' % (x['name'], where), 0)
        ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
        st.setdefault('del', {})[x['id']] = ts
        st['items'] = [y for y in st['items'] if y['id'] != x['id']]
        return save(st, ver, '刪咗「%s」' % x['name'])

    die('❌ 唔識「%s」。\n%s' % (op, __doc__))


if __name__ == '__main__':
    import urllib.parse
    main()
