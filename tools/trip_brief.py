#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""
trip_brief.py — 旅程早報，經小恩（@Personal_franki_bot）推去 Telegram
2026-09-16 立。

一日一次（launchd 叫），只喺旅程期間出聲；唔喺旅程日期範圍就靜靜咁收工。
內容：第幾日 · 天氣 · 天黑 · 全日車程 · 逐站（時間） · 氣象廳警報

為什麼要有：自駕遊最緊要嘅兩樣係「今日幾點天黑」同「尾班車／關門時間」，
而呢兩樣都要開 app 碌先睇到。推去 Telegram 就唔使做嘢都知，
而且 Telegram 用數據極少，山區訊號差都收得到。

資料來源：
  · 旅程：Supabase trip_log（用 service key，唔經暗號閘）
  · 天氣／日落：Open-Meteo（免 key）
  · 警報：日本氣象廳（免 key）
    🔴 JMA 會永遠保留最後一次發表 —— 一定要驗 reportDatetime，
       超過 12 個鐘就當冇生效中嘅警報（唔係會報四個月前嘅警報）

用法：
  trip_brief.py            正常跑（唔喺旅程期間就唔出聲）
  trip_brief.py --dry      只印出嚟，唔send
  trip_brief.py --date 2026-12-18   指定日期（測試用）
  trip_brief.py --force    就算唔喺旅程期間都出（測試用）
"""
import os, sys, json, math, datetime, urllib.request, urllib.parse, urllib.error

KEYS = os.path.expanduser('~/Eva_Brain/.secrets/keys.env')
CHAT = '8862911059'                     # Franki 同小恩嘅對話
HKT  = datetime.timezone(datetime.timedelta(hours=8))
JST  = datetime.timezone(datetime.timedelta(hours=9))


def kv(name):
    with open(KEYS, encoding='utf-8') as f:
        for ln in f:
            if ln.startswith(name + '='):
                return ln.rstrip('\n').split('=', 1)[1]
    sys.exit(f'keys.env 搵唔到 {name}')


def get(url, timeout=25):
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as f:
            return json.loads(f.read())
    except Exception:
        return None


def tg(text):
    tok = kv('TELEGRAM_BOT_TOKEN_SIUYAN')
    data = urllib.parse.urlencode({'chat_id': CHAT, 'text': text,
                                   'disable_web_page_preview': 'true'}).encode()
    try:
        with urllib.request.urlopen(
                urllib.request.Request(f'https://api.telegram.org/bot{tok}/sendMessage', data=data),
                timeout=25) as f:
            return json.loads(f.read()).get('ok', False)
    except Exception as e:
        print('send 失敗：', e)
        return False


# ── 旅程資料 ──────────────────────────────────────────────
def load_state():
    ref = kv('SUPABASE_PROJECT_REF')
    srv = kv('SUPABASE_SERVICE_KEY')
    url = f'https://{ref}.supabase.co/rest/v1/trip_log?id=eq.main&select=state'
    r = urllib.request.Request(url, headers={'apikey': srv, 'Authorization': 'Bearer ' + srv})
    with urllib.request.urlopen(r, timeout=30) as f:
        rows = json.loads(f.read())
    if not rows:
        sys.exit('trip_log 冇資料')
    return rows[0]['state']


def hav(a, b):
    R = 6371.0
    dlat = math.radians(b[0] - a[0]); dlon = math.radians(b[1] - a[1])
    s = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) *
         math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s))


GEO_KINDS = {'place', 'eat', 'stay', 'buy', 'car'}


def mins_txt(sec):
    m = max(1, round(sec / 60))
    return f'{m // 60} 小時{" " + str(m % 60) + " 分" if m % 60 else ""}' if m >= 60 else f'{m} 分鐘'


# ── 天氣／日落（Open-Meteo，免 key）────────────────────────
def weather(lat, lng, ds):
    u = (f'https://api.open-meteo.com/v1/forecast?latitude={lat:.4f}&longitude={lng:.4f}'
         f'&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,'
         f'sunset,weathercode,windspeed_10m_max&timezone=auto&start_date={ds}&end_date={ds}')
    j = get(u)
    if not j or 'daily' not in j:
        return None
    d = j['daily']
    if not d.get('time'):
        return None
    pick = lambda k: (d.get(k) or [None])[0]
    return {'mx': pick('temperature_2m_max'), 'mn': pick('temperature_2m_min'),
            'pr': pick('precipitation_sum'), 'sn': pick('snowfall_sum'),
            'set': (pick('sunset') or '')[-5:], 'wind': pick('windspeed_10m_max')}


# ── 日本氣象廳警報 ────────────────────────────────────────
JMA_OFF = [t.split(',') for t in (
    '011000,45.40,141.75,宗谷|012000,43.77,142.37,上川・留萌|013000,43.98,144.25,網走・北見・紋別|'
    '014030,42.92,143.20,十勝|014100,43.00,144.38,釧路・根室|015000,42.63,141.60,胆振・日高|'
    '016000,43.06,141.35,石狩・空知・後志|017000,41.77,140.73,渡島・檜山|020000,40.82,140.74,青森|'
    '030000,39.70,141.15,岩手|040000,38.27,140.87,宮城|050000,39.72,140.10,秋田|060000,38.24,140.36,山形|'
    '070000,37.75,140.47,福島|080000,36.34,140.45,茨城|090000,36.57,139.88,栃木|100000,36.39,139.06,群馬|'
    '110000,35.86,139.65,埼玉|120000,35.61,140.12,千葉|130000,35.69,139.69,東京|140000,35.45,139.64,神奈川|'
    '150000,37.90,139.02,新潟|160000,36.70,137.21,富山|170000,36.59,136.63,石川|180000,36.07,136.22,福井|'
    '190000,35.66,138.57,山梨|200000,36.65,138.18,長野|210000,35.39,136.72,岐阜|220000,34.98,138.38,静岡|'
    '230000,35.18,136.91,愛知|240000,34.73,136.51,三重|250000,35.00,135.87,滋賀|260000,35.02,135.76,京都|'
    '270000,34.69,135.52,大阪|280000,34.69,135.18,兵庫|290000,34.69,135.83,奈良|300000,34.23,135.17,和歌山|'
    '310000,35.50,134.24,鳥取|320000,35.47,133.05,島根|330000,34.66,133.93,岡山|340000,34.40,132.46,広島|'
    '350000,34.19,131.47,山口|360000,34.07,134.56,徳島|370000,34.34,134.04,香川|380000,33.84,132.77,愛媛|'
    '390000,33.56,133.53,高知|400000,33.61,130.42,福岡|410000,33.25,130.30,佐賀|420000,32.74,129.87,長崎|'
    '430000,32.79,130.74,熊本|440000,33.24,131.61,大分|450000,31.91,131.42,宮崎|460040,28.38,129.49,奄美|'
    '460100,31.56,130.56,鹿児島|471000,26.21,127.68,沖縄本島|472000,25.83,131.23,大東島|473000,24.81,125.28,宮古島|'
    '474000,24.34,124.16,八重山').split('|')]

JMA_W = {
    '02': '暴風雪警報（吹雪）', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報',
    '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
    '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報（吹雪）', '14': '雷注意報',
    '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '18': '洪水注意報',
    '19': '高潮注意報', '20': '濃霧注意報（能見度）', '21': '乾燥注意報',
    '22': 'なだれ注意報（雪崩）', '23': '低温注意報', '24': '霜注意報',
    '25': '着雪注意報', '26': '着氷注意報（結冰）', '27': '其他注意報',
    '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報',
    '36': '大雪特別警報', '37': '波浪特別警報', '38': '高潮特別警報',
}
# 自駕要睇嘅注意報（其餘只計數）
JMA_DRIVE = {'12', '13', '15', '17', '20', '22', '23', '25', '26'}


def jma(lat, lng):
    """回 (一句話, 有冇嚴重警報)。冇事就回 (None, False)。"""
    best, bd = None, 1e9
    for c, la, lo, n in JMA_OFF:
        d = hav([lat, lng], [float(la), float(lo)])
        if d < bd:
            bd, best = d, (c, n)
    if not best or bd > 600:
        return None, False
    code, name = best
    j = get(f'https://www.jma.go.jp/bosai/warning/data/warning/{code}.json')
    if not j:
        return f'⚠️ 攞唔到氣象廳警報（{name}）', False
    # 🔴 JMA 會永遠保留最後一次發表 —— 一定要驗時間
    try:
        rt = datetime.datetime.fromisoformat(j.get('reportDatetime', ''))
        age_h = (datetime.datetime.now(rt.tzinfo) - rt).total_seconds() / 3600
    except Exception:
        return None, False
    if age_h > 12:
        return None, False
    codes = set()
    for at in j.get('areaTypes', []):
        for a in at.get('areas', []):
            for w in a.get('warnings', []):
                if w.get('status') and w['status'] != '解除':
                    codes.add(w.get('code'))
    if not codes:
        return None, False
    warn = [JMA_W[c] for c in sorted(codes) if c in JMA_W and (c in JMA_DRIVE or int(c) < 10 or int(c) > 31)]
    other = len(codes) - len(warn)
    severe = any(c in codes for c in ('02', '05', '06', '32', '35', '36'))
    if not warn:
        return None, False
    head = '🚨' if severe else '⚠️'
    txt = f'{head} {name}：' + '、'.join(warn) + (f'（＋{other} 項）' if other else '')
    txt += f'  [{rt:%H:%M} 發表]'
    return txt, severe


# ── 組早報 ────────────────────────────────────────────────
def build(state, ds, force=False):
    trips = state.get('trips') or []
    cur = (state.get('settings') or {}).get('curTrip')
    trip = next((t for t in trips if t.get('id') == cur), None) or (trips[0] if trips else None)
    if not trip:
        return None
    start, end = trip.get('start'), trip.get('end')
    if not force and not (start and end and start <= ds <= end):
        return None

    items = [x for x in (state.get('items') or []) if x.get('tripId') == trip['id']]
    day = sorted([x for x in items if x.get('date') == ds], key=lambda x: x.get('ord') or 0)

    d0 = datetime.date.fromisoformat(start) if start else datetime.date.fromisoformat(ds)
    dn = (datetime.date.fromisoformat(ds) - d0).days + 1
    total = ((datetime.date.fromisoformat(end) - d0).days + 1) if end else dn

    L = [f'🗓 {trip.get("name","旅程")}　第 {dn}/{total} 日　{ds[5:].replace("-","/")}']

    geo = [x for x in day if x.get('kind') in GEO_KINDS and x.get('lat') is not None]
    if geo:
        lat = sum(float(x['lat']) for x in geo) / len(geo)
        lng = sum(float(x['lng']) for x in geo) / len(geo)
    else:
        allg = [x for x in items if x.get('lat') is not None]
        if not allg:
            return None
        lat = sum(float(x['lat']) for x in allg) / len(allg)
        lng = sum(float(x['lng']) for x in allg) / len(allg)

    w = weather(lat, lng, ds)
    if w and w['mx'] is not None:
        bits = [f'{round(w["mn"])}°~{round(w["mx"])}°']
        if (w['sn'] or 0) > 0:
            bits.append(f'❄️ 雪 {w["sn"]:.0f}cm')
        elif (w['pr'] or 0) >= 1:
            bits.append(f'☔️ 雨 {w["pr"]:.0f}mm')
        if (w['wind'] or 0) >= 40:
            bits.append(f'💨 風 {w["wind"]:.0f}km/h')
        if w['set']:
            bits.append(f'🌇 {w["set"]} 天黑')
        L.append('　'.join(bits))

    jtxt, severe = jma(lat, lng)
    if jtxt:
        L.append(jtxt)

    rt = (state.get('routes') or {}).get(f'{trip["id"]}|{ds}')
    if rt and rt.get('totalSec'):
        km = (rt.get('totalM') or 0) / 1000
        L.append(f'🚗 全日車程 {mins_txt(rt["totalSec"])}　{km:.0f}km'
                 + ('（計路況）' if rt.get('traffic') else ''))

    if not day:
        L.append('\n今日冇安排。')
    else:
        L.append('')
        done = 0
        for x in day:
            if x.get('done'):
                done += 1
            tm = x.get('time') or ''
            mark = '✅' if x.get('done') else '·'
            line = f'{mark} {tm + "　" if tm else ""}{x.get("name","")}'
            L.append(line[:70])
            hint = []
            if x.get('conf'):
                hint.append(f'編號 {x["conf"]}')
            if (x.get('files') or []):
                hint.append(f'附件 {len(x["files"])}')
            if hint:
                L.append('　　' + ' · '.join(hint))
        if done:
            L.append(f'\n（已去 {done}/{len(day)}）')

    L.append('\nhttps://ngfranki.github.io/eva-trip/')
    return '\n'.join(L)


def main():
    args = sys.argv[1:]
    dry = '--dry' in args
    force = '--force' in args
    ds = None
    if '--date' in args:
        ds = args[args.index('--date') + 1]
    if not ds:
        ds = datetime.datetime.now(JST).date().isoformat()

    state = load_state()
    msg = build(state, ds, force)
    if not msg:
        print(f'{ds}：唔喺旅程期間，唔出聲。')
        return
    print(msg)
    if dry:
        print('\n[--dry：冇 send]')
        return
    print('\nsend →', 'ok' if tg(msg) else 'FAILED')


if __name__ == '__main__':
    main()
