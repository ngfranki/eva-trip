// trip-ai — eva-trip 後端代理 (Supabase Edge Function)
// 所有付費 key 都留喺伺服器；瀏覽器只帶 x-client-info 暗號。
//
// secrets：
//   OPENROUTER_API_KEY  AI（同 meal-vision 共用）
//   TRIP_KEY            旅程自己嘅暗號閘（2026-09-16 起）
//   MEAL_KEY            舊嘅共用暗號閘（過渡期仍然收；同 meal-vision 共用，唔准改）
//   GOOGLE_MAPS_KEY     Google Places + Routes（eva-trip server key）
//
// 用法（一律 POST，回 {…} JSON）：
//   {intent:'plan'|'extract'|'log', prompt}   AI 一次過
//   {messages:[…]}                           AI 對話
//   {op:'autocomplete', q, lat?, lng?}       地點搜尋建議
//   {op:'details', placeId}                  地點詳情（名／地址／座標／評分／時間／相）
//   {op:'photo', name, maxPx?}               相片 URL（回 {url}）
//   {op:'route', points:[{lat,lng}…], mode?} 真路線時間距離
//   {near:{lat,lng,kind,radius?}}            搵附近（OSM Overpass 代理）
const OR = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GKEY = () => Deno.env.get("GOOGLE_MAPS_KEY") ?? "";

async function gPost(url: string, body: unknown, fieldMask: string) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GKEY(),
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) return { ok: false, status: r.status, detail: t.slice(0, 400) };
  try { return { ok: true, data: JSON.parse(t) }; } catch { return { ok: false, status: 502, detail: "bad json" }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 暗號閘。2026-09-16 換暗號：TRIP_KEY 係旅程自己嘅新暗號，MEAL_KEY 係舊嘅共用暗號。
  // 過渡期兩個都收；喺手機同 Mac 都入完新暗號、確認正常之後，
  // 就喺 Supabase 後台刪走 MEAL_KEY 對呢個 function 嘅依賴（見 換暗號_步驟2）。
  // 🔴 MEAL_KEY 係飲食 app 嘅 meal-vision 共用，所以呢度只加唔改。
  const sent = req.headers.get("x-client-info") ?? "";
  const tripKey = Deno.env.get("TRIP_KEY") ?? "";
  const oldKey = Deno.env.get("MEAL_KEY") ?? "";
  const ok = (tripKey && sent === tripKey) || (oldKey && sent === oldKey);
  if (!ok) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));


  // ---------- Google ----------
  if (body.op) {
    if (!GKEY()) return json({ error: "no-google-key" }, 501);

    if (body.op === "autocomplete") {
      const q = String(body.q ?? "").slice(0, 200);
      if (!q) return json({ error: "empty q" }, 400);
      const payload: Record<string, unknown> = { input: q, languageCode: "zh-HK" };
      if (body.lat && body.lng) {
        payload.locationBias = {
          circle: { center: { latitude: +body.lat, longitude: +body.lng }, radius: 50000 },
        };
      }
      const r = await gPost("https://places.googleapis.com/v1/places:autocomplete", payload, "*");
      if (!r.ok) return json({ error: "google", status: r.status, detail: r.detail }, 502);
      const sug = (r.data.suggestions ?? []).map((s: any) => ({
        placeId: s.placePrediction?.placeId,
        name: s.placePrediction?.structuredFormat?.mainText?.text ?? s.placePrediction?.text?.text ?? "",
        addr: s.placePrediction?.structuredFormat?.secondaryText?.text ?? "",
        types: s.placePrediction?.types ?? [],
      })).filter((s: any) => s.placeId);
      return json({ suggestions: sug });
    }

    if (body.op === "details") {
      const id = String(body.placeId ?? "");
      if (!id) return json({ error: "empty placeId" }, 400);
      // Essentials + Pro 欄位；Atmosphere（評分／評論）要 Enterprise SKU，所以只攞 rating 呢個 Pro 欄位
      const mask = "id,displayName,formattedAddress,location,types,rating,userRatingCount,regularOpeningHours,utcOffsetMinutes,websiteUri,nationalPhoneNumber,photos";
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: { "X-Goog-Api-Key": GKEY(), "X-Goog-FieldMask": mask },
      });
      const t = await r.text();
      if (!r.ok) return json({ error: "google", status: r.status, detail: t.slice(0, 400) }, 502);
      const d = JSON.parse(t);
      return json({
        placeId: d.id,
        name: d.displayName?.text ?? "",
        addr: d.formattedAddress ?? "",
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
        types: d.types ?? [],
        rating: d.rating ?? null,
        ratingCount: d.userRatingCount ?? null,
        hours: d.regularOpeningHours?.weekdayDescriptions ?? null,
        openNow: d.regularOpeningHours?.openNow ?? null,
        utcOff: d.utcOffsetMinutes ?? null,   // 當地時區，算「而家開唔開」要用

        site: d.websiteUri ?? null,
        phone: d.nationalPhoneNumber ?? null,
        photo: d.photos?.[0]?.name ?? null,
      });
    }

    if (body.op === "photo") {
      const name = String(body.name ?? "");
      if (!name) return json({ error: "empty name" }, 400);
      const px = Math.min(1200, Math.max(200, +body.maxPx || 640));
      const r = await fetch(
        `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${px}&skipHttpRedirect=true`,
        { headers: { "X-Goog-Api-Key": GKEY() } },
      );
      const t = await r.text();
      if (!r.ok) return json({ error: "google", status: r.status, detail: t.slice(0, 300) }, 502);
      const d = JSON.parse(t);
      return json({ url: d.photoUri ?? null });
    }

    if (body.op === "route") {
      const pts = Array.isArray(body.points) ? body.points.slice(0, 25) : [];
      if (pts.length < 2) return json({ error: "need 2+ points" }, 400);
      const mode = ["DRIVE", "WALK", "TRANSIT", "BICYCLE"].includes(body.mode) ? body.mode : "DRIVE";
      const ll = (p: any) => ({ location: { latLng: { latitude: +p.lat, longitude: +p.lng } } });
      const payload: Record<string, unknown> = {
        origin: ll(pts[0]),
        destination: ll(pts[pts.length - 1]),
        travelMode: mode,
        languageCode: "zh-HK",
        units: "METRIC",
      };
      if (pts.length > 2) payload.intermediates = pts.slice(1, -1).map(ll);

      // 即時路況。淨係「而家卡」會開（origin = 你而家 GPS、出發時間 = 而家），
      // 所以唔會撞到 Routes API「departureTime 必須係未來」嗰條規 ——
      // 規劃期嘅逐日路線一律唔開，留喺 Essentials SKU。
      //   Essentials 每月 10,000 免費 / Pro（TRAFFIC_AWARE）每月 5,000 免費
      if (body.traffic === true) {
        payload.routingPreference = "TRAFFIC_AWARE";
        // departureTime 一定要係未來（Google 規定），所以 client 只喺未來日期才傳。
        // 有傳就係「預測當日嗰個鐘數嘅路況」，冇傳就係「而家嘅路況」。
        const dep = typeof body.departureTime === "string" ? body.departureTime : "";
        if (dep && !isNaN(Date.parse(dep)) && Date.parse(dep) > Date.now() + 60_000) {
          payload.departureTime = new Date(dep).toISOString();
        }
      }
      const r = await gPost(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        payload,
        "routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters",
      );
      if (!r.ok) return json({ error: "google", status: r.status, detail: r.detail }, 502);
      const rt = r.data.routes?.[0];
      if (!rt) return json({ error: "no-route" }, 404);
      const secs = (v: unknown) => (typeof v === "string" ? parseInt(v) : +(v ?? 0)) || 0;
      return json({
        mode,
        traffic: body.traffic === true,
        totalSec: secs(rt.duration),
        totalM: rt.distanceMeters ?? 0,
        legs: (rt.legs ?? []).map((l: any) => ({ sec: secs(l.duration), m: l.distanceMeters ?? 0 })),
      });
    }

    return json({ error: "unknown op" }, 400);
  }

  // ---------- 搵附近 ----------
  // 🔴 2026-09-16 實測：本來想用 OpenStreetMap Overpass（免費無配額），但係
  //    公共 Overpass 伺服器靠唔住 —— overpass-api.de 用 406 擋（連 Deno 出去都擋，
  //    大概係封雲端共用 IP），kumi／private.coffee 回 429，osm.jp 連唔上。
  //    所以主路改用 Google Places searchNearby（你已經有 key），Overpass 留做後備。
  //    ⚠️ fieldMask 故意只攞 displayName ＋ location：加 openingHours／rating
  //    會跳去 Enterprise SKU（免費額只約 1,000／月）。距離喺前端自己算。
  if (body.near) {
    const lat = +body.near.lat, lng = +body.near.lng;
    if (!isFinite(lat) || !isFinite(lng)) return json({ error: "bad latlng" }, 400);
    const r = Math.min(20000, Math.max(300, +body.near.radius || 5000));
    // 2026-09-16 最後結論：全部 Google 優先，OSM 只做「Google 完全冇結果」嘅後備。
    // 中間試過 osmFirst（因為 OSM 對廁所／温泉／道の駅 標記齊），但實測由
    // Supabase edge 出去 Overpass 完全唔通 —— overpass-api.de 406（封雲端共用 IP）、
    // kumi 鏡像 timeout。結果只係白等 12 秒才跌落 Google。所以取消 osmFirst。
    // 副作用：冇「公共廁所」呢類，Google 只會回道の駅／休息站 —— 所以前端
    // 索性拿走「廁所」分類，改為提示「便利店同道の駅一定有廁所」。
    const KIND: Record<string, { g: string[]; osm: string[] }> = {
      fuel:     { g: ["gas_station"],                   osm: ['["amenity"="fuel"]'] },
      conv:     { g: ["convenience_store"],             osm: ['["shop"="convenience"]'] },
      rest:     { g: ["rest_stop"],                     osm: ['["amenity"="rest_area"]', '["highway"="rest_area"]', '["highway"="services"]'] },
      onsen:    { g: ["spa", "public_bath"],            osm: ['["amenity"="public_bath"]', '["leisure"="spa"]'] },
      parking:  { g: ["parking"],                       osm: ['["amenity"="parking"]'] },
      super:    { g: ["supermarket"],                   osm: ['["shop"="supermarket"]'] },
      pharmacy: { g: ["pharmacy", "drugstore"],         osm: ['["amenity"="pharmacy"]', '["shop"="chemist"]'] },
      hospital: { g: ["hospital"],                      osm: ['["amenity"="hospital"]', '["amenity"="clinic"]'] },
    };
    const k = KIND[String(body.near.kind ?? "")];
    if (!k) return json({ error: "bad kind" }, 400);
    let gErr: { status: number; detail: string } | null = null;

    const tryGoogle = async () => {
      if (!GKEY()) return null;
      const rr = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GKEY(),
          "X-Goog-FieldMask": "places.displayName,places.location,places.primaryTypeDisplayName",
        },
        body: JSON.stringify({
          includedTypes: k.g,
          maxResultCount: 20,
          languageCode: "zh-HK",
          rankPreference: "DISTANCE",
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: r } },
        }),
      });
      const txt = await rr.text();
      if (rr.ok) {
        const d = JSON.parse(txt);
        const places = (d.places ?? []).map((x: any) => ({
          name: x.displayName?.text ?? "",
          brand: x.primaryTypeDisplayName?.text ?? "",
          hours: "",
          lat: x.location?.latitude ?? null,
          lng: x.location?.longitude ?? null,
        })).filter((x: any) => x.lat != null);
        return places.length ? { src: "google", places } : null;
      }
      gErr = { status: rr.status, detail: txt.slice(0, 200) };
      return null;
    };

    // 🔴 timeout 要細。2026-09-16 實測：三個鏡像順序試、每個 25 秒，
    //    加起嚟超過 50 秒，client 同 edge function 都會斷。
    //    改成 Overpass 自己 10 秒、fetch 硬斷 12 秒、最多試兩個鏡像。
    const q = `[out:json][timeout:10];(${k.osm.map((x) => `nwr${x}(around:${r},${lat},${lng});`).join("")});out center 40;`;
    const tryOsm = async () => {
      for (const host of ["https://overpass-api.de/api/interpreter",
                          "https://overpass.kumi.systems/api/interpreter"]) {
        try {
          const rr2 = await fetch(host + "?data=" + encodeURIComponent(q), {
            headers: { "User-Agent": "eva-trip/1.0 (personal trip planner; +https://ngfranki.github.io/eva-trip/)" },
            signal: AbortSignal.timeout(12000),
          });
          if (!rr2.ok) continue;
          const d2 = JSON.parse(await rr2.text());
          const places = (d2.elements ?? []).map((e: any) => {
            const t = e.tags ?? {};
            const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
            if (la == null || lo == null) return null;
            return { name: t["name:zh"] ?? t.name ?? t.brand ?? t.operator ?? "", brand: t.brand ?? "", hours: t.opening_hours ?? "", lat: la, lng: lo };
          }).filter(Boolean);
          if (places.length) return { src: "osm", places };
        } catch { /* 試下一個 */ }
      }
      return null;
    };

    const order = [tryGoogle, tryOsm];
    for (const f of order) {
      const got = await f();
      if (got) return json({ kind: body.near.kind, radius: r, ...got });
    }
    return json({ error: "near-failed", google: gErr }, 502);
  }

  // ---------- AI ----------
  let messages: Array<{ role: string; content: string }>;
  if (Array.isArray(body.messages) && body.messages.length) {
    messages = body.messages
      .filter((m: any) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
      .slice(-24)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 24000) }));
    if (!messages.length) return json({ error: "empty messages" }, 400);
  } else {
    const prompt = String(body.prompt ?? "").slice(0, 20000);
    if (!prompt) return json({ error: "empty prompt" }, 400);
    const intent = String(body.intent ?? "plan");
    const system = intent === "log"
      ? "你係旅程日誌寫手。用書面中文（香港用詞），平實唔誇張，只可以照住用家俾嘅事實寫，唔准作嘢。只回覆日誌本身。"
      : "你係旅程規劃助手。只可以回覆一個 JSON object，唔准有 markdown code fence、唔准有任何解釋文字。";
    messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  }

  const r = await fetch(OR, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY") ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return json({ error: "upstream", status: r.status, detail: detail.slice(0, 500) }, 502);
  }
  const j = await r.json();
  return json({ text: j?.choices?.[0]?.message?.content ?? "" });
});
