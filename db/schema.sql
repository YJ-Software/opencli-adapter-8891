-- 8891 中古車資料庫 Schema
-- 設計原則：
--   cars: 主表，當前狀態（upsert），包含 list + detail 所有欄位
--   price_history: 每次價格變動記錄
--   view_history: 每次 sync 時記錄瀏覽數（可看熱度曲線）
--   sync_runs: 每次同步的統計 log

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =====================================================
-- cars: 主表（一輛車一行）
-- =====================================================
CREATE TABLE IF NOT EXISTS cars (
  id                  TEXT PRIMARY KEY,          -- 4600208

  -- ─── list 階段抓得到 ───────────────────────
  title               TEXT,                      -- Tesla Model Y 2023款 Long Range 純電
  price_wan           REAL,                      -- 135.0 (萬)
  year                INTEGER,                   -- 2022
  mileage_km          REAL,                      -- 106000 (從 "10.6萬公里")
  location            TEXT,                      -- 台中市
  updated_ago_text    TEXT,                      -- "7天前更新" / "2小時內更新"
  view_count          INTEGER,                   -- 1912
  current_viewers     TEXT,                      -- "26人在看" / NULL
  tagline             TEXT,                      -- 賣家廣告詞
  promo               TEXT,                      -- 賣點促銷文字
  badges              TEXT,                      -- "精選,真實車源"
  thumbnail_url       TEXT,                      -- 列表縮圖 (300x225)；原圖把 _300_225 換成其他尺寸或拿掉即可

  -- ─── 從 Next.js __next_f flight data 抓的 (list 階段免費附贈，無需 detail) ─
  brand_id            INTEGER,                   -- 12873 (Tesla)
  brand_en            TEXT,                      -- "Tesla"  (vs brand 欄位是 detail 拿到的 "特斯拉/Tesla")
  kind_id             INTEGER,                   -- 17967 (Model Y)
  kind_en             TEXT,                      -- "Model Y"  (與 model 欄位通常相同)
  color               TEXT,                      -- 白色 / 黑色 ...
  gas                 TEXT,                      -- "1.1L以下" / "1.6-2.0L" / "純電" 排氣量分類
  day_views           INTEGER,                   -- 今日瀏覽數 (vs view_count 為累計)
  item_post_date      TEXT,                      -- 精準刊登時間 "2026-02-28 22:14:43"
  item_renew_date     TEXT,                      -- 精準更新時間
  member_id           INTEGER,                   -- 賣家 member ID (可追同一賣家的所有刊登)
  big_image_url       TEXT,                      -- 600x450 中等尺寸
  dashboard_image_url TEXT,                      -- 儀表板實拍 (里程證據)

  -- ─── detail 階段才抓得到（相對靜態）──────────
  msrp_wan            REAL,                      -- 212.8 (新車價)
  brand               TEXT,                      -- 特斯拉/Tesla
  model               TEXT,                      -- Model Y
  license_date        TEXT,                      -- 2022/12
  fuel                TEXT,                      -- 純電
  ev_range_km         INTEGER,                   -- 480
  transmission        TEXT,
  drivetrain          TEXT,                      -- 4WD
  doors_seats         TEXT,                      -- 5門5座
  seller              TEXT,                      -- 黃先生 / 車商名
  seller_type         TEXT,                      -- 車主自售 / 車商
  conditions_json     TEXT,                      -- JSON array 車況
  highlights_json     TEXT,                      -- JSON array 亮點配置
  photos_json         TEXT,                      -- JSON array 照片 URL

  url                 TEXT,                      -- detail URL

  -- ─── 元資料 ───────────────────────────────
  first_seen_at       TEXT NOT NULL,             -- ISO8601 第一次看到
  last_seen_at        TEXT NOT NULL,             -- 最後一次 list 抓到
  detail_synced_at    TEXT,                      -- 最後一次成功抓 detail
  is_active           INTEGER NOT NULL DEFAULT 1 -- 0 = 下架/售出
);

CREATE INDEX IF NOT EXISTS idx_cars_brand_model ON cars(brand, model);
CREATE INDEX IF NOT EXISTS idx_cars_price ON cars(price_wan);
CREATE INDEX IF NOT EXISTS idx_cars_active ON cars(is_active, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_cars_detail_synced ON cars(detail_synced_at);

-- =====================================================
-- price_history: 價格變動歷史
-- =====================================================
CREATE TABLE IF NOT EXISTS price_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id       TEXT NOT NULL,
  price_wan    REAL NOT NULL,
  observed_at  TEXT NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ph_car ON price_history(car_id, observed_at);

-- =====================================================
-- view_history: 瀏覽數曲線（選用，看熱度趨勢）
-- =====================================================
CREATE TABLE IF NOT EXISTS view_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id       TEXT NOT NULL,
  view_count   INTEGER,
  observed_at  TEXT NOT NULL,
  FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vh_car ON view_history(car_id, observed_at);

-- =====================================================
-- sync_runs: 同步日誌
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  filter_args     TEXT,                          -- 例：--power 4 --max-price 150 --in-store-only
  list_count      INTEGER,                       -- 當次 list 抓到幾筆
  new_count       INTEGER,                       -- 新增幾筆
  updated_count   INTEGER,                       -- 更新幾筆
  gone_count      INTEGER,                       -- 變 inactive 幾筆
  detail_count    INTEGER,                       -- 這次跑了幾筆 detail
  error           TEXT                           -- 若失敗紀錄錯誤
);
CREATE INDEX IF NOT EXISTS idx_sr_started ON sync_runs(started_at);
