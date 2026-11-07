// tenki.jp HTML → JSON。冇任何網絡，方便用真頁面做測試。
// tenki.jp 冇官方 API，版面一改，下面嘅 class 名就會對唔到。
// 對唔到嘅時候回 ok:false，app 退回 Open-Meteo。

import { PLACES } from "./places.ts";

export type Day = {
  date: string;
  weather: string;
  weatherJa: string;
  high: number | null;
  low: number | null;
  rain: number | null;
};

export type Forecast = {
  ok: true;
  source: "tenki.jp";
  place: string;
  pref: string;
  url: string;
  outlookUrl: string;
  today: Day | null;
  tomorrow: Day | null;
  days: Day[];
};

export type PlaceHit = { pref: string; name: string; path: string; lat: number; lng: number };

export type Resolve =
  | { ok: true; place: PlaceHit }
  | { ok: false; reason: "outside-japan" | "not-found" };

// 短名／英文 → PLACES 入面「府縣+名稱」嗰條 key（避免 北區 咁嘅重名）。
const ALIAS: Record<string, string> = {
  "東京": "東京都千代田区",
  "tokyo": "東京都千代田区",
  "新宿": "東京都新宿区",
  "shinjuku": "東京都新宿区",
  "渋谷": "東京都渋谷区",
  "shibuya": "東京都渋谷区",
  "淺草": "東京都台東区",
  "浅草": "東京都台東区",
  "asakusa": "東京都台東区",
  "銀座": "東京都中央区",
  "ginza": "東京都中央区",
  "上野": "東京都台東区",
  "ueno": "東京都台東区",
  "台場": "東京都江東区",
  "お台場": "東京都江東区",
  "odaiba": "東京都江東区",
  "大阪": "大阪府大阪市",
  "osaka": "大阪府大阪市",
  "京都": "京都府京都市",
  "kyoto": "京都府京都市",
  "嵐山": "京都府京都市",
  "arashiyama": "京都府京都市",
  "伏見": "京都府京都市伏見区",
  "fushimi": "京都府京都市伏見区",
  "札幌": "北海道札幌市",
  "sapporo": "北海道札幌市",
  "小樽": "北海道小樽市",
  "otaru": "北海道小樽市",
  "函館": "北海道函館市",
  "hakodate": "北海道函館市",
  "富良野": "北海道富良野市",
  "furano": "北海道富良野市",
  "ニセコ": "北海道ニセコ町",
  "niseko": "北海道ニセコ町",
  "橫濱": "神奈川県横浜市",
  "横浜": "神奈川県横浜市",
  "yokohama": "神奈川県横浜市",
  "鎌倉": "神奈川県鎌倉市",
  "kamakura": "神奈川県鎌倉市",
  "箱根": "神奈川県箱根町",
  "hakone": "神奈川県箱根町",
  "名古屋": "愛知県名古屋市",
  "nagoya": "愛知県名古屋市",
  "金澤": "石川県金沢市",
  "金沢": "石川県金沢市",
  "kanazawa": "石川県金沢市",
  "河口湖": "山梨県富士河口湖町",
  "kawaguchiko": "山梨県富士河口湖町",
  "高山": "岐阜県高山市",
  "takayama": "岐阜県高山市",
  "白川鄉": "岐阜県白川村",
  "白川郷": "岐阜県白川村",
  "shirakawa": "岐阜県白川村",
  "廣島": "広島県広島市",
  "広島": "広島県広島市",
  "hiroshima": "広島県広島市",
  "宮島": "広島県廿日市市",
  "miyajima": "広島県廿日市市",
  "奈良": "奈良県奈良市",
  "nara": "奈良県奈良市",
  "神戶": "兵庫県神戸市",
  "神戸": "兵庫県神戸市",
  "kobe": "兵庫県神戸市",
  "福岡": "福岡県福岡市",
  "fukuoka": "福岡県福岡市",
  "那霸": "沖縄県那覇市",
  "那覇": "沖縄県那覇市",
  "naha": "沖縄県那覇市",
  "okinawa": "沖縄県那覇市",
  "沖繩": "沖縄県那覇市",
  "仙台": "宮城県仙台市",
  "sendai": "宮城県仙台市",
  "日光": "栃木県日光市",
  "nikko": "栃木県日光市",
  "別府": "大分県別府市",
  "beppu": "大分県別府市",
  "由布院": "大分県由布市",
  "yufuin": "大分県由布市",
  "長崎": "長崎県長崎市",
  "nagasaki": "長崎県長崎市",
  "熊本": "熊本県熊本市",
  "kumamoto": "熊本県熊本市",
  "鹿兒島": "鹿児島県鹿児島市",
  "鹿児島": "鹿児島県鹿児島市",
  "kagoshima": "鹿児島県鹿児島市",
  "長野": "長野県長野市",
  "nagano": "長野県長野市",
  "輕井澤": "長野県軽井沢町",
  "軽井沢": "長野県軽井沢町",
  "karuizawa": "長野県軽井沢町",
  "熱海": "静岡県熱海市",
  "atami": "静岡県熱海市",
};

const BROAD = new Set([
  "東京", "tokyo", "大阪", "osaka", "京都", "kyoto", "札幌", "sapporo",
  "北海道", "hokkaido", "沖繩", "okinawa",
]);

let indexBuilt = false;
const byKey = new Map<string, PlaceHit[]>();
const located: PlaceHit[] = [];

function addKey(key: string, p: PlaceHit) {
  const k = key.trim();
  if (!k) return;
  const arr = byKey.get(k) ?? [];
  if (!arr.some((x) => x.path === p.path)) arr.push(p);
  byKey.set(k, arr);
}

function buildIndex() {
  if (indexBuilt) return;
  indexBuilt = true;
  for (const [pref, name, path, lat, lng] of PLACES) {
    const p: PlaceHit = { pref, name, path, lat, lng };
    if (Number.isFinite(lat) && Number.isFinite(lng)) located.push(p);
    addKey(name, p);
    addKey(pref + name, p);
    const ward = name.match(/^(.+市)(.+区)$/);
    if (ward) {
      addKey(ward[2], p);
      addKey(ward[2].replace(/区$/, ""), p);
    } else {
      const unit = name.match(/^(.+)[市区町村]$/);
      if (unit && unit[1].length >= 1) addKey(unit[1], p);
    }
  }
}

export function coordCount(): number {
  buildIndex();
  return located.length;
}

export function inJapan(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < 24 || lat > 45.65 || lng < 122.9 || lng > 145.9) return false;
  // 朝鮮半島。對馬（約 129.3°E）會被包入去，呢個位用 Open-Meteo。
  if (lat > 33 && lat < 38.8 && lng < 131.05) return false;
  if (lat < 25.3 && lng < 122) return false;
  return true;
}

function havKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// 目錄入面每個市區嘅代表點，揀直線最近。大過 80km 就唔好硬套（海上面、或者目錄冇覆蓋）。
function nearest(lat: number, lng: number): { place: PlaceHit; km: number } | null {
  buildIndex();
  let best: { place: PlaceHit; km: number } | null = null;
  for (const p of located) {
    const km = havKm(lat, lng, p.lat, p.lng);
    if (!best || km < best.km) best = { place: p, km };
  }
  return best;
}

export function normQuery(q: string): string {
  let s = q.normalize("NFKC").replace(/\s+/g, "").trim();
  s = s.replace(/日本|Japan/gi, "");
  const ms = s.match(/[\u4e00-\u9fff]{1,12}(?:市[\u4e00-\u9fff]{1,8}区|[市区町村])/g);
  if (ms && ms.length) {
    const spec = ms.filter((x) => /[区町村]$/.test(x));
    return (spec[spec.length - 1] || ms[ms.length - 1]).slice(0, 24);
  }
  return s.slice(0, 40);
}

function lookup(raw: string): PlaceHit[] {
  buildIndex();
  const key = normQuery(raw);
  if (!key) return [];
  const alias = ALIAS[key] ?? ALIAS[key.toLowerCase()];
  if (alias && byKey.has(alias)) return byKey.get(alias)!.slice();
  return (byKey.get(key) ?? byKey.get(key.toLowerCase()) ?? []).slice();
}

function narrow(hits: PlaceHit[], key: string): PlaceHit[] {
  if (hits.length <= 1) return hits;
  const exact = hits.filter((h) => h.name === key || h.pref + h.name === key);
  if (exact.length === 1) return exact;
  const city = hits.filter((h) =>
    h.name === key || h.name === key + "市" || h.name === key + "町" ||
    h.name === key + "村" || h.name === key + "区"
  );
  if (city.length === 1) return city;
  return hits;
}

export function resolvePlace(q: string, lat: number | null, lng: number | null): Resolve {
  const hasLL = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  if (hasLL && !inJapan(lat!, lng!)) return { ok: false, reason: "outside-japan" };
  const near = hasLL && inJapan(lat!, lng!) ? nearest(lat!, lng!) : null;
  const key = normQuery(q);
  const broad = !key || BROAD.has(key) || BROAD.has(key.toLowerCase());
  if (broad && near && near.km <= 80) return { ok: true, place: near.place };

  let hits = key ? lookup(key) : [];
  if (hits.length > 1 && near) {
    const same = hits.filter((h) => h.pref === near.place.pref);
    if (same.length) hits = same;
  }
  hits = narrow(hits, key);
  if (hits.length === 1) {
    // 名係埼玉「嵐山町」，座標卻喺京都：信座標。同縣就信個名（伏見區）。
    if (near && near.km <= 45 && near.place.pref !== hits[0].pref) {
      return { ok: true, place: near.place };
    }
    return { ok: true, place: hits[0] };
  }
  if (near && near.km <= 100) return { ok: true, place: near.place };
  return { ok: false, reason: "not-found" };
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 郵遞區號搜尋第一頁會偏去某個區，而且「大阪」會撞到京都嘅大阪町。
// 只當目錄對唔到先用。分數 > 0 先算搵到。
export function pickSearch(html: string, q: string): { path: string; address: string; score: number } | null {
  const key = normQuery(q);
  const base = key.replace(/[都道府県市区町村]+$/u, "");
  if (!base) return null;
  const re = /<a href="(\/forecast\/\d+\/\d+\/\d+\/\d+\/)">\s*<span class="zipcode">[^<]*<\/span><span class="address">([^<]*)<\/span>/g;
  const groups = new Map<string, { score: number; address: string }>();
  // 「大阪市／大阪府」先過「上大阪町」。町名要喺開頭或者郡之後先算。
  const strong = new RegExp(escRe(base) + "[都道府県市区]");
  const town = new RegExp("(?:^|郡)" + escRe(base) + "[町村]");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const path = m[1];
    const addr = m[2];
    const core = addr.replace(/[（(〔\[][^）)〕\]]*[）)〕\]]/g, "");
    let s = 0;
    if (strong.test(core)) s += 10;
    else if (town.test(core)) s += 4;
    else if (core.includes(base)) s -= 3;
    if (s > 0 && key !== base && core.includes(key)) s += 5;
    const g = groups.get(path) ?? { score: 0, address: addr };
    g.score += s;
    if (addr.length < g.address.length) g.address = addr;
    groups.set(path, g);
  }
  let best: { path: string; address: string; score: number } | null = null;
  for (const [path, g] of groups) {
    if (!best || g.score > best.score) best = { path, address: g.address, score: g.score };
  }
  if (!best || best.score <= 0) return null;
  return best;
}

export function wxZh(ja: string): string {
  let s = ja.replace(/\s+/g, "").trim();
  if (!s || s === "---" || s === "--") return "";
  const reps: [string, string][] = [
    ["一時", "一陣"],
    ["時々", "間中"],
    ["のち", "轉"],
    ["止む", "停"],
    ["曇り", "陰"],
    ["薄曇", "薄雲"],
    ["快晴", "晴"],
    ["大雨", "大雨"],
    ["大雪", "大雪"],
    ["雷雨", "雷雨"],
    ["みぞれ", "雨夾雪"],
    ["霙", "雨夾雪"],
    ["曇", "陰"],
    ["雨", "雨"],
    ["雪", "雪"],
    ["雷", "雷"],
    ["霧", "霧"],
    ["晴", "晴"],
  ];
  for (const [a, b] of reps) s = s.split(a).join(b);
  s = s.replace(/([晴陰雨雪雷霧])後(?=[晴陰雨雪雷霧])/g, "$1轉");
  return s;
}

function num(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/<[^>]+>/g, "");
  s = s.replace(/&#8451;|℃|°|％|%/g, "").replace(/−/g, "-").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pad(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

export function forecastYear(html: string, firstMonth: number): number {
  const m = html.match(/announce_datetime:(\d{4})-(\d{2})-\d{2}/);
  if (m) {
    let y = +m[1];
    if (firstMonth < +m[2]) y++;
    return y;
  }
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  let y = now.getUTCFullYear();
  const am = now.getUTCMonth() + 1;
  if (firstMonth < am) y++;
  return y;
}

function isoDates(parts: { m: number; d: number }[], year: number): string[] {
  let y = year;
  let prev = 0;
  return parts.map((p) => {
    if (prev && p.m < prev) y++;
    prev = p.m;
    return `${y}-${pad(p.m)}-${pad(p.d)}`;
  });
}

function rainOf(slots: (number | null)[]): number | null {
  const xs = slots.filter((n): n is number => n != null);
  return xs.length ? Math.max(...xs) : null;
}

function parseSection(section: string, yearHintHtml: string): Day | null {
  if (!section) return null;
  const md = section.match(/(\d{1,2})月\s*(\d{1,2})日/);
  const tel = section.match(/class="weather-telop">\s*([^<]+)/);
  if (!md || !tel) return null;
  const ja = tel[1].trim();
  const row = section.match(/class="rain-probability"[\s\S]*?<\/tr>/);
  const slots: (number | null)[] = [];
  if (row) {
    for (const td of row[0].matchAll(/<td>([\s\S]*?)<\/td>/g)) {
      const text = td[1].replace(/<[^>]+>/g, "");
      slots.push(num(text));
    }
  }
  const hi = section.match(/class="high-temp temp"[\s\S]*?class="value">\s*([^<]+)/);
  const lo = section.match(/class="low-temp temp"[\s\S]*?class="value">\s*([^<]+)/);
  const month = +md[1];
  const date = isoDates([{ m: month, d: +md[2] }], forecastYear(yearHintHtml, month))[0];
  return {
    date,
    weatherJa: ja,
    weather: wxZh(ja),
    high: hi ? num(hi[1]) : null,
    low: lo ? num(lo[1]) : null,
    rain: rainOf(slots),
  };
}

function sectionOf(html: string, cls: string): string {
  const i = html.indexOf(`class="${cls}"`);
  if (i < 0) return "";
  const j = html.indexOf("</section>", i);
  return html.slice(i, j < 0 ? i + 9000 : j);
}

export function parseDaily(html: string): { today: Day | null; tomorrow: Day | null; place: string } {
  const title = html.match(/<title>\s*([^<の\s]+?)の/);
  return {
    place: title ? title[1] : "",
    today: parseSection(sectionOf(html, "today-weather"), html),
    tomorrow: parseSection(sectionOf(html, "tomorrow-weather"), html),
  };
}

export function parseOutlook(html: string): Day[] {
  const chunks = html.split('<dd class="forecast10days-actab">').slice(1);
  const raw: { m: number; d: number; ja: string; high: number | null; low: number | null; rain: number | null }[] = [];
  for (const chunk of chunks) {
    const summary = chunk.split("forecast10days-actab-content")[0];
    const md = summary.match(/(\d{1,2})月\s*(\d{1,2})日/);
    const tel = summary.match(/class="forecast-telop">\s*([^<]+)/);
    if (!md || !tel) continue;
    const hi = summary.match(/class="high-temp">\s*([^<]+)/);
    const lo = summary.match(/class="low-temp">\s*([^<]+)/);
    const rain = summary.match(/class="prob-precip">\s*([^<]+)/);
    raw.push({
      m: +md[1],
      d: +md[2],
      ja: tel[1].trim(),
      high: hi ? num(hi[1]) : null,
      low: lo ? num(lo[1]) : null,
      rain: rain ? num(rain[1]) : null,
    });
  }
  if (!raw.length) return [];
  const dates = isoDates(raw.map((r) => ({ m: r.m, d: r.d })), forecastYear(html, raw[0].m));
  return raw.map((r, i) => ({
    date: dates[i],
    weatherJa: r.ja,
    weather: wxZh(r.ja),
    high: r.high,
    low: r.low,
    rain: r.rain,
  }));
}

export function assemble(dailyHtml: string, outlookHtml: string, hit: PlaceHit): Forecast | null {
  const daily = dailyHtml ? parseDaily(dailyHtml) : { today: null, tomorrow: null, place: "" };
  let days = outlookHtml ? parseOutlook(outlookHtml) : [];
  // 今日／聽日用詳情頁（降水係各時段嘅最高），兩週列表用 10days.html。
  // 同一日兩邊都有就以詳情頁為準。
  for (const extra of [daily.today, daily.tomorrow]) {
    if (!extra) continue;
    const i = days.findIndex((d) => d.date === extra.date);
    if (i >= 0) days[i] = extra;
    else days.push(extra);
  }
  days.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (!days.length) days = [daily.today, daily.tomorrow].filter((d): d is Day => !!d);
  const today = daily.today ?? days[0] ?? null;
  const tomorrow = daily.tomorrow ?? days[1] ?? null;
  if (!today && days.length < 3) return null;
  const place = daily.place || hit.name;
  const path = hit.path.endsWith("/") ? hit.path : hit.path + "/";
  return {
    ok: true,
    source: "tenki.jp",
    place,
    pref: hit.pref,
    url: "https://tenki.jp" + path,
    outlookUrl: "https://tenki.jp" + path + "10days.html",
    today,
    tomorrow,
    days,
  };
}
