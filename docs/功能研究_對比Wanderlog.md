# 功能研究：eva-trip 對比 Wanderlog 同其他工具

調查日：2026-09-14 · 對比對象：Wanderlog、TripIt Pro、Polarsteps、Journi、Mindtrip／Layla、NAVITIME／Jorudan

---

## 一、先講你已經追上、甚至贏嘅地方

唔好以為樣樣都追落後。逐項對照之後：

| 功能 | Wanderlog | eva-trip |
|---|---|---|
| 逐日行程＋地圖＋路線 | ✅ | ✅ |
| 路線最佳化 | ✅ | ✅（最近鄰＋2-opt） |
| 真實車程／步程 | ✅ | ✅（Routes API） |
| 多幣種花費 | ✅ | ✅ |
| 營業時間（今日＋全週） | ✅ | ✅ |
| 評分／相／電話／網址 | ✅ | ✅ |
| 附件（機票酒店確認信） | Pro | ✅（免費，仲加咗 no-store 防漏） |
| 探索推薦 | ✅ | ✅ |
| 打勾當去咗 | ✅ | ✅ |
| 離線 | **Pro 收費** | ✅（service worker） |
| 匯出分享頁 | ✅ | ✅ |
| 列印 | ✅ | ✅ |
| **AI 一鍵生成整份行程** | **❌ 冇**（Reddit 最多人投訴嘅缺失） | ✅ |
| 貼文字抽地點 | ❌ | ✅ |
| AI 幫寫日誌 | ❌ | ✅ |

Reddit 對 Wanderlog 兩大不滿：**冇「生成 3 日行程」一鍵功能**、**效能慢**。兩樣你都冇問題。
Wanderlog Pro 收 US$39.99／年嘅四樣（離線地圖、Gmail 自動匯入、航班狀態、匯出 Google Maps），你三樣已經免費有或者做得到。

---

## 二、查到嗰陣順手發現嘅一個 bug

`openNow` 係加地點嗰一刻 Google 回嘅值，寫死落 state，**之後永遠唔會再更新**（index.html:1771 只寫一次，1437／1947 當佢係即時狀態顯示「營業中」／「休息」）。

即係你今日下午加淺草寺 → 標「營業中」；十二月早上七點開 app 睇，佢照樣寫「營業中」。

修法（唔用額外 API）：`x.hours` 已經存咗全週文字，直接同當地時間比對自己算開唔開，或者索性唔顯示個 chip、只顯示今日時間。**成本幾乎零，建議一齊做。**

---

## 三、真正嘅缺口，分三級

### A 級——抵做、平、而且你十二月即刻用得着

**1. 天氣＋天黑時間（最高回報）**
Open-Meteo：無 key、免登記、非商業每日 10,000 次免費，16 日預報含氣溫、雨量、**雪量**、日出日落。實測過，得。
天黑時間更可以**零 API 純計算**（NOAA 公式，我校驗過同實測差 4 分鐘內）。

點解對你特別重要——我算咗你行程嗰兩個城市：

| | 日出 | 日落 |
|---|---|---|
| 東京 2026-12-01 | 06:33 | **16:30** |
| 札幌 2026-12-01 | 06:46 | **16:03** |
| 札幌 2026-12-15 | 07:00 | **16:01** |

札幌四點就天黑。任何室外行程排 15:30 之後基本上摸黑。而且十二月北海道落雪，雪量預報直接影響去唔去得。
做法：每日標題擺一行「-4°C～2°C · 雪 8cm · 16:03 天黑」；超出 16 日預報範圍就只顯示天黑時間（純計算，任何日期都有）。
⚠️ Open-Meteo 歷史／氣候平均 endpoint 我實測嗰陣係 `error: Something went wrong`，所以「往年同期平均」呢個 fallback 未證實得，要用先再試。

**2. 開放時間衝突警示**
你已經存咗全週營業時間，但冇同你排嘅時間比對。加個檢查：「你排 19:00 到，但呢間星期一 17:00 關門」、「星期二休息」。
**零 API 成本**，純本地比對。十五日行程手動核對三十幾個地點係好易漏嘅。

**3. 訂單結構化欄位**
TripIt 嘅核心價值就係呢樣。你現在只有 `note` 一個自由欄。加：航班號、確認編號、座位、航廈、Check-in 時間、酒店電話。
早上六點喺機場、手機有格冇格都要即刻攞到確認號——呢個係實戰需求，唔係錦上添花。

**4. 貼確認信 → 自動建航班／酒店項目**
你已經有「貼文字抽地點」。再加一個 intent：貼整封 HK Express／樂天旅遊確認信 → 自動出航班項目（日期、起飛降落時間、航班號、確認號）同酒店項目（Check-in／out 日期、地址、電話）。
Wanderlog 要 Pro 接 Gmail 做呢樣，你貼一次文字就搞完，功夫係佢十分之一。

**5. 行程日操作：整日推移／複製／複製整個行程**
「第三日整日推後一日」、「複製呢一日」、「今次行程做 template 開下次」。Wanderlog 有，你冇。純本地邏輯，便宜，但長行程執行改期時係救命功能。

**6. 匯出 .ics 到 iPhone 行事曆**
一個純文字檔，零 API。行程直接入你部電話行事曆，鎖屏就見到下一站。Wanderlog 呢方面做得差。

**7. 附件離線預載**
現在附件係即時經 Supabase 攞。飛機上／札幌地鐵冇訊號 = 登機證開唔到。
做法：service worker 喺出發前預載當前行程所有附件。**呢個係現有功能嘅實戰漏洞，唔係新功能。**

---

### B 級——有價值，但可以等

**8. 交通真實班次時間**
你用 Routes API 已經攞到時長，但冇班次時間。Google Routes 嘅 TRANSIT 模式可以回出發／到達時間同路線名。日本仲有 NAVITIME／Jorudan 做 JR Pass 過濾（Jorudan 仲會顯示 IC 卡票價 vs 單程票價，同幫你計 JR Pass 值唔值）。
Google 免費額 10,000／月夠用。中等工程。

**9. 相片日誌（結構性最大嘅缺口）**
你原本嘅需求係「plan **and log** my tour」。planning 一半做得好，logging 一半仍然只係純文字。
Polarsteps／Journi 整個生意就係呢樣：相片按時間地點自動排成時間線。你now已經有 Storage 同座標，補相片入日誌係順理成章。

**10. 旅程統計／回顧**
Polarsteps 賣點：行咗幾多公里、去過幾多個地方、路線圖。你 items 已經有座標、logs 有文字——「行咗 342km、去咗 23 個地方、食咗 11 餐」＋一張總路線圖，計算量細，但係「記錄」嗰半嘅回報高。

**11. 全域搜尋**
兩個項目唔緊要，十五日六十個項目就緊要。

**12. 整日匯出 Google Maps 導航**
`maps/dir/?api=1&origin=…&waypoints=A|B|C&travelmode=transit`，最多十個點，**免費、唔計 API 額**。Wanderlog 要 Pro 先有。（格式我未實測）

**13. 打包清單**
Wanderlog 有 checklist。你有 per-item `checks` 但冇行程級清單。十二月北海道（雪靴、暖包、保濕）叫 AI 按目的地同季節生成一次就搞定。

---

### C 級——建議明確唔做

| 功能 | 唔做嘅原因 |
|---|---|
| 協作／實時共編 | 你係單人一個暗號。要做等於要做使用者身份系統。 |
| 分帳 settle-up | 同上，冇多人身份就冇意義。 |
| 即時航班狀態 | 免費 API 得 100 次／月（AviationStack），AeroDataBox 要 US$7.50／月。航空公司自己 app 免費做得更好。 |
| 機票酒店比價／訂房 | 已經寫入 README 唔做範圍。 |
| Guides／UGC 內容庫 | 要內容生態，你冇。 |
| Gmail 自動掃信 | 要 OAuth ＋ 常駐 server。貼封信入去用 AI 抽，一成功夫做到九成效果。 |

---

## 四、建議下一步

打包做一個「十二月北海道出發前準備」批次，全部 A 級、全部平、只加一個免費無 key 嘅 API：

1. 修 `openNow` 過期 bug
2. 天氣＋天黑時間（Open-Meteo ＋ 本地日落計算）
3. 開放時間衝突警示
4. 訂單欄位（航班號／確認號／座位／航廈）
5. 貼確認信 → 自動建航班酒店
6. .ics 匯出
7. 附件離線預載
8. 整日推移／複製

新增外部依賴：Open-Meteo 一個（免費、無 key、無帳號）。Google API 用量：零增加。

---

## 資料來源

- Wanderlog 官方：[功能頁](https://wanderlog.com/)、[行程規劃](https://wanderlog.com/plan-a-trip)、[分帳](https://wanderlog.com/travel-budget-expense-splitting-app)、[Chrome 擴充](https://wanderlog.com/extension)、[說明中心](https://help.wanderlog.com/hc/en-us)
- Wanderlog 評測／投訴：[tripstone（Reddit 整理）](https://tripstone.app/blog/wanderlog-review)、[Wandrly](https://wandrly.app/reviews/wanderlog/)、[Pro 定價](https://monkeyeatingmango.com/blog/wanderlog-pricing-2026/)、[vs Google My Maps](https://www.wandrly.app/comparisons/wanderlog-vs-google-my-maps)
- TripIt：[官方 flight alerts 說明](https://help.tripit.com/en/support/solutions/articles/103000063296-flight-alerts)、[Going 評測](https://www.going.com/guides/tripit-review)、[定價](https://monkeyeatingmango.com/blog/tripit-pricing-2026/)
- 旅程記錄類：[Polarsteps 評測](https://www.wandrly.app/reviews/polarsteps)、[日誌 app 對比](https://trippytaless.com/blogs/best-travel-journal-apps-2026/)
- AI 規劃：[Layla 對比](https://layla.ai/blog/ai-travel-planners-comparison)、[SearchSpot 對比](https://www.searchspot.ai/blog/i-tried-every-popular-ai-trip-planner-so-you-dont-have-to-2026)
- 日本交通：[japan-guide 路線工具](https://www.japan-guide.com/e/e2323.html)、[JR Pass app 推薦](https://www.jrpass.com/blog/mobile-apps-to-make-the-most-of-your-japan-rail-pass)、[NAVITIME](https://japantravel.navitime.com/en/area/jp/route/)
- API：[Open-Meteo](https://open-meteo.com/)、[AeroDataBox 定價](https://aerodatabox.com/pricing/)、[免費航班 API 對比](https://thunderbit.com/blog/best-flight-api-with-free-tiers)
