# 旅程記錄（eva-trip）

私人行程規劃＋旅程日誌。跟 `eva-meal` 同一套：單一 `index.html`、冇 build step、GitHub Pages 託管、資料存 Supabase（RLS 暗號閘）。介面照住 Wanderlog 嘅版面同 design token 做。

- 手機「加至主畫面」即似 app（有 manifest＋icon）
- 開頁揀「入暗號同步雲端」或者「淨係喺呢部機用」（本機模式存 localStorage，唔使 Supabase）
- 地圖同地點搜尋用 Google（Maps JS / Places / Routes），經 Edge Function 代理；冇 key 或者掛咗就自動退返 Leaflet + OpenStreetMap + Nominatim
- AI 經 Supabase Edge Function 代理（OpenRouter），API key 唔會落到呢個 HTML 度；掛咗就自動轉「複製 prompt／貼返 JSON」手動模式

## 幾個頁

| 頁 | 做乜 |
|---|---|
| 行程 | 逐日排地點：時間、分類、花費（多幣種）、備註、附件、拖拉排序、打勾當去咗；每段路顯示真實車程／步程 |
| 地圖 | 當日／全程切換，pin 有次序號同路線，撳 pin 可以跳 Google 導航 |
| 探索 | AI 按行程推薦 10 個地點，帶相、評分、一句原因，一撳加入「想去」 |
| 想去 | 未排日期嘅收藏，隨時「排入行程」 |
| 日誌 | 逐日心情＋文字，自動存；可以叫 AI 照住當日行程幫你寫 |

## AI

1. **AI 排行程**——講你想點玩，出逐日草稿，加落現有安排後面（唔會覆蓋）
2. **貼文字抽地點**——貼 blog／IG caption／朋友清單／酒店確認信，抽地點入「想去」
3. **AI 幫我寫日誌**——照住當日打咗勾嘅地點同你自己筆記寫，唔准作嘢
4. **探索推薦**——出地點名，再經 Google Places 補真座標／評分／相

## 附件

每個項目可以擺檔案（機票、酒店確認信、船票…），存 Supabase Storage 私人 bucket `trip-files`，每個檔上限 10MB。

Bucket 嘅 RLS 閘同 `trip_log` 一樣係抄 `meal_log` 個 policy——讀寫都要啱暗號。

**上傳一定要帶 `Cache-Control: no-store`。** 唔加嘅話，檔案一旦用啱暗號讀過一次，Supabase 個 CDN 會快取一段時間，期間知道確切路徑嘅人錯暗號都讀得到（實測過）。加咗之後錯暗號一律 404：

```
上傳（no-store）      HTTP 200
讀 · 啱暗號 ×2        HTTP 200
讀 · 錯暗號 ×2        404
```

## 同步

雲端係一行 JSON（`trip_log` 一行 `id='main'`）。寫入用樂觀鎖：`PATCH ?updated_at=eq.<版本>`，撞版本就攞返新 state 做 additive merge 再寫，所以兩部機同時改唔會互相蓋走對方嘅行程。

## 設定

全部已經喺 `wbh-sales-coach` 個 Supabase project 做咗。

### 1. 表 ✅

`supabase/schema.sql` 已經行過。RLS 暗號閘由 `meal_log` 直接抄過來，所以**旅程記錄同飲食記錄共用同一個暗號**。想改成獨立暗號，改個 policy 就得。

### 2. AI ＋ Google 代理 ✅

`trip-ai` Edge Function 已經 deploy。行 OpenRouter（`anthropic/claude-sonnet-5`），同時代理 Google Places／Routes。Secrets：

- `OPENROUTER_API_KEY` — AI，淨係喺 server
- `GOOGLE_MAPS_KEY` — Google server-side key（API-restricted）
- `MEAL_KEY` — 暗號閘，同你喺 app 入面打嘅暗號一樣

Google 收費要知嘅兩樣：**相（Photos）同評分（Atmosphere）係貴 tier，每月只有 1,000 次免費**。所以相 URL 攞過就快取落 state，評語文字完全唔攞。Map loads 亦已經設咗每日上限。

萬一 function 掛咗或者暗號唔啱，app 會自動退返去手動模式：複製 prompt → 貼落 Claude → 貼返個回覆 → 套用。

### 3. 分享頁

設定 →「匯出分享頁 JSON」→ 將 `data.json` 放落 `share/`。`share/index.html` 係唯讀頁，唔使暗號，可以直接掉條 link 畀朋友。

## 本機試

```bash
python3 -m http.server 8777
```

開 http://localhost:8777/index.html

## 檔案

```
index.html          成個 app
sw.js               service worker（app shell network-first、地圖磚 cache-first）
manifest.json       PWA
icon-{180,192,512}.png
share/index.html    唯讀分享頁
share/data.json     分享資料（由 app 匯出）
supabase/schema.sql 表 + RLS 暗號閘
supabase/functions/
  trip-ai/index.ts  Edge Function（AI ＋ Google 代理）
```

## 唔做嘅嘢

- 唔做多人即時協作（一個暗號一個人用）
- 唔做機票酒店比價
- 唔預先大批下載地圖磚（OSM ToS）
