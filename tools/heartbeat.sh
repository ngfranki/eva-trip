#!/bin/bash
# heartbeat.sh — iMac 每 5 分鐘報一次平安去雲端（launchd: com.eva.imac.heartbeat）
# 雲端 hb-check 超過 20 分鐘收唔到就經 Telegram 通知 Franki。
# 🔴 只寫 at ＋ detail，唔碰 alert_kind／alerted_at（PostgREST upsert 只更新 payload 入面嘅欄）
K="$HOME/Eva_Brain/.secrets/keys.env"
REF=$(grep '^SUPABASE_PROJECT_REF=' "$K" | cut -d= -f2-)
# 新 secret key（sb_secret_…）優先。未放入 keys.env 之前先用舊 service_role JWT。
SRV=$(grep '^SUPABASE_SECRET_KEY=' "$K" | cut -d= -f2-)
[ -n "$SRV" ] || SRV=$(grep '^SUPABASE_SERVICE_KEY=' "$K" | cut -d= -f2-)
[ -n "$REF" ] && [ -n "$SRV" ] || exit 0
# sb_* 唔係 JWT，只放 apikey。舊 JWT 先至要 Authorization。
AUTH=()
case "$SRV" in
  eyJ*) AUTH=(-H "Authorization: Bearer $SRV") ;;
esac

pgrep -f "eva-telegram-private/bridge.js" >/dev/null && BR=true || BR=false
pgrep -f "eva-telegram-private/fastchat.py" >/dev/null && RS=true || RS=false
UP=$(uptime | sed -E 's/.*up ([^,]+),.*/\1/' | xargs)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s -m 20 -o /dev/null -X POST "https://$REF.supabase.co/rest/v1/heartbeat" \
  -H "apikey: $SRV" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"id\":\"imac\",\"at\":\"$NOW\",\"detail\":{\"bridge\":$BR,\"responder\":$RS,\"uptime\":\"$UP\"}}"
