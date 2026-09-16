#!/bin/bash
# heartbeat.sh — iMac 每 5 分鐘報一次平安去雲端（launchd: com.eva.imac.heartbeat）
# 雲端 hb-check 超過 20 分鐘收唔到就經 Telegram 通知 Franki。
# 🔴 只寫 at ＋ detail，唔碰 alert_kind／alerted_at（PostgREST upsert 只更新 payload 入面嘅欄）
K="$HOME/Eva_Brain/.secrets/keys.env"
REF=$(grep '^SUPABASE_PROJECT_REF=' "$K" | cut -d= -f2-)
SRV=$(grep '^SUPABASE_SERVICE_KEY=' "$K" | cut -d= -f2-)
[ -n "$REF" ] && [ -n "$SRV" ] || exit 0

pgrep -f "eva-telegram-private/bridge.js" >/dev/null && BR=true || BR=false
pgrep -f "eva-telegram-private/responder.sh" >/dev/null && RS=true || RS=false
UP=$(uptime | sed -E 's/.*up ([^,]+),.*/\1/' | xargs)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s -m 20 -o /dev/null -X POST "https://$REF.supabase.co/rest/v1/heartbeat" \
  -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"id\":\"imac\",\"at\":\"$NOW\",\"detail\":{\"bridge\":$BR,\"responder\":$RS,\"uptime\":\"$UP\"}}"
