// 旅程記錄 service worker
// 目標：出門冇網都開得到 app、睇得返行程、之前睇過嘅地圖照樣有。
// 注意：唔會批量預載地圖磚 —— OSM 嘅使用條款唔准 bulk download。
// 只 cache 你自己睇過嘅磚（正常瀏覽行為），所以出門前喺 wifi 慢慢碌一次個地圖就會存低。
const V = 'trip-v7-2';
const SHELL = `${V}-shell`;
const TILES = `${V}-tiles`;
const TILE_MAX = 1200;

const SHELL_URLS = [
  './', './index.html', './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(SHELL_URLS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // trip-att 係用家自己預載嘅附件，換版唔好清走
      .then((ks) => Promise.all(ks.filter((k) => !k.startsWith(V) && k !== 'trip-att').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const ks = await c.keys();
  if (ks.length > TILE_MAX) await Promise.all(ks.slice(0, ks.length - TILE_MAX).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase / Nominatim：一定要新鮮，唔 cache
  const isNominatim = url.hostname.endsWith('openstreetmap.org') && url.pathname.startsWith('/search');
  if (url.hostname.endsWith('supabase.co') || isNominatim) return;

  // 地圖磚：cache-first，順手存低
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Leaflet CDN：cache-first
  if (url.hostname === 'unpkg.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }

  // 自己個 app：network-first（咁先收到新版），但一定要有 timeout。
  //
  // 🔴 2026-09-15 修（議會判為最高風險項）：舊版 `await fetch(req)` 冇 timeout。
  // 離線反而冇事 —— fetch 即刻 reject，catch 即刻食 cache。
  // 真正嘅殺手係「假在線」：山路／隧道／峠 一格訊號，TCP 連得通但去唔到底，
  // fetch 唔會 throw，會吊住到 iOS 自己嘅 network timeout（可長達 30–90 秒），
  // 期間 catch 永遠唔行、cache 永遠唔用，用家睇到白畫面 —— 而嗰一刻正係佢最需要
  // 開個 app 睇「仲有幾遠、幾點天黑」。
  //
  // 所以：2.5 秒未返就即刻出 cache，但唔取消個 fetch，背景照更新落 cache。
  const NET_MS = 2500;
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then(async (res) => {
        if (res.ok) { const c = await caches.open(SHELL); await c.put(req, res.clone()); }
        return res;
      });
      // 背景更新失敗唔准變成 unhandled rejection
      net.catch(() => {});
      if (!cached) {
        // 第一次攞（cache 都冇），只可以等網絡
        try { return await net; } catch (err) {
          return (await caches.match('./index.html')) || Response.error();
        }
      }
      const slow = new Promise((r) => setTimeout(() => r('SLOW'), NET_MS));
      try {
        const winner = await Promise.race([net, slow]);
        if (winner === 'SLOW') return cached;      // 網絡太慢 → 即刻出手上嗰份
        return winner;
      } catch (err) {
        return cached;                              // 網絡真係掛 → 出 cache
      }
    })());
  }
});
