// 旅程記錄 service worker
// 目標：出門冇網都開得到 app、睇得返行程、之前睇過嘅地圖照樣有。
// 注意：唔會批量預載地圖磚 —— OSM 嘅使用條款唔准 bulk download。
// 只 cache 你自己睇過嘅磚（正常瀏覽行為），所以出門前喺 wifi 慢慢碌一次個地圖就會存低。
const V = 'trip-v5-0';
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

  // 自己個 app：network-first（咁先收到新版），冇網先用 cache
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || (await caches.match('./index.html')) || Response.error();
      }
    })());
  }
});
