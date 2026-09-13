# 旅程記錄（eva-trip）

私人行程規劃＋旅程日誌。跟 `eva-meal` 同一套：單一 `index.html`、冇 build step、GitHub Pages 託管、資料存 Supabase（RLS 暗號閘）。

- 手機「加至主畫面」即似 app（有 manifest＋icon）
- 開頁揀「入暗號同步雲端」或者「淨係喺呢部機用」（本機模式存 localStorage，唔使 Supabase）
- 地圖用 Leaflet + OpenStreetMap，地點搜尋用 Nominatim——都係免費、唔使 API key
- AI 經 Supabase Edge Function 代理，API key 唔會落到呢個 HTML 度；未 deploy 就自動轉「複製 prompt／貼返 JSON」手動模式

## 四個頁

| 頁 | 做乜 |
|---|---|
| 行程 | 逐日排地點：時間、分類、花費、備註、上下移、按時間排、打勾當去咗 |
| 地圖 | 當日／全程切換，pin 有次序號同虛線路線，撳 pin 可以跳 Google 導航 |
| 想去 | 未排日期嘅收藏，隨時「排入行程」 |
| 日誌 | 逐日心情＋文字，自動存；可以叫 AI 照住當日行程幫你寫 |

## AI 三招

1. **AI 排行程**——講你想點玩，出逐日草稿，加落現有安排後面（唔會覆蓋）
2. **貼文字抽地點**——貼 blog／IG caption／朋友清單／酒店確認信，抽地點入「想去」
3. **AI 幫我寫日誌**——照住當日打咗勾嘅地點同你自己筆記寫，唔准作嘢

AI 加完地點會自動排隊去 Nominatim 攞座標（一秒一個，唔會轟人哋 server）。

## 設定

### 1. Supabase 表

喺 SQL Editor 行 `supabase/schema.sql`，記得將 `你嘅暗號` 換做真嘅（同飲食記錄用同一個都得）。

### 2. AI 代理（可以遲啲先做）

```bash
supabase functions deploy trip-ai --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx TRIP_GATE=你嘅暗號
```

未 deploy 之前，撳 AI 掣會出手動模式：複製 prompt → 貼落 Claude → 貼返個回覆 → 套用。功能一樣，只係多兩步。

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
manifest.json       PWA
icon-{180,192,512}.png
share/index.html    唯讀分享頁
share/data.json     分享資料（由 app 匯出）
supabase/schema.sql 表 + RLS 暗號閘
supabase/trip-ai.ts Edge Function（AI 代理）
```

## 唔做嘅嘢

- 唔做多人即時協作（一個暗號一個人用）
- 唔存相（Supabase 一行 JSON 唔啱擺相；要嘅話另外開 Storage）
- 唔做機票酒店比價
