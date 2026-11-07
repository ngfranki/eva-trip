// tenki — 由 tenki.jp 攞日本市區預報，轉做 JSON。
// 瀏覽器直接打 tenki.jp 會被 CORS 擋。呢度係唯一會打去 tenki.jp 嘅地方。
//
// 唔改 trip-ai。唔使新 secret、唔使資料庫。
//
// Deploy（要人手做，呢個 PR 唔會自己 deploy）:
//   supabase functions deploy tenki --no-verify-jwt --project-ref lvwspnjysfyomuszzjay
//
//   函數名: tenki
//   verify_jwt: false
//     （同 trip-ai / trip-ask / trip-brief / hb-check 一樣。
//      app 冇 Supabase Auth user JWT，只帶 publishable key 喺 apikey header。
//      config.toml 的 [functions.tenki] 記低咗；CLI 仍然要加 --no-verify-jwt，
//      否則網關會要求 Authorization JWT，頁面會 401。）
//   env: 冇。唔好設 TRIP_KEY / MEAL_KEY / 任何 secret。
//
// 快取: 同一個預報頁 2 小時（記憶體，熱 instance 先有效）。鍵係 tenki 路徑，
// 唔係用家座標。座標只喺呢一個 request 入面用嚟揀最近市區，唔寫 log、唔入庫、
// 唔放進回覆。請用 POST body 傳 lat/lng，唔好放 query string（網關 access log 會記 URL）。
// 另外回應帶 Cache-Control，瀏覽器同邊緣快取可以少打。
// 只會請求 https://tenki.jp/forecast/… 同（目錄對唔到先）/search/。
// User-Agent 寫明係 eva-trip 個人行程，唔係匿名爬蟲。

import { assemble, pickSearch, resolvePlace, type PlaceHit } from "./parse.ts";

const ORIGIN = "https://tenki.jp";
const UA = "eva-trip/1.0 (+https://github.com/ngfranki/eva-trip; personal forecast cache)";
const TTL_OK = 2 * 60 * 60 * 1000;
const TTL_SEARCH = 6 * 60 * 60 * 1000;
const TTL_FAIL = 15 * 60 * 1000;

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const cache = new Map<string, { at: number; body: unknown; status: number }>();
const inflight = new Map<string, Promise<{ status: number; body: unknown }>>();

let windowStart = Date.now();
let upstream = 0;

function allowUpstream(): boolean {
  const now = Date.now();
  if (now - windowStart > 10 * 60 * 1000) {
    windowStart = now;
    upstream = 0;
  }
  if (upstream >= 40) return false;
  upstream++;
  return true;
}

function json(body: unknown, status: number, cacheCtl: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheCtl },
  });
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanQ(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
}

async function tenkiGet(pathAndQuery: string): Promise<string> {
  if (!pathAndQuery.startsWith("/forecast/") && !pathAndQuery.startsWith("/search/")) {
    throw new Error("path");
  }
  if (!allowUpstream()) throw new Error("rate");
  const r = await fetch(ORIGIN + pathAndQuery, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "ja,zh-Hant;q=0.5" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error("tenki " + r.status);
  let host = "";
  try {
    host = new URL(r.url).hostname;
  } catch {
    host = "";
  }
  if (host !== "tenki.jp") throw new Error("redirect");
  const text = await r.text();
  if (text.length > 2_000_000) throw new Error("huge");
  return text;
}

async function load(hit: PlaceHit): Promise<{ status: number; body: unknown }> {
  const key = hit.path;
  const hitCache = cache.get(key);
  if (hitCache && Date.now() - hitCache.at < (hitCache.status === 200 ? TTL_OK : TTL_FAIL)) {
    return { status: hitCache.status, body: hitCache.body };
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    try {
      const path = hit.path.endsWith("/") ? hit.path : hit.path + "/";
      const [daily, outlook] = await Promise.all([
        tenkiGet(path),
        tenkiGet(path + "10days.html").catch(() => ""),
      ]);
      const forecast = assemble(daily, outlook, hit);
      if (!forecast) {
        const body = { ok: false, reason: "parse" };
        cache.set(key, { at: Date.now(), status: 502, body });
        return { status: 502, body };
      }
      const body = { ...forecast, fetchedAt: new Date().toISOString() };
      cache.set(key, { at: Date.now(), status: 200, body });
      return { status: 200, body };
    } catch (e) {
      const reason = e instanceof Error && e.message === "rate" ? "rate" : "upstream";
      const status = reason === "rate" ? 429 : 502;
      const body = { ok: false, reason };
      cache.set(key, { at: Date.now(), status, body });
      return { status, body };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

async function search(q: string): Promise<PlaceHit | null> {
  const key = "s:" + q;
  const hitCache = cache.get(key);
  if (hitCache && Date.now() - hitCache.at < TTL_SEARCH) {
    const b = hitCache.body as { path?: string; pref?: string; name?: string } | null;
    if (!b || !b.path) return null;
    return { path: b.path, pref: b.pref || "", name: b.name || q };
  }
  try {
    const html = await tenkiGet("/search/?keyword=" + encodeURIComponent(q));
    const picked = pickSearch(html, q);
    if (!picked) {
      cache.set(key, { at: Date.now(), status: 200, body: null });
      return null;
    }
    const prefM = picked.address.match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)/);
    const place: PlaceHit = { path: picked.path, pref: prefM ? prefM[1] : "", name: q, lat: 0, lng: 0 };
    cache.set(key, { at: Date.now(), status: 200, body: place });
    return place;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, reason: "method" }, 405, "no-store");
  }

  let q = "";
  let lat: number | null = null;
  let lng: number | null = null;
  if (req.method === "GET") {
    const u = new URL(req.url);
    q = cleanQ(u.searchParams.get("q"));
    lat = num(u.searchParams.get("lat"));
    lng = num(u.searchParams.get("lng"));
  } else {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    q = cleanQ(b.q ?? b.query ?? "");
    lat = num(b.lat);
    lng = num(b.lng);
  }
  if (!q && (lat == null || lng == null)) {
    return json({ ok: false, reason: "missing" }, 400, "no-store");
  }

  const resolved = resolvePlace(q, lat, lng);
  if (!resolved.ok && resolved.reason === "outside-japan") {
    return json({ ok: false, reason: "outside-japan" }, 200, "public, max-age=600");
  }

  let place: PlaceHit | null = resolved.ok ? resolved.place : null;
  if (!place && q) place = await search(q);
  if (!place) return json({ ok: false, reason: "not-found" }, 200, "public, max-age=600");

  const out = await load(place);
  const cacheCtl = out.status === 200
    ? "public, max-age=1800, s-maxage=7200"
    : "no-store";
  return json(out.body, out.status, cacheCtl);
});
