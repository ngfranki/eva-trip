// trip-ai — eva-trip 後端代理 (Supabase Edge Function)
// 所有付費 key 都留喺伺服器；瀏覽器只帶 x-client-info 暗號。
//
// secrets：
//   OPENROUTER_API_KEY  AI（同 meal-vision 共用）
//   MEAL_KEY            暗號閘（同 meal-vision 共用）
//   GOOGLE_MAPS_KEY     Google Places + Routes（eva-trip server key）
//
// 用法（一律 POST，回 {…} JSON）：
//   {intent:'plan'|'extract'|'log', prompt}   AI 一次過
//   {messages:[…]}                           AI 對話
//   {op:'autocomplete', q, lat?, lng?}       地點搜尋建議
//   {op:'details', placeId}                  地點詳情（名／地址／座標／評分／時間／相）
//   {op:'photo', name, maxPx?}               相片 URL（回 {url}）
//   {op:'route', points:[{lat,lng}…], mode?} 真路線時間距離
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

  const key = Deno.env.get("MEAL_KEY") ?? "";
  if (!key || req.headers.get("x-client-info") !== key) return json({ error: "unauthorized" }, 401);

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
      const mask = "id,displayName,formattedAddress,location,types,rating,userRatingCount,regularOpeningHours,websiteUri,nationalPhoneNumber,photos";
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
        totalSec: secs(rt.duration),
        totalM: rt.distanceMeters ?? 0,
        legs: (rt.legs ?? []).map((l: any) => ({ sec: secs(l.duration), m: l.distanceMeters ?? 0 })),
      });
    }

    return json({ error: "unknown op" }, 400);
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
