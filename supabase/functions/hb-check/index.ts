// hb-check — 小恩／iMac 心跳監察
// 2026-09-16 立。
//
// 為什麼要有：iMac 開咗 FileVault、冇自動登入、又開咗 macOS 自動安裝更新。
// 半夜自動更新 → 重啟 → 停喺 FileVault 密碼畫面 → 冇人登入 → LaunchAgent 唔行
// → 小恩死咗。Franki 喺外地嘅話，會成個旅程都冇聲而唔知點解。
// （2026-09-16 08:29 就真係重啟過一次。）
//
// 做法：iMac 每 5 分鐘寫一次心跳入 heartbeat 表（tools/heartbeat.sh）。
// pg_cron 每 10 分鐘叫呢個 function 檢查：超過 20 分鐘冇心跳就經 Telegram 通知。
// 🔴 通知唔經 iMac —— 直接由雲端叫 Telegram bot API，所以 iMac 死咗都送得到。
//
// 去重：一次斷線只通知一次；恢復之後再發一句「返嚟喇」。

const env = (k: string) => Deno.env.get(k) ?? "";
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const STALE_MIN = 20;

async function db(path: string, init: RequestInit = {}) {
  const k = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function tg(text: string) {
  const tok = env("TELEGRAM_BOT_TOKEN_SIUYAN"), chat = env("TELEGRAM_CHAT_FRANKI");
  if (!tok || !chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  return (await r.json().catch(() => ({}))).ok === true;
}

const hkt = (ms: number) => {
  const d = new Date(ms + 8 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (!env("BRIEF_KEY") || body.key !== env("BRIEF_KEY")) return json({ error: "unauthorized" }, 401);

  const r = await db("heartbeat?id=eq.imac&select=at,detail,alert_kind,alerted_at");
  if (!r.ok) return json({ error: "heartbeat table " + r.status }, 500);
  const row = (await r.json())?.[0];
  if (!row) return json({ ok: true, why: "未有心跳紀錄（未裝 heartbeat.sh？）" });

  const at = Date.parse(row.at);
  const ageMin = (Date.now() - at) / 60000;
  const det = row.detail ?? {};
  const kind: string | null = row.alert_kind ?? null;      // null | 'offline' | 'proc'
  const stale = ageMin > STALE_MIN;
  const procDown = !stale && (det.bridge === false || det.responder === false);

  // 狀態機：每種狀態只通知一次；恢復先發一句，唔會亂報「返嚟喇」
  const setKind = (k: string | null) => db("heartbeat?id=eq.imac", {
    method: "PATCH",
    body: JSON.stringify({ alert_kind: k, alerted_at: k ? new Date().toISOString() : null }),
  });

  if (stale) {
    if (kind === "offline") return json({ ok: true, state: "offline（已通知過）", ageMin: Math.round(ageMin) });
    const ok = await tg(
      `⚠️ 小恩斷咗線\n\n` +
      `iMac 已經 ${Math.round(ageMin)} 分鐘冇報平安（最後 ${hkt(at)}）。\n\n` +
      `最可能係：半夜自動更新重啟咗，停咗喺 FileVault 密碼畫面，冇人登入。\n` +
      `要人喺 iMac 前面打一次密碼就會返嚟。\n\n` +
      `（其他可能：停電、屋企斷網。）\n` +
      `呢條係雲端直接發，唔經 iMac。`);
    if (ok) await setKind("offline");
    return json({ alerted: ok, state: "offline", ageMin: Math.round(ageMin) });
  }

  if (procDown) {
    if (kind === "proc") return json({ ok: true, state: "proc（已通知過）" });
    const which = [det.bridge === false ? "bridge" : "", det.responder === false ? "responder" : ""]
      .filter(Boolean).join("、");
    const ok = await tg(`⚠️ iMac 喺線，但小恩嘅 ${which} 冇行 —— 收唔到你嘅訊息。\n` +
      `launchd 應該會自己重啟佢；如果 20 分鐘後都冇「返嚟喇」，就要人手睇。`);
    if (ok) await setKind("proc");
    return json({ alerted: ok, state: "proc" });
  }

  // 健康
  if (kind) {
    const ok = await tg(kind === "offline"
      ? `🌿 小恩返嚟喇 —— iMac 重新報平安（${hkt(at)}）。`
      : `🌿 小恩返嚟喇 —— process 已經重新行緊。`);
    if (ok) await setKind(null);
    return json({ recovered: ok, from: kind });
  }
  return json({ ok: true, state: "healthy", ageMin: Math.round(ageMin * 10) / 10, detail: det });
});
