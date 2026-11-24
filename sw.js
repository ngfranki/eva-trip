// 旅程記錄 service worker
// 目標：出門冇網都開得到 app、睇得返行程、之前睇過嘅地圖照樣有。
// 注意：唔會批量預載地圖磚 —— OSM 嘅使用條款唔准 bulk download。
// 只 cache 你自己睇過嘅磚（正常瀏覽行為），所以出門前喺 wifi 慢慢碌一次個地圖就會存低。
importScripts('./scene-keys.js','./trip-scenery.js');
const V = 'trip-v32';
const SHELL = `${V}-shell`;
const TILES = `${V}-tiles`;
const TILE_MAX = 1200;

const SHELL_URLS = [
  './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './hero/plush/marker.webp',
  TripScenery.artwork('narita',TripScenery.condition({code:3},false,'morning'),false,'morning').path,
  './hero/tokyo.webp', './hero/sapporo.webp', './hero/tokachi.webp',
  './hero/akan.webp', './hero/hongkong.webp', './hero/default.webp',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // Commit the page and its scene lookup together. Keep the previous offline copy if an update fails.
    await c.addAll(['./index.html','./scene-keys.js','./trip-scenery.js'].map(path=>
      new Request(new URL(path,self.location),{cache:'reload',credentials:'same-origin'})
    ));
    await Promise.allSettled(SHELL_URLS.map(async (u) => {
      const abs = new URL(u, self.location).toString();
      const res = await fetch(abs);
      if (res.ok) await c.put(u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    // 唔好 client.navigate()。第一趟開頁（未入過暗號）activate 會整頁重載，
    // 打緊嘅暗號即刻被清走，睇落好似點打都冇字。有 listener 嘅頁自己決定 reload；
    // 打緊暗號就延後。
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach((client) => {
      try { client.postMessage({ type: 'reload' }); } catch (err) {}
    });
  })());
});

// Save the new illustrations in the background so the app update can open immediately.
let warming;
self.addEventListener('message', event => {
  if(event.data?.type!=='warm-scenes') return;
  warming ||= (async()=>{
    const cache=await caches.open(SHELL);
    const keys=await cache.keys();
    const saved=new Set(keys.map(request=>request.url));
    const paths=TripScenery.offlineArtwork().map(path=>new URL(path,self.location).href).filter(url=>!saved.has(url));
    async function download(){
      while(paths.length){
        const url=paths.shift();
        try { await cache.add(url); } catch (_) { /* Retry on the next online visit. */ }
      }
    }
    await Promise.all(Array.from({length:3},download));
  })().finally(()=>{warming=null;});
  event.waitUntil(warming);
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

  // sw.js 同 version.json 一定要出網絡，而且唔寫入 cache。
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.json')) {
    if (url.pathname.endsWith('/version.json')) {
      e.respondWith(fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin' }));
    }
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
  // 開頁（navigation / index.html）如果先交咗舊 cache，網絡其後成功就叫頁面 reload 一次。
  const NET_MS = 2500;
  const isDoc = req.mode === 'navigate' || /\/index\.html$/.test(url.pathname);
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const isArtwork = /\/hero\/(?:atlas|edits|corrections|scenes)\//.test(url.pathname);
      const shell = await caches.open(SHELL);
      const cached = await shell.match(req, { ignoreSearch: !isArtwork })
        || (isDoc ? await shell.match('./index.html') : null);
      if(cached && isArtwork) return cached;
      // GitHub Pages 對 index.html 落 max-age=600。navigation 用預設 cache 會攞到舊頁。
      const isSceneScript = /\/(?:trip-scenery|scene-keys)\.js$/.test(url.pathname);
      const netReq = isDoc || isSceneScript
        ? fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' })
        : fetch(req);
      const net = netReq.then(async (res) => {
        if (res.ok) {
          if (isDoc) await shell.put('./index.html', res.clone());
          else await shell.put(req, res.clone());
        }
        return res;
      });
      // 背景更新失敗唔准變成 unhandled rejection
      net.catch(() => {});
      if (!cached) {
        // 第一次攞（cache 都冇），只可以等網絡
        try { return await net; } catch (err) {
          return (isDoc && await shell.match('./index.html')) || Response.error();
        }
      }
      const slow = new Promise((r) => setTimeout(() => r('SLOW'), NET_MS));
      try {
        const winner = await Promise.race([net, slow]);
        if (winner === 'SLOW') {
          if (isDoc) {
            net.then((res) => {
              if (!res || !res.ok) return;
              return self.clients.matchAll({ type: 'window' }).then((cs) => {
                cs.forEach((client) => client.postMessage({ type: 'shell' }));
              });
            }).catch(() => {});
          }
          return cached;      // 網絡太慢 → 即刻出手上嗰份
        }
        if (winner && winner.ok) return winner;
        return cached;
      } catch (err) {
        return cached;                              // 網絡真係掛 → 出 cache
      }
    })());
  }
});
