-- =====================================================
-- 8891 資料庫常用查詢範例
-- 用法：sqlite3 cars.db < queries.sql
--      或 python -c "import sqlite3;conn=sqlite3.connect('cars.db');print(list(conn.execute(open('queries.sql').read())))"
-- =====================================================

-- ─── 0. 資料庫概況 ──────────────────────────────
-- 目前狀態
SELECT
  (SELECT COUNT(*) FROM cars WHERE is_active=1)     AS active,
  (SELECT COUNT(*) FROM cars WHERE is_active=0)     AS inactive,
  (SELECT COUNT(*) FROM cars)                       AS total,
  (SELECT COUNT(*) FROM cars WHERE detail_synced_at IS NOT NULL) AS with_detail,
  (SELECT COUNT(*) FROM price_history)              AS price_records,
  (SELECT COUNT(*) FROM sync_runs WHERE error IS NULL) AS successful_syncs;


-- ─── 1. 最便宜的 10 輛純電車（當前在售）──────────
SELECT id, brand, model, year, price_wan, mileage_km/10000.0 AS mileage_wan, location
FROM cars
WHERE is_active=1 AND fuel='純電'
ORDER BY price_wan ASC
LIMIT 10;


-- ─── 2. 價格 / 里程比（每萬公里多少萬元）──────────
-- 找「里程低 + 價格合理」的
SELECT
  id, brand, model, year, price_wan,
  mileage_km/10000.0 AS mileage_wan,
  ROUND(price_wan * 10000.0 / mileage_km, 2) AS wan_per_km
FROM cars
WHERE is_active=1 AND mileage_km > 0 AND price_wan IS NOT NULL
ORDER BY wan_per_km DESC
LIMIT 20;


-- ─── 3. 折舊率（相對新車價的折扣率）─────────────
SELECT
  id, brand, model, year, price_wan, msrp_wan,
  ROUND(100.0 * (msrp_wan - price_wan) / msrp_wan, 1) AS discount_pct
FROM cars
WHERE is_active=1 AND msrp_wan > 0 AND price_wan IS NOT NULL
ORDER BY discount_pct DESC
LIMIT 20;


-- ─── 4. 最近降價的車 ──────────────────────────
-- 抓每輛車的價格歷史，找出降幅最大的
WITH changes AS (
  SELECT
    car_id,
    MIN(price_wan) AS lowest,
    MAX(price_wan) AS highest,
    MAX(observed_at) AS last_observed
  FROM price_history
  GROUP BY car_id
  HAVING COUNT(*) > 1
)
SELECT
  c.id, c.title, c.price_wan AS current_price,
  ch.highest, ch.lowest,
  ROUND(ch.highest - ch.lowest, 1) AS wan_drop
FROM cars c
JOIN changes ch ON ch.car_id = c.id
WHERE c.is_active = 1
ORDER BY wan_drop DESC
LIMIT 20;


-- ─── 5. 熱門車（瀏覽數最高）─────────────────
SELECT id, title, price_wan, view_count, current_viewers, location
FROM cars
WHERE is_active=1
ORDER BY view_count DESC NULLS LAST
LIMIT 20;


-- ─── 6. 按品牌統計 ─────────────────────────
-- 用 brand_en（list 階段就有，無需 detail）
SELECT
  brand_en AS brand,
  COUNT(*) AS n,
  ROUND(AVG(price_wan), 1) AS avg_wan,
  MIN(price_wan) AS min_wan,
  MAX(price_wan) AS max_wan,
  ROUND(AVG(mileage_km)/10000.0, 2) AS avg_mileage_wan
FROM cars
WHERE is_active=1 AND brand_en IS NOT NULL
GROUP BY brand_en
ORDER BY n DESC;


-- ─── 7. Tesla 各年份分布 ──────────────────
SELECT
  year,
  COUNT(*) AS n,
  ROUND(AVG(price_wan), 1) AS avg_wan,
  MIN(price_wan) AS min_wan,
  MAX(price_wan) AS max_wan
FROM cars
WHERE is_active=1 AND brand LIKE '%Tesla%'
GROUP BY year
ORDER BY year DESC;


-- ─── 8. 各地區車量 ─────────────────────────
SELECT location, COUNT(*) AS n, ROUND(AVG(price_wan),1) AS avg_wan
FROM cars
WHERE is_active=1
GROUP BY location
ORDER BY n DESC;


-- ─── 9. 最近 7 天內新刊登 ──────────────────
-- 注意：updated_ago_text 是爬取時的相對描述，不能直接做日期比較
-- 用 first_seen_at（DB 第一次看到的時間）更可靠
SELECT id, title, price_wan, location, first_seen_at
FROM cars
WHERE is_active=1 AND julianday('now') - julianday(first_seen_at) <= 7
ORDER BY first_seen_at DESC;


-- ─── 10. 近期下架 ──────────────────────────
-- 看有哪些車變成 is_active=0（可能是被賣掉或賣家下架）
SELECT id, title, price_wan, last_seen_at, seller
FROM cars
WHERE is_active=0
ORDER BY last_seen_at DESC
LIMIT 20;


-- ─── 11. 每次 sync 的統計 ──────────────────
SELECT
  id, started_at, finished_at,
  list_count, new_count, updated_count, gone_count, detail_count,
  filter_args
FROM sync_runs
ORDER BY id DESC
LIMIT 10;


-- ─── 12. 找特定配備 ────────────────────────
-- 找有「環景影像系統」的車
SELECT id, title, price_wan, location
FROM cars
WHERE is_active=1
  AND highlights_json LIKE '%環景影像%'
ORDER BY price_wan ASC;


-- ─── 13a. 同一賣家的所有刊登（追車商）─────────
SELECT
  member_id,
  COUNT(*) AS n,
  GROUP_CONCAT(brand_en || ' ' || kind_en, ' | ') AS cars,
  ROUND(AVG(price_wan), 1) AS avg_wan
FROM cars
WHERE is_active=1 AND member_id IS NOT NULL
GROUP BY member_id
HAVING n >= 3
ORDER BY n DESC;


-- ─── 13b. 顏色 × 品牌 樞紐 ─────────────────
SELECT
  color,
  COUNT(*) AS total,
  SUM(CASE WHEN brand_en='Tesla' THEN 1 ELSE 0 END) AS tesla,
  SUM(CASE WHEN brand_en='Toyota' THEN 1 ELSE 0 END) AS toyota,
  SUM(CASE WHEN brand_en='Volkswagen' THEN 1 ELSE 0 END) AS vw
FROM cars
WHERE is_active=1 AND color IS NOT NULL
GROUP BY color
ORDER BY total DESC;


-- ─── 13c. 今日熱度 vs 累計（爆紅車）────────
-- day_views / view_count 比率高 = 今天突然受關注
SELECT
  brand_en, kind_en, year, price_wan,
  day_views, view_count,
  ROUND(100.0 * day_views / NULLIF(view_count, 0), 1) AS day_pct
FROM cars
WHERE is_active=1 AND day_views > 0 AND view_count > 0
ORDER BY day_pct DESC
LIMIT 20;


-- ─── 13d. 最近 N 天內精準刊登（用 item_post_date 而非 first_seen_at）─
SELECT id, brand_en, kind_en, year, price_wan, location,
       item_post_date
FROM cars
WHERE is_active=1
  AND julianday('now') - julianday(item_post_date) <= 7
ORDER BY item_post_date DESC;


-- ─── 13e. 同款車比價（同 kind_id 找對手）──────
-- 換成你想看的 kind_id（例：17967 = Tesla Model Y）
SELECT id, year, price_wan, mileage_km/10000.0 AS mw, color, location, day_views
FROM cars
WHERE is_active=1 AND kind_id = 17967
ORDER BY price_wan ASC;


-- ─── 14. 瀏覽數爆增的車（熱度）──────────────
-- 比對每輛車最近兩次 view_history 記錄
WITH latest AS (
  SELECT car_id, view_count, observed_at,
         ROW_NUMBER() OVER (PARTITION BY car_id ORDER BY observed_at DESC) AS rn
  FROM view_history
)
SELECT
  c.id, c.title, c.price_wan,
  l1.view_count AS now_views,
  l2.view_count AS prev_views,
  (l1.view_count - l2.view_count) AS growth
FROM cars c
JOIN latest l1 ON l1.car_id = c.id AND l1.rn = 1
JOIN latest l2 ON l2.car_id = c.id AND l2.rn = 2
WHERE c.is_active = 1
ORDER BY growth DESC
LIMIT 20;
