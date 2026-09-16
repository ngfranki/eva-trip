// trip-brief — 旅程自動早／午／晚報，經小恩推去 Telegram
// 2026-09-16 立。完全喺 Supabase 雲端跑：唔靠 Franki 部 Mac、唔碰小恩嘅 long-poll
// （只「發」唔「收」，所以唔會搶走 eva-telegram-private/bridge.js 嘅 updates）。
//
// 由 pg_cron 叫（一日三次）。只喺旅程日期範圍內出聲，其餘日子靜靜哋收工。
//
// slot：
//   morning  今日全日：天氣／天黑／警報／車程／逐站
//   noon     下一站：到嗰陣開唔開門／天黑倒數／今日仲有幾多站
//   evening  聽日預覽：天氣／第一站／車程／要早起定要預約
//
// secrets：
//   SUPABASE_SERVICE_ROLE_KEY   讀 trip_log（繞過暗號閘）
//   SUPABASE_URL                同上
//   TELEGRAM_BOT_TOKEN_SIUYAN   小恩
//   TELEGRAM_CHAT_FRANKI        Franki 同小恩嘅 chat id
//   GOOGLE_MAPS_KEY             （有就計即時路況，冇就唔計）
//   BRIEF_KEY                   觸發用嘅暗號（pg_cron 帶）
//
// 免 key 嘅來源：Open-Meteo（天氣／日落）、日本氣象廳（警報）

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";

const JST_MS = 9 * 3600 * 1000;
const jstNow = () => new Date(Date.now() + JST_MS);
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

const GEO_KINDS = new Set(["place", "eat", "stay", "buy", "car"]);

function hav(a: [number, number], b: [number, number]) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function minsTxt(sec: number) {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? " " + (m % 60) + " 分" : ""}` : `${m} 分鐘`;
}
const hm2m = (s: string) => {
  const p = String(s || "0:00").split(":");
  return (+p[0] || 0) * 60 + (+p[1] || 0);
};
const m2hm = (m: number) => {
  m = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
};

// ── 日本氣象廳 ──────────────────────────────────────────────
// 🔴 JMA 會永遠保留最後一次發表 —— 實測全部地區都係 112 日前（5 月）嘅警報
//    仍然標「発表」。唔驗時間就會報四個月前嘅警報，比冇功能更危險。
const JMA_OFF = ("011000,45.40,141.75,宗谷|012000,43.77,142.37,上川・留萌|013000,43.98,144.25,網走・北見・紋別|" +
  "014030,42.92,143.20,十勝|014100,43.00,144.38,釧路・根室|015000,42.63,141.60,胆振・日高|" +
  "016000,43.06,141.35,石狩・空知・後志|017000,41.77,140.73,渡島・檜山|020000,40.82,140.74,青森|" +
  "030000,39.70,141.15,岩手|040000,38.27,140.87,宮城|050000,39.72,140.10,秋田|060000,38.24,140.36,山形|" +
  "070000,37.75,140.47,福島|080000,36.34,140.45,茨城|090000,36.57,139.88,栃木|100000,36.39,139.06,群馬|" +
  "110000,35.86,139.65,埼玉|120000,35.61,140.12,千葉|130000,35.69,139.69,東京|140000,35.45,139.64,神奈川|" +
  "150000,37.90,139.02,新潟|160000,36.70,137.21,富山|170000,36.59,136.63,石川|180000,36.07,136.22,福井|" +
  "190000,35.66,138.57,山梨|200000,36.65,138.18,長野|210000,35.39,136.72,岐阜|220000,34.98,138.38,静岡|" +
  "230000,35.18,136.91,愛知|240000,34.73,136.51,三重|250000,35.00,135.87,滋賀|260000,35.02,135.76,京都|" +
  "270000,34.69,135.52,大阪|280000,34.69,135.18,兵庫|290000,34.69,135.83,奈良|300000,34.23,135.17,和歌山|" +
  "310000,35.50,134.24,鳥取|320000,35.47,133.05,島根|330000,34.66,133.93,岡山|340000,34.40,132.46,広島|" +
  "350000,34.19,131.47,山口|360000,34.07,134.56,徳島|370000,34.34,134.04,香川|380000,33.84,132.77,愛媛|" +
  "390000,33.56,133.53,高知|400000,33.61,130.42,福岡|410000,33.25,130.30,佐賀|420000,32.74,129.87,長崎|" +
  "430000,32.79,130.74,熊本|440000,33.24,131.61,大分|450000,31.91,131.42,宮崎|460040,28.38,129.49,奄美|" +
  "460100,31.56,130.56,鹿児島|471000,26.21,127.68,沖縄本島|472000,25.83,131.23,大東島|473000,24.81,125.28,宮古島|" +
  "474000,24.34,124.16,八重山").split("|").map((r) => {
    const a = r.split(",");
    return { c: a[0], lat: +a[1], lng: +a[2], n: a[3] };
  });

const JMA_W: Record<string, string> = {
  "02": "暴風雪警報（吹雪）", "03": "大雨警報", "04": "洪水警報", "05": "暴風警報",
  "06": "大雪警報", "07": "波浪警報", "08": "高潮警報",
  "10": "大雨注意報", "12": "大雪注意報", "13": "風雪注意報（吹雪）", "14": "雷注意報",
  "15": "強風注意報", "16": "波浪注意報", "17": "融雪注意報", "18": "洪水注意報",
  "19": "高潮注意報", "20": "濃霧注意報（能見度）", "21": "乾燥注意報",
  "22": "なだれ注意報（雪崩）", "23": "低温注意報", "24": "霜注意報",
  "25": "着雪注意報", "26": "着氷注意報（結冰）", "27": "其他注意報",
  "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報",
  "36": "大雪特別警報", "37": "波浪特別警報", "38": "高潮特別警報",
};
const JMA_DRIVE = new Set(["12", "13", "15", "17", "20", "22", "23", "25", "26"]);
const JMA_SEVERE = new Set(["02", "05", "06", "32", "35", "36"]);

async function jma(lat: number, lng: number): Promise<string | null> {
  let best = null as null | { c: string; n: string }, bd = 1e9;
  for (const o of JMA_OFF) {
    const d = hav([lat, lng], [o.lat, o.lng]);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best || bd > 600) return null;
  try {
    const r = await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${best.c}.json`,
      { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rt = Date.parse(j.reportDatetime || "");
    if (!rt || (Date.now() - rt) / 3600000 > 12) return null;   // 🔴 過期就當冇警報
    const codes = new Set<string>();
    for (const at of j.areaTypes ?? []) {
      for (const a of at.areas ?? []) {
        for (const w of a.warnings ?? []) {
          if (w.status && w.status !== "解除") codes.add(w.code);
        }
      }
    }
    if (!codes.size) return null;
    const show: string[] = [];
    let other = 0, severe = false;
    for (const c of [...codes].sort()) {
      if (JMA_SEVERE.has(c)) severe = true;
      const nm = JMA_W[c];
      if (!nm) { other++; continue; }
      if (JMA_DRIVE.has(c) || +c < 10 || +c > 31) show.push(nm);
      else other++;
    }
    if (!show.length) return null;
    const t = new Date(rt + JST_MS);
    return `${severe ? "🚨" : "⚠️"} ${best.n}：${show.join("、")}${other ? `（＋${other} 項）` : ""}  [${hhmm(t)} 發表]`;
  } catch { return null; }
}

// ── 天氣（Open-Meteo，免 key）─────────────────────────────
type Wx = { mx: number | null; mn: number | null; pr: number; sn: number; wind: number; set: string; now?: number };
async function weather(lat: number, lng: number, ds: string, withNow = false): Promise<Wx | null> {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,sunset,windspeed_10m_max` +
    (withNow ? "&current=temperature_2m,precipitation,snowfall" : "") +
    `&timezone=auto&start_date=${ds}&end_date=${ds}`;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = await r.json();
    const d = j.daily;
    if (!d?.time?.length) return null;
    return {
      mx: d.temperature_2m_max?.[0] ?? null, mn: d.temperature_2m_min?.[0] ?? null,
      pr: d.precipitation_sum?.[0] ?? 0, sn: d.snowfall_sum?.[0] ?? 0,
      wind: d.windspeed_10m_max?.[0] ?? 0,
      set: String(d.sunset?.[0] ?? "").slice(-5),
      now: j.current?.temperature_2m ?? undefined,
    };
  } catch { return null; }
}
function wxLine(w: Wx | null) {
  if (!w || w.mx == null) return null;
  const b = [`${Math.round(w.mn!)}°~${Math.round(w.mx)}°`];
  if (w.sn > 0) b.push(`❄️ 雪 ${w.sn.toFixed(0)}cm`);
  else if (w.pr >= 1) b.push(`☔️ 雨 ${w.pr.toFixed(0)}mm`);
  if (w.wind >= 40) b.push(`💨 風 ${w.wind.toFixed(0)}km/h`);
  if (w.set) b.push(`🌇 ${w.set} 天黑`);
  return b.join("　");
}

// ── 行程資料 ────────────────────────────────────────────────
async function loadState() {
  const url = env("SUPABASE_URL") + "/rest/v1/trip_log?id=eq.main&select=state";
  const k = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(url, { headers: { apikey: k, Authorization: "Bearer " + k } });
  if (!r.ok) throw new Error("trip_log " + r.status);
  const rows = await r.json();
  return rows?.[0]?.state ?? null;
}

// 🔴 唔可以只靠 settings.curTrip —— 嗰個係「app 入面而家揭開邊個旅程」。
//    如果出門前你最後揭嘅係另一個旅程，早報就會因為日期對唔上而全程靜音，
//    而你唔會知。所以：先揀「今日落喺出發～返程之間」嗰個，冇才用 curTrip。
function pickTrip(state: any, today: string) {
  const trips = state.trips ?? [];
  const live = trips.filter((t: any) => t.start && t.end && t.start <= today && today <= t.end);
  if (live.length) {
    // 多過一個就揀最短嗰個（最貼「而家真係去緊」）
    live.sort((a: any, b: any) => (Date.parse(a.end) - Date.parse(a.start)) - (Date.parse(b.end) - Date.parse(b.start)));
    return live[0];
  }
  const cur = state.settings?.curTrip;
  return trips.find((t: any) => t.id === cur) ?? trips[0] ?? null;
}
function dayItems(state: any, tripId: string, ds: string) {
  return (state.items ?? [])
    .filter((x: any) => x.tripId === tripId && x.date === ds)
    .sort((a: any, b: any) => (a.ord ?? 0) - (b.ord ?? 0));
}
function centroid(items: any[]) {
  const g = items.filter((x) => GEO_KINDS.has(x.kind) && x.lat != null);
  if (!g.length) return null;
  return {
    lat: g.reduce((s, x) => s + +x.lat, 0) / g.length,
    lng: g.reduce((s, x) => s + +x.lng, 0) / g.length,
  };
}
// 營業時間：Google 存落 hours[]（週一起）。回一句「唔對路」嘅提醒，冇事回 null
function hoursWarn(x: any, ds: string, atMin: number | null) {
  const hrs: string[] = x.hours ?? [];
  if (!hrs.length) return null;
  const dow = new Date(ds + "T00:00:00Z").getUTCDay();          // 0=日
  const line = hrs[dow === 0 ? 6 : dow - 1] ?? "";
  if (/closed|休|定休/i.test(line) && !/24/.test(line)) return `${line}`;
  if (atMin == null) return null;
  // 抽最後一個時間（收工）
  const ms = [...line.matchAll(/(\d{1,2})[:：](\d{2})\s*(am|pm|AM|PM)?/g)];
  if (ms.length < 2) return null;
  const last = ms[ms.length - 1];
  let h = +last[1];
  const ap = (last[3] ?? "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const close = h * 60 + (+last[2]);
  if (atMin > close) return `⚠️ ${m2hm(atMin)} 到，但 ${m2hm(close)} 關門`;
  if (close - atMin <= 45) return `⏳ ${m2hm(close)} 關門，只剩 ${close - atMin} 分鐘`;
  return null;
}

// 即場問 Google 計全日車程。起點沿用 app 嘅規矩：前一日住嘅地方優先。
async function liveRoute(state: any, trip: any, ds: string) {
  const key = env("GOOGLE_MAPS_KEY");
  if (!key) return null;
  const own = dayItems(state, trip.id, ds)
    .filter((x: any) => GEO_KINDS.has(x.kind) && x.lat != null && x.lng != null);
  if (!own.length) return null;
  const prev = dstr(new Date(Date.parse(ds) - 86400000));
  const pd = dayItems(state, trip.id, prev)
    .filter((x: any) => GEO_KINDS.has(x.kind) && x.lat != null && x.lng != null);
  const org = [...pd].reverse().find((x: any) => x.kind === "stay") ?? pd[pd.length - 1];
  const pts = [...(org ? [org] : []), ...own].map((x: any) => ({
    location: { latLng: { latitude: +x.lat, longitude: +x.lng } },
  }));
  if (pts.length < 2) return null;
  const firstT = (own.find((x: any) => x.time)?.time) ?? "09:00";
  const depMs = Date.parse(`${ds}T${firstT}:00+09:00`);
  const traffic = depMs > Date.now() + 5 * 60000;
  const payload: Record<string, unknown> = {
    origin: pts[0], destination: pts[pts.length - 1], travelMode: "DRIVE",
    languageCode: "zh-HK", units: "METRIC",
  };
  if (pts.length > 2) payload.intermediates = pts.slice(1, -1);
  if (traffic) {
    payload.routingPreference = "TRAFFIC_AWARE";
    payload.departureTime = new Date(depMs).toISOString();
  }
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const rt0 = j.routes?.[0];
    if (!rt0) return null;
    const sec = typeof rt0.duration === "string" ? parseInt(rt0.duration) : +(rt0.duration ?? 0);
    return { totalSec: sec || 0, totalM: rt0.distanceMeters ?? 0, traffic };
  } catch { return null; }
}

// ── 三種報告 ────────────────────────────────────────────────
async function build(slot: string, state: any, dsOverride?: string) {
  const now = jstNow();
  const today = dsOverride ?? dstr(now);
  const trip = pickTrip(state, today);
  if (!trip) return null;
  const target = slot === "evening" ? dstr(new Date(Date.parse(today) + 86400000)) : today;

  const { start, end } = trip;
  if (!start || !end) return null;
  // 晚報講聽日，所以今日係最後一日嘅晚上就唔使出
  const inRange = start <= today && today <= end;
  if (!inRange) return null;
  if (slot === "evening" && target > end) return null;

  const items = dayItems(state, trip.id, target);
  const allItems = (state.items ?? []).filter((x: any) => x.tripId === trip.id);
  const pt = centroid(items) ?? centroid(allItems);
  if (!pt) return null;

  const d0 = Date.parse(start);
  const dn = Math.round((Date.parse(target) - d0) / 86400000) + 1;
  const total = Math.round((Date.parse(end) - d0) / 86400000) + 1;

  // 🔴 state.routes 只有「你喺 app 揭開過嗰日」才有（實測「日本之旅 2026」0/15 日）。
  //    冇就自己問 Google，唔好靜靜哋少一行。
  let rt = state.routes?.[`${trip.id}|${target}`];
  if (!rt?.totalSec) rt = await liveRoute(state, trip, target);
  const driveLine = rt?.totalSec
    ? `🚗 全日車程 ${minsTxt(rt.totalSec)}　${((rt.totalM ?? 0) / 1000).toFixed(0)}km${rt.traffic ? "（計路況）" : ""}`
    : null;

  const L: string[] = [];

  if (slot === "morning") {
    L.push(`☀️ 早晨。${trip.name}　第 ${dn}/${total} 日`);
    const w = wxLine(await weather(pt.lat, pt.lng, target));
    if (w) L.push(w);
    const jw = await jma(pt.lat, pt.lng);
    if (jw) L.push(jw);
    if (driveLine) L.push(driveLine);
    if (!items.length) L.push("\n今日冇安排。");
    else {
      L.push("");
      for (const x of items) {
        L.push(`${x.done ? "✅" : "·"} ${x.time ? x.time + "　" : ""}${x.name}`.slice(0, 70));
        const hint: string[] = [];
        if (x.conf) hint.push(`編號 ${x.conf}`);
        if ((x.files ?? []).length) hint.push(`附件 ${x.files.length}`);
        const hw = hoursWarn(x, target, x.time ? hm2m(x.time) : null);
        if (hw) hint.push(hw);
        if (hint.length) L.push("　　" + hint.join(" · "));
      }
    }
  } else if (slot === "noon") {
    const left = items.filter((x: any) => !x.done);
    const nx = left[0];
    L.push(`🕛 ${trip.name}　第 ${dn}/${total} 日`);
    const w = await weather(pt.lat, pt.lng, target, true);
    const wl = wxLine(w);
    if (wl) L.push(wl);
    const jw = await jma(pt.lat, pt.lng);
    if (jw) L.push(jw);
    if (!nx) L.push("\n今日嘅安排全部打咗勾 👍");
    else {
      L.push(`\n下一站：${nx.name}`);
      if (nx.time) L.push(`　排咗 ${nx.time}`);
      if (nx.addr) L.push(`　${String(nx.addr).slice(0, 48)}`);
      const hw = hoursWarn(nx, target, nx.time ? hm2m(nx.time) : null);
      if (hw) L.push("　" + hw);
      if (nx.conf) L.push(`　編號 ${nx.conf}`);
      if (left.length > 1) L.push(`\n今日仲有 ${left.length} 個（共 ${items.length}）`);
      if (w?.set) {
        const nowMin = (now.getUTCHours() * 60 + now.getUTCMinutes());
        const setMin = hm2m(w.set);
        if (setMin > nowMin) L.push(`🌇 ${w.set} 天黑，仲有 ${minsTxt((setMin - nowMin) * 60)}`);
      }
    }
  } else {   // evening → 講聽日
    L.push(`🌙 聽日：${trip.name}　第 ${dn}/${total} 日　${target.slice(5).replace("-", "/")}`);
    const w = wxLine(await weather(pt.lat, pt.lng, target));
    if (w) L.push(w);
    if (driveLine) L.push(driveLine);
    if (!items.length) L.push("\n聽日冇安排。");
    else {
      const first = items.find((x: any) => x.time) ?? items[0];
      L.push(`\n第一站：${first.time ? first.time + "　" : ""}${first.name}`);
      const early = first.time && hm2m(first.time) <= 8 * 60 + 30;
      if (early) L.push("　⏰ 要早起");
      const needs = items.filter((x: any) => /預約|reserve|booking|要訂/i.test(x.note ?? "") || x.conf);
      if (needs.length) {
        L.push("\n有訂單／要預約：");
        for (const x of needs.slice(0, 5)) L.push(`　· ${x.name}${x.conf ? `（${x.conf}）` : ""}`);
      }
      L.push(`\n共 ${items.length} 個安排`);
    }
  }

  L.push("\nhttps://ngfranki.github.io/eva-trip/");
  return L.join("\n");
}

async function sendTg(text: string) {
  const tok = env("TELEGRAM_BOT_TOKEN_SIUYAN"), chat = env("TELEGRAM_CHAT_FRANKI");
  if (!tok || !chat) return { ok: false, why: "冇 TELEGRAM_BOT_TOKEN_SIUYAN 或 TELEGRAM_CHAT_FRANKI" };
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, why: j.description ?? "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  // 觸發閘：pg_cron 帶 BRIEF_KEY
  const want = env("BRIEF_KEY");
  if (!want || body.key !== want) return json({ error: "unauthorized" }, 401);

  const slot = ["morning", "noon", "evening"].includes(body.slot) ? body.slot : "morning";
  try {
    const state = await loadState();
    if (!state) return json({ sent: false, why: "冇 state" });
    const text = await build(slot, state, typeof body.date === "string" ? body.date : undefined);
    if (!text) return json({ sent: false, why: "唔喺旅程期間，唔出聲", slot });
    if (body.dry) return json({ sent: false, dry: true, slot, text });
    const s = await sendTg(text);
    return json({ sent: s.ok, why: s.why, slot, chars: text.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
