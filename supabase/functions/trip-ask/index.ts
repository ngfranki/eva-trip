// trip-ask — 「識你行程」嘅問答端點
// 2026-09-16 立。為 Rokid Glasses／任何細螢幕而做：一句問題入，一兩行答案出。
//
// 為什麼要有：Rokid 自己個 AI 係通用問答，唔知你個行程。呢個端點會喺答之前
// 先把「你今日／聽日嘅真行程 ＋ 天氣 ＋ 氣象警報 ＋ 車程」塞落 context，
// 所以答得出「下一站幾點關門」「今日仲有幾多站」呢類只有你行程才知嘅嘢。
//
// 🔴 Rokid 嘅「換自己 AI 做語音助手」（cloud OpenAPI / BYO-model agent）要企業帳戶，
//    個人用戶行唔到。所以呢個端點做成「任何 client 都叫得到」：
//    眼鏡上面嘅 JSAR web app、手機、瀏覽器書籤、甚至 Telegram 都得。
//
// 用法：
//   POST { key, q, fmt?, lat?, lng? }
//     key  = ASK_KEY（同 BRIEF_KEY 分開，眼鏡上面嗰個洩漏都唔會影響推播）
//     q    = 問題
//     fmt  = 'hud'（預設，≤2 行、≤90 字、冇 emoji）｜'full'（長少少）
//     lat/lng = 有就當你而家喺嗰度（眼鏡傳唔傳得到要實測）
//   → { text, ms }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";

const JST_MS = 9 * 3600 * 1000;
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const GEO = new Set(["place", "eat", "stay", "buy", "car"]);

function hav(a: [number, number], b: [number, number]) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const DOWZH = ["日", "一", "二", "三", "四", "五", "六"];

async function loadState() {
  const k = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/trip_log?id=eq.main&select=state",
    { headers: { apikey: k, Authorization: "Bearer " + k } });
  if (!r.ok) throw new Error("trip_log " + r.status);
  return (await r.json())?.[0]?.state ?? null;
}

// 揀「今日真係去緊」嗰個旅程（唔靠 app 入面揭開邊個）
function pickTrip(state: any, today: string) {
  const trips = state.trips ?? [];
  const live = trips.filter((t: any) => t.start && t.end && t.start <= today && today <= t.end);
  if (live.length) {
    live.sort((a: any, b: any) =>
      (Date.parse(a.end) - Date.parse(a.start)) - (Date.parse(b.end) - Date.parse(b.start)));
    return live[0];
  }
  const cur = state.settings?.curTrip;
  return trips.find((t: any) => t.id === cur) ?? trips[0] ?? null;
}
const dayItems = (state: any, tid: string, ds: string) =>
  (state.items ?? []).filter((x: any) => x.tripId === tid && x.date === ds)
    .sort((a: any, b: any) => (a.ord ?? 0) - (b.ord ?? 0));

function centroid(items: any[]) {
  const g = items.filter((x: any) => GEO.has(x.kind) && x.lat != null);
  if (!g.length) return null;
  return { lat: g.reduce((s, x) => s + +x.lat, 0) / g.length, lng: g.reduce((s, x) => s + +x.lng, 0) / g.length };
}

const WMO: Record<number, string> = {
  0: "天晴", 1: "大致天晴", 2: "部分多雲", 3: "陰天", 45: "有霧", 48: "凍霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 56: "凍毛毛雨", 57: "凍毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨", 66: "凍雨", 67: "凍雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒", 80: "驟雨", 81: "驟雨", 82: "大驟雨",
  85: "陣雪", 86: "大陣雪", 95: "雷暴", 96: "雷暴冰雹", 99: "雷暴冰雹",
};

async function wx(lat: number, lng: number, ds: string) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,sunset,windspeed_10m_max,weathercode` +
    `&current=temperature_2m,weathercode&timezone=auto&start_date=${ds}&end_date=${ds}`;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    const d = j.daily;
    if (!d?.time?.length) return null;
    return {
      mn: d.temperature_2m_min?.[0], mx: d.temperature_2m_max?.[0],
      pr: d.precipitation_sum?.[0] ?? 0, sn: d.snowfall_sum?.[0] ?? 0,
      wind: d.windspeed_10m_max?.[0] ?? 0,
      set: String(d.sunset?.[0] ?? "").slice(-5),
      code: WMO[d.weathercode?.[0]] ?? "",
      nowT: j.current?.temperature_2m, nowCode: WMO[j.current?.weathercode] ?? "",
      elev: j.elevation,
    };
  } catch { return null; }
}

// 氣象廳（同 trip-brief 一樣驗 reportDatetime，過期當冇警報）
const JMA_OFF = ("011000,45.40,141.75,宗谷|012000,43.77,142.37,上川・留萌|013000,43.98,144.25,網走・北見・紋別|" +
  "014030,42.92,143.20,十勝|014100,43.00,144.38,釧路・根室|015000,42.63,141.60,胆振・日高|" +
  "016000,43.06,141.35,石狩・空知・後志|017000,41.77,140.73,渡島・檜山|130000,35.69,139.69,東京|" +
  "140000,35.45,139.64,神奈川|190000,35.66,138.57,山梨|220000,34.98,138.38,静岡|" +
  "200000,36.65,138.18,長野|110000,35.86,139.65,埼玉|120000,35.61,140.12,千葉").split("|").map((r) => {
    const a = r.split(",");
    return { c: a[0], lat: +a[1], lng: +a[2], n: a[3] };
  });
const JMA_W: Record<string, string> = {
  "02": "暴風雪警報", "03": "大雨警報", "05": "暴風警報", "06": "大雪警報",
  "12": "大雪注意報", "13": "風雪注意報", "20": "濃霧注意報", "22": "雪崩注意報",
  "23": "低温注意報", "26": "着氷注意報", "32": "暴風雪特別警報", "36": "大雪特別警報",
};
async function jma(lat: number, lng: number) {
  let best = null as null | { c: string; n: string }, bd = 1e9;
  for (const o of JMA_OFF) {
    const d = hav([lat, lng], [o.lat, o.lng]);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best || bd > 400) return null;
  try {
    const r = await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${best.c}.json`,
      { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    const rt = Date.parse(j.reportDatetime || "");
    if (!rt || (Date.now() - rt) / 3600000 > 12) return null;
    const cs = new Set<string>();
    for (const at of j.areaTypes ?? []) {
      for (const a of at.areas ?? []) {
        for (const w of a.warnings ?? []) if (w.status && w.status !== "解除") cs.add(w.code);
      }
    }
    const names = [...cs].map((c) => JMA_W[c]).filter(Boolean);
    return names.length ? `${best.n}：${names.join("、")}` : null;
  } catch { return null; }
}

// 砌 context：只放答問題真正用得着嘅嘢，唔好塞爆
async function buildCtx(state: any, at?: { lat: number; lng: number }) {
  const now = new Date(Date.now() + JST_MS);
  const today = dstr(now);
  const trip = pickTrip(state, today);
  if (!trip) return "（冇旅程資料）";
  const L: string[] = [];
  const d = new Date(today + "T00:00:00Z");
  L.push(`【而家】日本時間 ${today}（星期${DOWZH[d.getUTCDay()]}）${hhmm(now)}`);
  L.push(`【旅程】${trip.name}　${trip.start}～${trip.end}`);
  const inTrip = trip.start <= today && today <= trip.end;
  if (inTrip) {
    const dn = Math.round((Date.parse(today) - Date.parse(trip.start)) / 86400000) + 1;
    const tot = Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 86400000) + 1;
    L.push(`　第 ${dn}/${tot} 日`);
  } else L.push("　（今日唔喺旅程期間）");

  const todayItems = dayItems(state, trip.id, today);
  const tmr = dstr(new Date(Date.parse(today) + 86400000));
  const tmrItems = dayItems(state, trip.id, tmr);

  const line = (x: any) => {
    const b = [x.done ? "[去咗]" : "[未去]", x.time || "冇排時間", x.name];
    if (x.addr) b.push(String(x.addr).slice(0, 40));
    if (x.conf) b.push(`編號 ${x.conf}`);
    if (+x.cost) b.push(`${x.ccy || ""} ${x.cost}`);
    if ((x.files ?? []).length) b.push(`附件${x.files.length}個`);
    if (x.note) b.push("備註:" + String(x.note).replace(/\s+/g, " ").slice(0, 70));
    if (x.memo) b.push("我嘅標註:" + String(x.memo).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 70));
    const hrs: string[] = x.hours ?? [];
    if (hrs.length) {
      const dw = new Date(today + "T00:00:00Z").getUTCDay();
      const hl = hrs[dw === 0 ? 6 : dw - 1];
      if (hl) b.push("今日營業:" + hl);
    }
    return "  " + b.join(" ｜ ");
  };

  if (todayItems.length) {
    L.push(`【今日安排】共 ${todayItems.length} 個`);
    todayItems.forEach((x: any) => L.push(line(x)));
    const left = todayItems.filter((x: any) => !x.done);
    if (left.length) L.push(`　下一站：${left[0].name}（今日仲有 ${left.length} 個）`);
  } else L.push("【今日安排】冇");

  if (tmrItems.length) {
    L.push(`【聽日 ${tmr}】共 ${tmrItems.length} 個：` +
      tmrItems.map((x: any) => (x.time ? x.time + " " : "") + x.name).join("、"));
  }

  const rt = state.routes?.[`${trip.id}|${today}`];
  if (rt?.totalSec) {
    L.push(`【今日車程】${Math.round(rt.totalSec / 60)} 分鐘　${Math.round((rt.totalM ?? 0) / 1000)}km` +
      (rt.traffic ? "（計路況）" : ""));
  }

  const pt = at ?? centroid(todayItems) ?? centroid((state.items ?? []).filter((x: any) => x.tripId === trip.id));
  if (pt) {
    const w = await wx(pt.lat, pt.lng, today);
    if (w) {
      L.push(`【天氣】${at ? "你而家位置" : "今日行程一帶"}` +
        (w.elev != null ? `（海拔 ${Math.round(w.elev)}m）` : "") +
        `　${Math.round(w.mn)}°~${Math.round(w.mx)}°　${w.code}` +
        (w.sn > 0 ? `　雪 ${w.sn.toFixed(0)}cm` : (w.pr >= 1 ? `　雨 ${w.pr.toFixed(0)}mm` : "")) +
        (w.wind >= 40 ? `　風 ${w.wind.toFixed(0)}km/h` : "") +
        (w.nowT != null ? `　而家 ${Math.round(w.nowT)}° ${w.nowCode}` : "") +
        (w.set ? `　天黑 ${w.set}` : ""));
    }
    const jw = await jma(pt.lat, pt.lng);
    if (jw) L.push(`【氣象廳警報】${jw}`);
  }

  // 未排期嘅「想去」清單（問「有咩可以去」時用得着）
  const wish = (state.items ?? []).filter((x: any) => x.tripId === trip.id && !x.date).slice(0, 12);
  if (wish.length) L.push(`【想去但未排期】${wish.map((x: any) => x.name).join("、")}`);

  const tot2 = (state.items ?? []).filter((x: any) => x.tripId === trip.id && +x.cost > 0)
    .reduce((s: number, x: any) => s + (+x.cost || 0), 0);
  if (tot2) L.push(`【已記開支】原幣合計 ${Math.round(tot2)}（多幣種，未換算）`);

  return L.join("\n");
}

const SYS_HUD = `你係 Franki 嘅旅程助手，答案會顯示喺 Rokid 眼鏡嘅 HUD（480x400 單色綠）。
鐵律：
1. 最多兩行，全部加起嚟唔好超過 90 個字。冇 emoji、冇 markdown、冇開場白。
2. 只可以用下面「行程資料」入面真有嘅嘢答。冇寫嘅就答「行程冇寫」，唔准估、唔准作店名。
3. 最重要嘅數字（時間、幾點關門、幾度、幾分鐘）要出現喺第一行。
4. 用廣東話，簡短直接，唔使客套。
5. 唔知就直接講唔知。`;

const SYS_FULL = `你係 Franki 嘅旅程助手。用廣東話、書面中文（香港用詞），簡短直接。
只可以用下面「行程資料」入面真有嘅嘢答；冇寫嘅就講「行程冇寫」，唔准估、唔准作店名。
最多五行。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));

  const want = env("ASK_KEY");
  if (!want || body.key !== want) return json({ error: "unauthorized" }, 401);

  const q = String(body.q ?? "").slice(0, 400).trim();
  if (!q) return json({ error: "empty q" }, 400);
  const hud = body.fmt !== "full";

  try {
    const state = await loadState();
    if (!state) return json({ error: "no state" }, 500);
    const at = (isFinite(+body.lat) && isFinite(+body.lng) && body.lat && body.lng)
      ? { lat: +body.lat, lng: +body.lng } : undefined;
    const ctx = await buildCtx(state, at);

    if (body.ctxOnly) return json({ ctx, ms: Date.now() - t0 });

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env("OPENROUTER_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-5",
        max_tokens: hud ? 200 : 600,
        messages: [
          { role: "system", content: hud ? SYS_HUD : SYS_FULL },
          { role: "user", content: `【行程資料】\n${ctx}\n\n【問題】${q}` },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return json({ error: "upstream", detail: (await r.text()).slice(0, 200) }, 502);
    const j = await r.json();
    let text = String(j?.choices?.[0]?.message?.content ?? "").trim();
    if (hud) {
      text = text.replace(/[*_#`]/g, "").split("\n").filter(Boolean).slice(0, 2).join("\n");
      if (text.length > 100) text = text.slice(0, 99) + "…";
    }
    return json({ text, ms: Date.now() - t0 });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
