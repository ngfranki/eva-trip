#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""換暗號 · 取消：刪走新加嘅三道門，即刻回到原狀（舊暗號本來一直有效）"""
import os, json, urllib.request, urllib.error
REF='lvwspnjysfyomuszzjay'
def kv(n):
    for ln in open(os.path.expanduser('~/Eva_Brain/.secrets/keys.env'), encoding='utf-8'):
        if ln.startswith(n+'='): return ln.rstrip('\n').split('=',1)[1]
AT=kv('SUPABASE_ACCESS_TOKEN')
def sql(q):
    r=urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query':q}).encode(),
        headers={'Authorization':'Bearer '+AT,'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(r, timeout=40) as f: return json.loads(f.read() or b'null')
    except urllib.error.HTTPError as e: print('  ⚠️', e.read().decode()[:200]); return None
print(__doc__)
for tbl,name in [('public.trip_log','trip_log_gate_v2'),
                 ('public.wbh_board','wbh_board_gate_v2'),
                 ('storage.objects','trip_files_gate_v2')]:
    sql(f'drop policy if exists {name} on {tbl}'); print(f'  ✅ 刪走 {name}')
print('\n已回到原狀。舊暗號照用。')
print('（TRIP_KEY 留住冇害 —— trip-ai 兩個暗號都收，舊暗號一樣通）')
