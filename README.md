# 旅程記錄（eva-trip）

私人行程規劃＋旅程日誌。跟 `eva-meal` 同一套：單一 `index.html`、冇 build step、GitHub Pages 託管、資料存 Supabase（RLS 暗號閘）。介面照住 Wanderlog 嘅版面同 design token 做。

- 手機「加至主畫面」即似 app（有 manifest＋icon）
- 開頁揀「入暗號同步雲端」或者「淨係喺呢部機用」（本機模式存 localStorage，唔使 Supabase）
- 地圖同地點搜尋用 Google（Maps JS / Places / Routes），經 Edge Function 代理；冇 key 或者掛咗就自動退返 Leaflet + OpenStreetMap + Nominatim
- AI 經 Supabase Edge Function 代理（OpenRouter），API key 唔會落到呢個 HTML 度；掛咗就自動轉「複製 prompt／貼返 JSON」手動模式

## 幾個頁

| 頁 | 做乜 |
|---|---|
| 行程 | 逐日排地點：時間、分類、花費（多幣種）、備註、附件、拖拉排序、打勾當去咗；每段路顯示真實車程／步程；每日標題有天氣同天黑時間；排嘅時間撞正休息日或者關門時間會提示 |
| 地圖 | 當日／全程切換，pin 有次序號同路線，撳 pin 可以跳 Google 導航 |
| 探索 | AI 按行程推薦 10 個地點，帶相、評分、一句原因，一撳加入「想去」 |
| 想去 | 未排日期嘅收藏，隨時「排入行程」 |
| 日誌 | 逐日心情＋文字，自動存；可以叫 AI 照住當日行程幫你寫 |

## AI

1. **AI 排行程**——講你想點玩，出逐日草稿，加落現有安排後面（唔會覆蓋）
2. **貼文字抽地點**——貼 blog／IG caption／朋友清單／酒店確認信，抽地點入「想去」
3. **AI 幫我寫日誌**——照住當日打咗勾嘅地點同你自己筆記寫，唔准作嘢
4. **探索推薦**——出地點名，再經 Google Places 補真座標／評分／相

## 「而家」卡（乘客版）＋ GPS

前提：車上有第二個人。呢一版係俾**乘客**睇同讀出嚟嘅 —— 大字、少撳、一版講一件事。司機唔應該睇手機。

topbar 個橙色「而家」掣一撳就開：

```
12:06 當地時間
下一站
小樽運河
開 46 分鐘 · 38km  計埋即時路況
12:52 到           天黑前 4 小時 55 分
17:47 天黑
視界 46km · 陣風 27km/h · 20°C
〔導航去呢站〕〔到咗 ✓〕
〔官方吹雪視界〕〔官方通行止め情報〕
```

- **GPS**：`navigator.geolocation.watchPosition`。位置**只留喺呢部機**，唔會存入雲端、唔會傳去第三方；淨係用嚟計「由你而家去下一站幾遠」同「現場天氣」。設定可以熄。
- **即時路況**：`routingPreference: TRAFFIC_AWARE`。**只喺「而家」卡開**（origin＝你而家 GPS、出發＝而家），所以唔會撞 Routes API「departureTime 必須係未來」嗰條規；規劃期嘅逐日路線一律留喺 Essentials SKU。
  - 實測澀谷→東京站 7.6km：唔計路況 **19.2 分鐘**、計路況 **24.8 分鐘**（+29%）
  - Essentials 每月 10,000 免費／**Pro（TRAFFIC_AWARE）每月 5,000 免費**。一分鐘內唔重複打，一日幾十個 call，離免費額好遠
- **營業時間驗到達時間**：唔再等你手打時間才驗，用「你而家位置＋車程」推算到達，再對當日營業時間。
- **現場天氣**：Open-Meteo `current`，攞 `visibility`／`snowfall`／`wind_gusts`。12 月北海道停你嘅唔係塞車，係雪同視界。
- **地圖列有路況開關**（Google `TrafficLayer`，計入已有嘅 Dynamic Map 載入，唔另收）。默認熄，規劃期唔好花。
- **吹雪同通行止め只做導流**：一鍵去北の道ナビ官方頁，唔 parse、唔 cache、唔聲稱係 app 自己嘅資料。理由：日本冇即時通行止め嘅公開 API（JARTIC 開放資料係每月月初更新），而一個靜咗嘅 feed 顯示「通行可」會令你駛入一條封住嘅雪路。

第三方即時事故情報查過：**TomTom 日本完全冇覆蓋**（覆蓋表冇日本）；HERE 日本有覆蓋（flow＋incidents，約 30,000 transactions／月免費）但要開戶攞 key，而且文件冇寫覆蓋到邊級道路，鄉道大概率冇 —— 所以暫時唔做。

## 同步：墓碑

`mergeStates` 係 additive merge，所以一定要有墓碑（`state.del`），唔係嘅話**刪咗嘅嘢會復活**：你喺 Mac 刪走幾個決定唔去嘅點，iPhone 離線行完一日再上線，佢哋會全部返嚟，而且顯示「已儲低」。

所有刪除路徑都記墓碑（項目／清空一日／刪清單／刪旅程／AI 嘅 del op／丟掉未填嘅新項目），90 日後自動剪走。規矩：**刪贏改** —— 一邊刪咗、另一邊改過，都當刪。

實測過真實場景：呢部機記憶中仲有某項目、雲端已經刪咗並有墓碑，呢部機做改動撞版 → 合併後**冇復活**。

## 天氣同天黑時間

每日標題一行「-4°~2° · 雪 8cm · 天黑 16:03」。

- 天氣行 Open-Meteo（免 key、免登記、非商業每日 10,000 次免費），只覆蓋未來 16 日
- 天黑時間**純本地計算**（NOAA 公式），任何日期都有，唔使等到出發前
- 逐日用**當日自己嘅座標**，唔係全程一個中點 —— 札幌同東京日落差 27 分鐘，天氣更係兩回事
- 一個 request 攞齊所有日子嘅多個地點（Open-Meteo 支援多座標）
- 同一個 request 順手攞當地時區，日落計算要用

北海道十二月四點就天黑，室外行程排 15:30 之後基本摸黑 —— 呢個係做呢樣功能嘅原因。

## 營業時間衝突

Google 嘅全週營業時間已經存落 item，所以**零 API 成本**就比對得到：你排 19:00 但當日 17:00 關門、或者撞正休息日，直接喺該行提示。

解析器認英文（`9:00 AM – 5:00 PM`、`Closed`、`Open 24 hours`、多段、跨夜）同中文（`上午9:00 至 下午5:30`、`休息`、`24 小時營業`）。

⚠️ 舊版有個 bug：`openNow` 係加地點嗰一刻 Google 回嘅值，寫死落 state 之後**永遠唔更新**，但 UI 當佢係即時狀態顯示「營業中」。已修：詳情卡自己按當地時區算，行裡面唔再顯示過期狀態。

## 訂單資料

航班號／確認編號／座位／航廈四個欄，按類型改叫法（酒店＝房型／訂房編號／房號／Check-out；火車＝車次／確認編號／車廂座位／上車站）。普通地點唔會多出呢啲欄。

**貼確認信自動入行程**：AI 助手裡面貼整封機票／酒店／新幹線確認信，會連編號、座位、航廈一齊入。酒店跨日自動開入住同退房兩項；日期唔喺旅程範圍內就入「想去」並註明原定日期。

## 匯出行事曆

匯出 →「行事曆 .ics」→ 入 iPhone 日曆。用 floating local time（唔加 Z 唔加 TZID），即係旅行時見到嘅係**當地牆上時間**，唔會換算成香港時間。

折行按字元邊界做，唔可以按 byte 切 —— 切爛一個中文字成份 .ics 就廢。

## 附件

每個項目可以擺檔案（機票、酒店確認信、船票…），存 Supabase Storage 私人 bucket `trip-files`，每個檔上限 10MB。

Bucket 嘅 RLS 閘同 `trip_log` 一樣係抄 `meal_log` 個 policy——讀寫都要啱暗號。

**離線預載**：匯出或設定 →「離線準備」，出門前喺 wifi 預載當前旅程所有附件落瀏覽器 Cache。之後開附件會**先揀本機副本**，冇訊號都開得到登機證（實測：擋死網絡照開得到）。離線檔案係未加密咁擺喺瀏覽器度，同任何離線 app 一樣；唔想留就喺同一個面板清走。

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

## 每日總車程

Edge function 一直 return `totalSec`／`totalM`（Google 計好、錢已經付、byte 已經傳到手機），舊版 client 只存 `legs` 就掉咗佢哋。而家接返，每日標題顯示「車程 2 小時 18 分 · 111km」；冇真路線就用逐段直線估算加埋並標「（估）」。

⚠️ **路線最優化報嘅係直線距離，唔係車程。** 演算法唔改（實測排錯序嘅代價細），但面板一定標明係直線，並且把手上嘅真實車程一齊擺出嚟對照。北海道實際路里程係直線嘅 **1.1–2.1 倍**，繞湖／過山峠嗰段差得最遠。

## 唔做嘅嘢

- 唔做多人即時協作（一個暗號一個人用）
- 唔做機票酒店比價
- 唔預先大批下載地圖磚（OSM ToS）
- 唔做 turn-by-turn 導航／路線圖形（駕駛中用 CarPlay 上嘅 Google Maps；單人＋單一 HTML 做出嚟一定係次貨）
- 唔做過路費金額（Routes API 出得到，但日本係入口取券出口結算＋ETC 折扣，準確度未證實；出個唔準嘅數比冇數更害）
- 唔做停車場／加油站資料庫（要營業時間才有用，而營業時間係 Google Enterprise tier，每月只 1,000 免費）
- 唔自己顯示即時通行止め狀態（只做導流去官方頁，理由見上）
