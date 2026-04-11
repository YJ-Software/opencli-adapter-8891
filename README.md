# opencli-adapters

Personal [OpenCLI](https://github.com/jackwener/OpenCLI) adapters. Currently ships a complete adapter suite for **[8891 中古車](https://auto.8891.com.tw/)** (Taiwan's largest used-car marketplace) with full sidebar filter coverage and an optional local SQLite sync.

## Install

> **Important:** opencli >= v1.7.2 only loads `.js` adapters (the `.ts` source files are ignored with a warning). This repo ships **both**: `.ts` as source and pre-built `.js` alongside, so a fresh clone works without a build step.

```bash
# 1. Prerequisites
npm install -g @jackwener/opencli
opencli doctor    # verify daemon + Browser Bridge extension are connected

# 2. Clone + install this adapter pack (pre-built .js files are in the repo)
git clone https://github.com/bareck/opencli-adapters.git ~/opencli-adapters
mkdir -p ~/.opencli/clis
cp -r ~/opencli-adapters/clis/* ~/.opencli/clis/

# 3. Verify - should see 3 commands with no "Ignoring TypeScript adapter" warnings
opencli list | grep 8891
#   8891
#     detail [cookie] - ...
#     electric [cookie] - ...
#     list [cookie] - ...
```

### Rebuild after editing .ts source

If you edit `clis/8891/list.ts` / `detail.ts` / `electric.ts`, rebuild and reinstall:

```bash
cd ~/opencli-adapters/clis/8891
npm install           # first time only, fetches typescript + @types/node
npm run build         # tsc .ts -> .js alongside the source
npm run install-local # copies .js + brands.json + db/ to ~/.opencli/clis/8891/
```

tsc will emit type warnings about unresolved `@jackwener/opencli/registry` and `node:fs` imports - these are cosmetic (the global opencli package and Node stdlib aren't in the build's module resolution). The emitted `.js` files are correct and run fine.

Alternatively, if you only want to run (not edit), symlink instead of copy:
```bash
ln -s ~/opencli-adapters/clis/8891 ~/.opencli/clis/8891
```

---

## Adapters

| Command | Description |
|---------|-------------|
| `opencli 8891 list` | Generic listing with **28 filters** — every sidebar option plus free-text search, mileage range, and sort |
| `opencli 8891 detail` | Full per-car info — spec, condition, highlights, photos, seller |
| `opencli 8891 electric` | Shortcut for 純電車 listings (kept for backward compat) |

### Output format

All commands default to YAML table output. Add `--format json` for scripting:

```bash
opencli 8891 list --power 純電 --limit 3 --format json
```

---

## `8891 list` — full filter reference

All 28 flags are combinable. Names accept Chinese / English / slugs.

### Free-text search

| Flag | Notes |
|------|-------|
| `--search` | Free-text keyword search. Composes with every other filter. Supports English and Chinese. Example: `--search "Model Y Long Range"` or `--search 勞斯萊斯` |

### Categorical filters

| Flag | Values | Notes |
|------|--------|-------|
| `--brand` | slug / 英文 / 中文 | `tesla` / `Tesla` / `特斯拉` — 66 brands |
| `--kind` | slug / name | `model-y` / `"Model Y"` — must be used with `--brand` |
| `--power` | fuel name or 0-4 | `純電` / `electric` / `4`; multi: `2,4` or `hybrid,ev` |
| `--body` | body style | `轎車`/`休旅車`/`貨車`/`吉普車`/`其他` or `sedan`/`suv`/`truck`/`jeep`/`other` |
| `--color` | color name | `白`/`紅`/`銀`/`灰`/`黑`/`黃`/`橙`/`綠`/`藍`/`紫`/`棕`/`粉` + English names |
| `--transmission` | gearbox | `手排`/`自排`/`自手排`/`手自排` or `manual`/`automatic`/`amt`/`tiptronic` |
| `--drivetrain` | AWD/2WD | `2WD`/`4WD`/`AWD`/`FWD`/`RWD`/`前驅`/`後驅`/`四驅` |
| `--doors` | 2-6 | Door count, multi-select: `--doors 4,5` |
| `--seats` | 2-10 / 12 / 12+ | Passenger count; `12+` means 12 座以上 |
| `--region` | city or group | Individual 縣市 name (`台北`/`台中`/...) OR region group (`北部`/`中部`/`南部`/`東部`/`離島`) |

### Range filters

| Flag | Unit | Example |
|------|------|---------|
| `--min-price` / `--max-price` | 萬 (TWD × 10,000) | `--max-price 150` |
| `--year-from` / `--year-to` | absolute year | `--year-from 2020 --year-to 2024` |
| `--max-age` / `--min-age` | years relative to now | `--max-age 3` (3 年以內) |
| `--min-cc` / `--max-cc` | cc | `--min-cc 1600 --max-cc 2000` |
| `--min-liter` / `--max-liter` | L | `--min-liter 1.6 --max-liter 2.0` |
| `--min-mileage` / `--max-mileage` | km | `--max-mileage 50000` (client-side) |
| `--min-mileage-wan` / `--max-mileage-wan` | 萬 km | `--max-mileage-wan 5` = 50000 km |

> **Mileage filter note:** 8891 has no server-side mileage filter (only a sort option). `--max-mileage` is applied **client-side** after fetching — it auto-enables `sort=mile-asc` so pages can exit early when mileage exceeds the cap. `--min-mileage` alone has no auto-sort; narrow with `--brand` / `--year-from` / etc. first to keep scanning cheap. Page scan is capped at **15 pages** (~600 cars) to stay within opencli's 60s command timeout.

### Sort

| Flag | Values | Notes |
|------|--------|-------|
| `--sort` | `price` / `year` / `mile` / `gas`, optional `-asc`/`-desc` suffix | Default direction is `-asc`. Full list: `price-asc`, `price-desc`, `year-asc`, `year-desc`, `mile-asc`, `mile-desc`, `gas-asc`, `gas-desc` |

**Mutual exclusions** (will throw with a clear error):
- `--year-from/--year-to` vs `--max-age/--min-age` (both manipulate year range)
- `--min-cc/--max-cc` vs `--min-liter/--max-liter` (both set displacement)

### Boolean toggles

| Flag | 8891 equivalent |
|------|-----------------|
| `--in-store-only` | 排除不在店 |
| `--personal-only` | 個人自售 |
| `--audit-only` | 8891 認證車 |
| `--premium-only` | 8891 嚴選 |
| `--recent-only` | 最新刊登 (past ~7 days) |
| `--has-video` | 影片看車 (only listings with video) |

### Pagination

| Flag | Default | Notes |
|------|---------|-------|
| `--limit` | 20 | Auto-paginates; 40 rows per 8891 page |
| `--page` | 1 | Starting page; combined with `--limit` lets you skip |

### List output fields

```
rank, id, title, brand, brand_id, model, kind_id, color, gas,
price, year, mileage, location,
updated_ago, view_count, day_views, current_viewers,
tagline, promo, badges,
item_post_date, item_renew_date, member_id,
thumbnail, big_image, dashboard_image, url
```

Highlights:
- `view_count` / `day_views` — cumulative + today's views; great for trend tracking
- `current_viewers` — live concurrent viewers (`26人在看`)
- `item_post_date` / `item_renew_date` — precise timestamps (vs the fuzzy `updated_ago`)
- `member_id` — seller ID (track all listings by the same dealer)
- `thumbnail` / `big_image` / `dashboard_image` — 300×225 / 600×450 / odometer photo
- `brand_id` / `kind_id` — stable 8891 integer IDs for joins

---

## `8891 list` — usage examples

### By scenario

**Electric car shopping** — under 150 萬, in-store, 3 years or newer:
```bash
opencli 8891 list --power 純電 --max-price 150 --max-age 3 --in-store-only
```

**Family SUV** — 7-seater, 4WD, 2.0-3.0L, mid/south of Taiwan, 3 years or newer:
```bash
opencli 8891 list --body 休旅車 --seats 7 --drivetrain 4wd \
  --min-liter 2.0 --max-liter 3.0 --region 中部,南部 --max-age 3
```

**Manual sports car** — 2-door, manual gearbox, 200-400 萬, 2020+:
```bash
opencli 8891 list --body 跑車 --transmission 手排 --doors 2 \
  --min-price 200 --max-price 400 --year-from 2020
```

**Track a specific model** — all Tesla Model Y in Northern Taiwan, audited:
```bash
opencli 8891 list --brand tesla --kind model-y --region 北部 \
  --audit-only --limit 100
```

**Bargain hunt** — high-mileage old cars under 30 萬, only newly listed:
```bash
opencli 8891 list --max-price 30 --min-age 10 --recent-only
```

**Track daily listings** — new 2025 cars posted today in 北部:
```bash
opencli 8891 list --region 北部 --year-from 2025 --recent-only --has-video
```

**Free-text search** — any listing whose title mentions "Long Range" Performance, under 150萬:
```bash
opencli 8891 list --search "Long Range" --max-price 150
```

**Chinese keyword** — all Rolls-Royce listings (by Chinese brand name):
```bash
opencli 8891 list --search 勞斯萊斯
```

**Low-mileage cars** — within 5萬 km:
```bash
opencli 8891 list --max-mileage-wan 5 --limit 20
```

**Tesla with 3-8萬 km** — narrow inventory first so client-side filter stays fast:
```bash
opencli 8891 list --brand tesla --power 純電   --min-mileage-wan 3 --max-mileage-wan 8
```

**Sort by price ascending** — cheapest cars first:
```bash
opencli 8891 list --sort price-asc --limit 20
```

**Newest Teslas** — sort by year descending:
```bash
opencli 8891 list --brand tesla --sort year-desc --limit 10
```

### The "mega combo" — 10 active filters at once

```bash
opencli 8891 list \
  --region 北部 --power 純電 --color 白,銀 --max-age 3 \
  --max-price 200 --seats 5 --audit-only --has-video --in-store-only \
  --limit 5
```

Returns (as of 2026-04): 2 white Ford Mustang Mach-E listings in 新北市, 2023 年款, ~143 萬.

---

## `8891 detail` — per-car deep dive

```bash
# Single car
opencli 8891 detail --id 4600208

# Batch (comma-separated)
opencli 8891 detail --ids 4600208,4632355,4635078 --delay-ms 500
```

| Flag | Default | Notes |
|------|---------|-------|
| `--id` | — | Single car ID |
| `--ids` | — | Comma-separated IDs for batch |
| `--delay-ms` | 300 | Delay between batch requests |

### Detail output fields

```
id, title, price, msrp, brand, model, year, license_date,
mileage, fuel, ev_range, transmission, drivetrain, doors_seats,
location, seller, seller_type (車主自售 / 車商),
conditions, highlights, photo_count, photos, url
```

> **Note:** The detail page only pre-loads 3~15 thumbnail photos; the full gallery lazy-loads when you click into it. First-stage capture grabs what's immediately in the DOM.

### Two-stage workflow

Each detail fetch takes ~4 seconds; a 245-car list takes 16+ minutes if you pull detail for every car. Use `list` first to get IDs, then `detail` only on the ones you care about:

```bash
# Stage 1 — ~30s for a typical filter result
opencli 8891 list --brand tesla --power 純電 --region 北部 \
  --format json --limit 1000 > candidates.json

# Stage 2 — pipe IDs into detail only for the top 10
python -c "import json;print(','.join(x['id'] for x in json.load(open('candidates.json'))[:10]))" \
  | xargs -I{} opencli 8891 detail --ids {}
```

---

## Local SQLite database (optional)

See [`clis/8891/db/`](clis/8891/db/) — a Python sync script that persists OpenCLI output into SQLite so you can run historical queries. **Cross-platform**: pure Python stdlib, tested on Windows, runs on Linux/macOS unchanged.

Quick start:
```bash
cd ~/.opencli/clis/8891/db
python sync.py --brand tesla --power 純電 --max-price 200 --in-store-only
```

The sync script accepts **all `list` filters** as pass-through flags, so any query you run with `opencli 8891 list` can be converted to a persistent sync by prefixing with `python sync.py`.

What it captures:
- `cars` — current state (upserted), 44 columns
- `price_history` — every price change over time
- `view_history` — view-count snapshots per sync (trend tracking)
- `sync_runs` — log of every sync invocation

Built-in safety: auto-refuses to mark cars `is_active=0` if the list returns fewer than 50% of the current active count (prevents disasters when running with `--limit 3` to test).

See [`clis/8891/db/README.md`](clis/8891/db/README.md) for full docs and [`clis/8891/db/queries.sql`](clis/8891/db/queries.sql) for 13 ready-made query examples (biggest discount, price drops, view-count growth, per-brand stats, etc.).

---

## For contributors / future Claude sessions

See [`CLAUDE.md`](CLAUDE.md) for the technical reference: URL parameter cheat sheet, site quirks, how to add a new filter, how to regenerate `brands.json`, and the flight-data parsing technique that lets `list.ts` pull rich metadata without lazy-load problems.
