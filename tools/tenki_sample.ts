// 用真 tenki.jp 頁面試解析器。唔經 Supabase。
//   node --experimental-strip-types tools/tenki_sample.ts

import { assemble, coordCount, pickSearch, resolvePlace } from "../supabase/functions/tenki/parse.ts";
import { PLACES } from "../supabase/functions/tenki/places.ts";

const UA = "eva-trip/1.0 (+https://github.com/ngfranki/eva-trip; personal forecast cache)";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function place(pref: string, name: string) {
  const hit = PLACES.find((p) => p[0] === pref && p[1] === name);
  if (!hit) throw new Error("missing " + pref + name);
  return { pref: hit[0], name: hit[1], path: hit[2] };
}

async function get(path: string): Promise<string> {
  const r = await fetch("https://tenki.jp" + path, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "ja" },
  });
  if (!r.ok) throw new Error(path + " " + r.status);
  return await r.text();
}

assert(coordCount() === PLACES.length, "coords " + coordCount() + " != " + PLACES.length);

const cases: [string, number | null, number | null, string][] = [
  ["東京", null, null, "/forecast/3/16/4410/13101/"],
  ["大阪", null, null, "/forecast/6/30/6200/27100/"],
  ["札幌", null, null, "/forecast/1/2/1400/1100/"],
  ["京都", 35.012, 135.768, "/forecast/6/29/6110/26100/"],
  ["新宿", 35.69, 139.70, "/forecast/3/16/4410/13104/"],
  ["小樽", 43.19, 141.00, "/forecast/1/2/1600/1203/"],
  ["伏見区", 34.968, 135.780, "/forecast/6/29/6110/26109/"],
  ["嵐山", 35.017, 135.671, "/forecast/6/29/6110/26100/"],
  ["清水町", 35.10, 138.90, shimizuPath()],
  ["", 43.06, 141.35, "/forecast/1/2/1400/1100/"],
  // 東京站喺千代田同中央區交界，最近代表點係中央區。
  ["", 35.6812, 139.7671, "/forecast/3/16/4410/13102/"],
  ["", 22.28, 114.16, "outside-japan"],
  ["香港", 22.3, 114.17, "outside-japan"],
  ["", 22.3, 114.17, "outside-japan"],
];

function shimizuPath() {
  const hit = PLACES.find((p) => p[0] === "静岡県" && p[1] === "清水町");
  if (!hit) throw new Error("no shimizu");
  return hit[2];
}

for (const [q, lat, lng, expect] of cases) {
  const r = resolvePlace(q, lat, lng);
  if (expect === "outside-japan") {
    assert(!r.ok && r.reason === "outside-japan", q + " should be outside");
    continue;
  }
  assert(r.ok, q + " not resolved " + JSON.stringify(r));
  if (r.ok) assert(r.place.path === expect, q + " → " + r.place.path + " expected " + expect);
}

// 郵遞區號搜尋會把京都「大阪町」排喺大阪市前面。計分要揀大阪府嗰邊。
const osakaSearch = [
  '<a href="/forecast/6/29/6110/26104/"><span class="zipcode">604-8001</span><span class="address">京都府京都市中京区上大阪町</span></a>',
  '<a href="/forecast/6/29/6110/26104/"><span class="zipcode">604-8025</span><span class="address">京都府京都市中京区下大阪町</span></a>',
  '<a href="/forecast/6/30/6200/27127/"><span class="zipcode">530-0001</span><span class="address">大阪府大阪市北区梅田</span></a>',
  '<a href="/forecast/6/30/6200/27127/"><span class="zipcode">530-0002</span><span class="address">大阪府大阪市北区曽根崎新地</span></a>',
].join("\n");
const picked = pickSearch(osakaSearch, "大阪");
assert(picked && picked.path === "/forecast/6/30/6200/27127/", "osaka search " + JSON.stringify(picked));
assert(picked!.score > 0, "osaka score");

const cities = [
  place("東京都", "千代田区"),
  place("大阪府", "大阪市"),
  place("北海道", "札幌市"),
];

const samples = [];
for (const hit of cities) {
  const [daily, outlook] = await Promise.all([
    get(hit.path),
    get(hit.path + "10days.html"),
  ]);
  const fx = assemble(daily, outlook, hit);
  assert(fx, hit.name + " parse failed");
  assert(fx!.today && fx!.today.weather, hit.name + " missing today");
  assert(fx!.tomorrow && fx!.tomorrow.weather, hit.name + " missing tomorrow");
  assert(fx!.days.length >= 10, hit.name + " days " + fx!.days.length);
  assert(fx!.today!.high != null && fx!.today!.low != null, hit.name + " temps");
  assert(!/[曇のち時々]/.test(fx!.today!.weather + fx!.tomorrow!.weather), hit.name + " untranslated " + fx!.today!.weather);
  samples.push({
    place: fx!.place,
    pref: fx!.pref,
    url: fx!.url,
    today: fx!.today,
    tomorrow: fx!.tomorrow,
    days: fx!.days.length,
    outlook: fx!.days.map((d) => ({
      date: d.date,
      weather: d.weather,
      high: d.high,
      low: d.low,
      rain: d.rain,
    })),
  });
  console.log(
    `${fx!.place}  今日 ${fx!.today!.date} ${fx!.today!.weather} ${fx!.today!.high}°/${fx!.today!.low}° 降水 ${fx!.today!.rain}%` +
      `  ｜ 聽日 ${fx!.tomorrow!.weather} ${fx!.tomorrow!.high}°/${fx!.tomorrow!.low}° 降水 ${fx!.tomorrow!.rain}%` +
      `  ｜ ${fx!.days.length} 日`,
  );
}

console.log("\n" + JSON.stringify(samples, null, 2));
console.log("\nok", cities.map((c) => c.name).join("、"));
