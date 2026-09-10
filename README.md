# 大車叫車 — 17噸大貨車即時媒合（Phase 1B：真後端 MVP）

兩支 React Native（Expo）App + Supabase 後端。介面比照 Uber / Uber Driver，只做兩個改動：
車輛是 **17噸大貨車**、貨量以 **棧板（托）** 計量並選擇 **貨物種類**。

```
truck-uber/
├─ apps/customer/      客戶端 App（工廠出貨）
├─ apps/driver/        司機端 App（大車司機）
├─ packages/shared/    共用：型別、Backend 介面、Supabase 實作、模擬後端、計價引擎、路線、GPS、推播、UI、地圖
├─ supabase/
│  ├─ migrations/0001_schema.sql   完整 schema：12 張表、RLS、13 個 RPC、推播 trigger
│  └─ tests/                       本機 Postgres 可跑的狀態機測試（不需要 Supabase）
└─ admin/index.html    單頁管理後台（supabase-js，直接用瀏覽器開）
```

## 架構一句話

畫面只認 `packages/shared/src/backend.ts` 的 `Backend` 介面。`supabaseBackend.ts` 是正式實作（Auth + RPC + Realtime），
`mockServer.ts` 是離線示範。**所有狀態轉換、計價、分帳都在 Postgres 的 SECURITY DEFINER 函式裡**，
App 端不能直接改 `orders`；兩支手機透過 Supabase Realtime 看到同一筆訂單的每一次變化。

```
客戶 App ──create_order──▶ orders(created) + payments(pending)
        ──pay_order_sandbox──▶ paid → searching → dispatch_order() 找最近的上線司機 → offered(15 秒)
司機 App ◀── Realtime: offered_driver_id = 我 ──┘
        ──respond_offer(true)──▶ accepted（快照司機/車牌到訂單）
        ──advance_order──▶ arrived → in_transit → delivered → completed（寫入 driver_earnings 帳本）
客戶 App ◀── Realtime: orders.id = 這單 ──┘   ◀── Realtime: driver_locations.driver_id = 司機 ──┘
        ──rate_order──▶ 評分、司機平均分
每一步都寫一筆 order_events（不可變事件紀錄）。
```

## 一、建立 Supabase 專案（約 10 分鐘）

1. 到 https://supabase.com 建立專案（區域選 Singapore / Tokyo 較近）。
2. **SQL Editor** → 依序貼上 `supabase/migrations/0001_schema.sql`、`0002_addons.sql` 全文 → Run（每個檔案一次）。
   （或用 CLI：`supabase link --project-ref xxx && supabase db push`）
3. **Database → Extensions** → 啟用 `pg_net`（推播用；不啟用也能跑，只是沒有推播）。
4. **Authentication → Providers → Email**：測試期建議把 *Confirm email* 關掉，註冊後可直接登入。
5. **Project Settings → API**：複製 `Project URL` 與 `anon public` key。
6. 在 `apps/customer/` 與 `apps/driver/` 各建立 `.env`（複製 `.env.example`）：
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   EXPO_PUBLIC_BACKEND=supabase
   ```
7. 建立管理員：先用任一 App 註冊一個帳號，然後在 SQL Editor 執行
   `update public.profiles set role='admin' where id = (select id from auth.users where email='you@x.tw');`

## 二、在兩支手機上跑（Expo Go 即可完成兩機測試）

```bash
npm install
npm run customer     # 終端機 1 → 手機 A 用 Expo Go 掃 QR
npm run driver       # 終端機 2 → 手機 B 用 Expo Go 掃 QR
```

Expo Go 可以測完整流程（登入、下單、沙盒付款、即時派單、接單、GPS 位置、狀態同步、收入、歷史）。
**只有推播通知需要 development build**（SDK 53 起 Expo Go 不支援遠端推播），見第四節。

### 兩機驗收流程（Phase 1B Definition of Done）

| 步驟 | 手機 A（客戶端） | 手機 B（司機端） |
|---|---|---|
| 1 | 註冊（角色自動為 customer） | 註冊（填車牌 → 自動建立 drivers + vehicles，狀態 pending） |
| 2 | 首頁 → 要送到哪裡 → 選起點/終點（可搜尋地址或用常用地點） | 按「上線」→ 允許定位 → 位置每 5 秒回報 |
| 3 | 棧板數 8 托 → 貨物種類 → 下一步 | — |
| 4 | 車種：顯示 OSRM **道路里程** 與伺服器同款公式的報價 → 確認叫車 | — |
| 5 | 結帳頁 → 「付款（沙盒）」→ 產生 payments(paid) 並開始派單 | 立刻收到派單卡（15 秒倒數、司機實收金額） |
| 6 | 畫面變成「司機已接單」，顯示司機姓名/車牌、卡車圖示跟著真實 GPS 移動 | 按「接單」 |
| 7 | 依序看到：已抵達 → 運送中 → 抵達卸貨點 → 完成 | 依序按：已抵達裝貨點 → 裝貨完成開始運送 → 已抵達卸貨點 → 確認卸貨完成 |
| 8 | 收據頁 → 評分 → 行程頁出現歷史 | 收入頁：本趟寫入 driver_earnings（pending，7 天後可撥款）；趟數 +1 |
| 9 | 重開 App：歷史仍在（來自後端） | 重開 App：收入與歷史仍在；上線狀態保留 |

管理後台：用瀏覽器開 `admin/index.html`，輸入 URL/anon key，用 admin 帳號登入 → 看訂單/事件紀錄、驗證司機與車輛、取消訂單（自動標記退款）、調整計價參數、把收入標記為已撥款。

## 二之一、客戶端網頁版（不用上架，工廠客戶開瀏覽器就能叫車）

同一份客戶端程式碼可以輸出成靜態網站（地圖在網頁上直接用 Leaflet，其他畫面共用）：

```bash
cd apps/customer
npm run build:web               # 讀 .env 裡的 Supabase 設定 → 產生 dist/
npx vercel deploy dist --prod   # 或把 dist/ 拖到 Netlify / Cloudflare Pages；vercel.json 已處理 SPA 路由
```

網頁版支援：登入註冊、地址搜尋、道路里程報價、沙盒付款、即時看司機位置與狀態、收據評分、歷史。
不支援：推播。建議組合：**客戶端 = 網頁版、司機端 = Android APK（EAS preview）+ iPhone 用 Expo Go**，
等有付費客戶再花錢上架 iOS。

## 三、本機驗證（不需要 Supabase）

```bash
npm run typecheck                       # 兩支 App 的 TypeScript
cd apps/customer && npx expo export --platform ios     # Metro 打包
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh   # 在本機 Postgres 跑 migration + 完整狀態機測試
```

`supabase/tests/state_machine.sql` 會走完：下單 → 付款 → 無司機時停在 searching → 遠方司機不派 → 近的司機收到派單 → 拒單 → 重派 → 逾時 → 接單 → 跳步被擋 → GPS 稀疏軌跡 → 完成 → 分帳帳本 → 評分 → 取消退款 → 司機下線釋放派單 → admin 驗證 → 客戶不能自己改 role。

## 四、TestFlight / Android 封測（EAS）

```bash
npm i -g eas-cli && eas login
cd apps/customer && eas init          # 把產生的 projectId 填進 app.json 的 extra.eas.projectId
eas build --profile development --platform ios      # 裝到自己的手機，推播可用
eas build --profile preview --platform android      # APK 給司機側測
eas build --profile production --platform ios && eas submit -p ios   # TestFlight
```
`eas.json` 的三個 profile 都把 `EXPO_PUBLIC_BACKEND=supabase`；Supabase URL/key 用 `eas secret:create` 或 EAS 環境變數設定。
司機端同樣步驟（`apps/driver`）。

## 五、目前刻意的簡化與下一步

- **付款是沙盒**：`pay_order_sandbox` 直接標記 paid，但 payments / platform_fee / driver_earnings 全部照正式邏輯建立。接 TapPay / ECPay / Stripe 時：金流 webhook → 同一段狀態變更。
- **撥款未實作**：帳本有 pending → available（7 天）→ paid，admin 可手動標記；正式撥款等市場驗證後再做。
- **派單 = 最近的上線司機**（`dispatch_order`）：半徑 60 km、避開拒單/逾時過的司機、一次一位。之後換成更聰明的引擎只改這個函式。
- **驗證**：drivers / vehicles / operators 都有 `verification_status`，admin 手動改；`pricing_config.require_verification=false` 讓測試期未驗證也能接單，正式上線改成 true。
- **GPS 只在前景**：司機 App 開著時每 5 秒上傳；背景定位需 dev build + 背景權限（Phase 2）。
- **路線用 OSRM 公開伺服器**（`EXPO_PUBLIC_OSRM_URL` 可換自架），失敗時退回直線 ×1.28 並記錄 `distance_source='estimate'`；伺服器會檢查客戶端送的里程是否合理。
- **加價項目**（`0002_addons.sql`）：客戶可勾「需要升降尾門」（每趟 `tail_lift_fee`）與「額外隨車搬運工 0–2 人」（每人 `helper_fee`）；加價不打回頭車折扣；需尾門的單只派給 `vehicles.has_tail_lift = true` 的車（司機註冊時勾選、後台可改）。其餘裝卸設備與四種搬運模式仍在 Phase 2。
- **地址搜尋用 Nominatim**（每秒 1 次限制，已 debounce），常用地點仍是內建清單。
- 通話用系統電話 / 簡訊；站內聊天、裝卸設備選項、四種搬工模式、棧板拍照、AI 派單/定價都在 Phase 2。
