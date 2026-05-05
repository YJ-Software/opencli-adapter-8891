# opencli-adapter-8891

個人 [OpenCLI](https://github.com/jackwener/OpenCLI) 轉接器套件。目前提供完整的 **[8891 中古車](https://auto.8891.com.tw/)** （台灣最大中古車交易平台）轉接器，涵蓋所有側欄篩選條件，並附帶可選的本地 SQLite 同步功能。

## 安裝

> **重要：** opencli >= v1.7.2 僅載入 `.js` 轉接器（`.ts` 原始碼會被忽略並顯示警告）。本 repo 同時提供 `.ts`（原始碼）和預先編譯的 `.js`，因此直接 clone 就能使用，不需要額外建置步驟。

```bash
# 1. 前置需求
npm install -g @jackwener/opencli
opencli doctor    # 確認 daemon 和 Browser Bridge 擴充功能已連線

# 2. 一行安裝 — 直接 clone 到 opencli 的 adapter 目錄
git clone https://github.com/YJ-Software/opencli-adapter-8891.git ~/.opencli/clis/8891

# 3. 驗證 — 應該看到 2 個命令，且沒有「Ignoring TypeScript adapter」警告
opencli list | grep 8891
#   8891
#     detail [cookie] - ...
#     list [cookie] - ...
```

### 更新

```bash
cd ~/.opencli/clis/8891 && git pull
```

### 關於 TypeScript 警告

安裝後執行 `opencli list` 時，可能會看到以下警告：

```
⚠  Ignoring TypeScript adapter ~/.opencli/clis/8891/detail.ts — .ts adapters are no longer loaded.
⚠  Ignoring TypeScript adapter ~/.opencli/clis/8891/list.ts — .ts adapters are no longer loaded.
```

**這不影響功能** — opencli 會忽略 `.ts` 檔，實際載入的是同目錄下的 `.js` 檔。如果想消除警告，刪除 `.ts` 原始檔即可：

```bash
cd ~/.opencli/clis/8891
rm -f list.ts detail.ts
```

> 💡 `.ts` 是原始碼，僅供需要修改 adapter 邏輯時使用。若不需要編輯原始碼，刪除後完全不影響使用。日後需要時可透過 `git checkout -- *.ts` 還原。

### 編輯 .ts 原始碼後重新建置

若修改了 `list.ts` / `detail.ts` / `electric.ts`，需重新建置：

```bash
cd ~/.opencli/clis/8891
npm install           # 首次執行，安裝 typescript + @types/node
npm run build         # tsc 編譯 .ts → .js（放在原始碼旁邊）
```

tsc 會產生關於無法解析 `@jackwener/opencli/registry` 和 `node:fs` 的型別警告 — 這些是表面性的（全域安裝的 opencli 套件和 Node stdlib 不在建置的模組解析路徑中）。產出的 `.js` 檔案是正確的，可以正常運作。

---

## 轉接器一覽

| 命令 | 說明 |
|------|------|
| `opencli 8891 list` | 通用列表查詢，支援 **28 個篩選條件** — 涵蓋所有側欄選項，加上關鍵字搜尋、里程範圍、排序 |
| `opencli 8891 detail` | 單一車輛完整資訊 — 規格、車況、亮點配備、照片、賣家 |


### 輸出格式

所有命令預設輸出 YAML 表格。加 `--format json` 以供程式處理：

```bash
opencli 8891 list --power 純電 --limit 3 --format json
```

---

## `8891 list` — 完整篩選參考

全部 28 個 flag 可自由組合。名稱接受中文 / 英文 / slug。

### 關鍵字搜尋

| Flag | 說明 |
|------|------|
| `--search` | 自由文字關鍵字搜尋。可與其他所有篩選條件疊加。支援中英文。範例：`--search "Model Y Long Range"` 或 `--search 勞斯萊斯` |

### 分類篩選

| Flag | 可用值 | 說明 |
|------|--------|------|
| `--brand` | slug / 英文 / 中文 | `tesla` / `Tesla` / `特斯拉` — 共 66 個品牌 |
| `--kind` | slug / 名稱 | `model-y` / `"Model Y"` — 必須搭配 `--brand` 使用 |
| `--power` | 燃料名稱或 0-4 | `0`=汽油(gasoline) / `1`=柴油(diesel) / `2`=油電複合(hybrid) / `3`=瓦斯雙燃料(lpg) / `4`=純電(electric)。多選逗號分隔：`--power 2,4` 或 `--power hybrid,ev` |
| `--body` | 車種 | `轎車`/`休旅車`/`貨車`/`吉普車`/`其他` 或 `sedan`/`suv`/`truck`/`jeep`/`other` |
| `--color` | 顏色名稱 | `白`/`紅`/`銀`/`灰`/`黑`/`黃`/`橙`/`綠`/`藍`/`紫`/`棕`/`粉` + 英文名稱 |
| `--transmission` | 變速系統 | `手排`/`自排`/`自手排`/`手自排` 或 `manual`/`automatic`/`amt`/`tiptronic` |
| `--drivetrain` | 驅動方式 | `2WD`/`4WD`/`AWD`/`FWD`/`RWD`/`前驅`/`後驅`/`四驅` |
| `--doors` | 2-6 | 車門數，逗號多選：`--doors 4,5` |
| `--seats` | 2-10 / 12 / 12+ | 乘客數；`12+` 代表 12 座以上 |
| `--region` | 縣市或分組 | 單一縣市名稱（`台北`/`台中`/...）或地區分組（`北部`/`中部`/`南部`/`東部`/`離島`） |

### 範圍篩選

| Flag | 單位 | 範例 |
|------|------|------|
| `--min-price` / `--max-price` | 萬（新台幣 × 10,000） | `--max-price 150` |
| `--year-from` / `--year-to` | 絕對年份 | `--year-from 2020 --year-to 2024` |
| `--max-age` / `--min-age` | 相對車齡（年） | `--max-age 3`（3 年以內） |
| `--min-cc` / `--max-cc` | cc | `--min-cc 1600 --max-cc 2000` |
| `--min-liter` / `--max-liter` | L | `--min-liter 1.6 --max-liter 2.0` |
| `--min-mileage` / `--max-mileage` | km | `--max-mileage 50000`（客戶端篩選） |
| `--min-mileage-wan` / `--max-mileage-wan` | 萬 km | `--max-mileage-wan 5` = 50000 km |

> **里程篩選備註：** 8891 沒有伺服器端里程篩選（僅有排序選項）。`--max-mileage` 是在**客戶端**擷取後才套用 — 它會自動啟用 `sort=mile-asc`，使翻頁在里程超過上限時能提前停止。單獨使用 `--min-mileage` 時不會自動排序；建議先用 `--brand` / `--year-from` 等條件縮小範圍，以降低掃描成本。頁面掃描上限為 **15 頁**（約 600 輛車），以符合 opencli 60 秒命令超時限制。

### 排序

| Flag | 可用值 | 說明 |
|------|--------|------|
| `--sort` | `price` / `year` / `mile` / `gas`，可加 `-asc`/`-desc` 後綴 | 預設方向為 `-asc`。完整清單：`price-asc`、`price-desc`、`year-asc`、`year-desc`、`mile-asc`、`mile-desc`、`gas-asc`、`gas-desc` |

**互斥條件**（同時使用會拋出明確的錯誤訊息）：
- `--year-from/--year-to` 與 `--max-age/--min-age`（兩者都操作年份範圍）
- `--min-cc/--max-cc` 與 `--min-liter/--max-liter`（兩者都設定排氣量）

### 布林開關

| Flag | 8891 對應功能 |
|------|--------------|
| `--in-store-only` | 排除不在店 |
| `--personal-only` | 個人自售 |
| `--audit-only` | 8891 認證車 |
| `--premium-only` | 8891 嚴選 |
| `--recent-only` | 最新刊登（約 7 天內） |
| `--has-video` | 影片看車（僅顯示有影片的車輛） |

### 分頁

| Flag | 預設值 | 說明 |
|------|--------|------|
| `--limit` | 20 | 回傳筆數上限。8891 每頁 40 筆，超過 40 筆時會自動翻頁抓取直到達標。例：`--limit 100` 會抓 3 頁 |
| `--page` | 1 | 起始頁碼；搭配 `--limit` 可跳頁 |

### 列表輸出欄位

```
rank, id, title, brand, brand_id, model, kind_id, color, gas,
price, year, mileage, location,
updated_ago, view_count, day_views, current_viewers,
tagline, promo, badges,
item_post_date, item_renew_date, member_id,
thumbnail, big_image, dashboard_image, url
```

重點欄位：
- `view_count` / `day_views` — 累計瀏覽數 + 今日瀏覽數，適合追蹤趨勢
- `current_viewers` — 即時在看人數（`26人在看`）
- `item_post_date` / `item_renew_date` — 精確時間戳（vs 模糊的 `updated_ago`）
- `member_id` — 賣家 ID（可追蹤同一賣家的所有刊登）
- `thumbnail` / `big_image` / `dashboard_image` — 300×225 / 600×450 / 儀表板實拍照
- `brand_id` / `kind_id` — 穩定的 8891 整數 ID，適合做資料表 join

---

## `8891 list` — 使用範例

### 依情境

**電動車選購** — 150 萬以下、在店、3 年內：
```bash
opencli 8891 list --power 純電 --max-price 150 --max-age 3 --in-store-only
```

**家庭休旅** — 7 人座、四驅、2.0-3.0L、中南部、3 年內：
```bash
opencli 8891 list --body 休旅車 --seats 7 --drivetrain 4wd \
  --min-liter 2.0 --max-liter 3.0 --region 中部,南部 --max-age 3
```

**手排跑車** — 2 門、手排變速、200-400 萬、2020 年後：
```bash
opencli 8891 list --body 跑車 --transmission 手排 --doors 2 \
  --min-price 200 --max-price 400 --year-from 2020
```

**追蹤特定車型** — 北部所有認證 Tesla Model Y：
```bash
opencli 8891 list --brand tesla --kind model-y --region 北部 \
  --audit-only --limit 100
```

**撿便宜** — 高里程老車、30 萬以下、僅看最新刊登：
```bash
opencli 8891 list --max-price 30 --min-age 10 --recent-only
```

**追蹤每日新品** — 北部 2025 年款新車、有影片：
```bash
opencli 8891 list --region 北部 --year-from 2025 --recent-only --has-video
```

**關鍵字搜尋** — 標題含 "Long Range"、150 萬以下：
```bash
opencli 8891 list --search "Long Range" --max-price 150
```

**中文關鍵字** — 搜尋所有勞斯萊斯：
```bash
opencli 8891 list --search 勞斯萊斯
```

**低里程車** — 5 萬公里以內：
```bash
opencli 8891 list --max-mileage-wan 5 --limit 20
```

**特斯拉 3-8 萬公里** — 先縮小範圍讓客戶端篩選更快：
```bash
opencli 8891 list --brand tesla --power 純電 \
  --min-mileage-wan 3 --max-mileage-wan 8
```

**依價格排序** — 最便宜的 20 輛：
```bash
opencli 8891 list --sort price-asc --limit 20
```

**最新特斯拉** — 依年份降序排列：
```bash
opencli 8891 list --brand tesla --sort year-desc --limit 10
```

### 「超級組合」 — 同時啟用 10 個篩選條件

```bash
opencli 8891 list \
  --region 北部 --power 純電 --color 白,銀 --max-age 3 \
  --max-price 200 --seats 5 --audit-only --has-video --in-store-only \
  --limit 5
```

回傳結果（截至 2026-04）：2 輛白色 Ford Mustang Mach-E，位於新北市，2023 年款，約 143 萬。

---

## `8891 detail` — 單車詳細資訊

```bash
# 查詢單一車輛
opencli 8891 detail --id 4600208

# 批次查詢（逗號分隔）
opencli 8891 detail --ids 4600208,4632355,4635078 --delay-ms 500
```

| Flag | 預設值 | 說明 |
|------|--------|------|
| `--id` | — | 單一車輛 ID |
| `--ids` | — | 逗號分隔的多個 ID，用於批次查詢 |
| `--delay-ms` | 300 | 批次請求之間的延遲（毫秒） |

### 詳情輸出欄位

```
id, title, price, msrp, brand, model, year, license_date,
mileage, fuel, ev_range, transmission, drivetrain, doors_seats,
location, seller, seller_type（車主自售 / 車商）,
conditions, highlights, photo_count, photos, url
```

> **備註：** 詳情頁僅預載 3~15 張縮圖；完整相簿需點擊展開才會載入。目前版本擷取的是 DOM 中已載入的照片。

### 兩階段工作流程

每筆 detail 擷取約需 4 秒；245 輛車全部拉 detail 需 16 分鐘以上。建議先用 `list` 取得 ID，再對需要的車輛執行 `detail`：

```bash
# 第一階段 — 典型篩選結果約 30 秒
opencli 8891 list --brand tesla --power 純電 --region 北部 \
  --format json --limit 1000 > candidates.json

# 第二階段 — 僅對前 10 輛取得詳情
python -c "import json;print(','.join(x['id'] for x in json.load(open('candidates.json'))[:10]))" \
  | xargs -I{} opencli 8891 detail --ids {}
```

---

## 本地 SQLite 資料庫（選用）

參見 [`db/`](db/) — 一個 Python 同步腳本，將 OpenCLI 的輸出持久化到 SQLite，以便執行歷史查詢。**跨平台**：純 Python 標準函式庫，已在 Windows 測試，Linux/macOS 無需修改即可運作。

快速開始：
```bash
cd ~/.opencli/clis/8891/db
python sync.py --brand tesla --power 純電 --max-price 200 --in-store-only
```

sync 腳本接受 **`list` 的所有篩選條件** 作為透傳參數，因此任何用 `opencli 8891 list` 執行的查詢，都可以透過在前面加上 `python sync.py` 來持久化到資料庫。

資料庫包含：
- `cars` — 當前狀態（upsert），44 個欄位
- `price_history` — 每次價格變動的歷史紀錄
- `view_history` — 每次同步的瀏覽數快照（趨勢追蹤）
- `sync_runs` — 每次同步執行的日誌

內建安全機制：若 list 回傳數量不到當前 active 車輛的 50%，會自動拒絕將缺席車輛標為 `is_active=0`（防止用 `--limit 3` 測試時誤標下架）。

完整文件請見 [`db/README.md`](db/README.md)，13 個現成的 SQL 查詢範例請見 [`db/queries.sql`](db/queries.sql)（最大折扣、降價追蹤、瀏覽數增長、品牌統計等）。

---

## 開發者 / 未來 Claude session 參考

技術參考請見 [`CLAUDE.md`](CLAUDE.md)：URL 參數速查表、網站特殊行為、如何新增篩選條件、如何重新產生 `brands.json`、以及讓 `list.ts` 跳過 lazy-load 問題取得豐富 metadata 的 flight-data 解析技術。
