# opencli-adapters

Personal [OpenCLI](https://github.com/jackwener/OpenCLI) adapters.

## Install

Clone into the local OpenCLI adapter directory:

```bash
git clone https://github.com/bareck/opencli-adapters.git ~/opencli-adapters
cp -r ~/opencli-adapters/clis/* ~/.opencli/clis/
opencli list | grep 8891
```

Or symlink per-site:

```bash
mkdir -p ~/.opencli/clis
ln -s ~/opencli-adapters/clis/8891 ~/.opencli/clis/8891
```

## Adapters

### `8891` — 8891 中古車

Source: https://auto.8891.com.tw/

| Command | Description |
|---------|-------------|
| `8891 electric` | Electric-car listings (fuel filter = 純電車) |
| `8891 list` | Generic listing with filters: `--power`, `--min-price`, `--max-price`, `--in-store-only` |
| `8891 detail` | Single car full info: spec, condition, highlights, photos, seller |

**Workflow: two-stage crawl**

Because each detail page is ~4 seconds, we use a two-stage approach:

1. Use `list` to get all matching car IDs (fast, ~30s for 245 cars).
2. Feed IDs into `detail` when you need full info (~4s per car).

```bash
# Stage 1 — crawl all matching cars to get IDs
opencli 8891 list --power 4 --max-price 150 --in-store-only --limit 1000

# Stage 2 — fetch full detail for specific cars
opencli 8891 detail --id 4600208
opencli 8891 detail --ids 4600208,4632355,4635078
```

**List examples**

```bash
# Electric cars under 150萬, in-store only
opencli 8891 list --power 4 --max-price 150 --in-store-only --limit 10

# 50~100萬 electric
opencli 8891 list --power 4 --min-price 50 --max-price 100

# Electric + hybrid combined
opencli 8891 list --power 4,3
```

**List output fields** (enhanced with time-series signals)

`rank, id, title, price, year, mileage, location, updated_ago, view_count, current_viewers, tagline, promo, badges, url`

- `view_count` — cumulative view count (integer)
- `current_viewers` — live concurrent viewers, e.g. `26人在看`
- `updated_ago` — relative timestamp, e.g. `7天前更新`
- `badges` — trust badges, e.g. `精選,真實車源`

These fields feed the time-series tables in `db/` (see below).

**Detail output fields**

`id`, `title`, `price`, `msrp`, `brand`, `model`, `year`, `license_date`, `mileage`, `fuel`, `ev_range`, `transmission`, `drivetrain`, `doors_seats`, `location`, `seller`, `seller_type` (車主自售/車商), `conditions`, `highlights`, `photo_count`, `photos`, `url`

> **Note:** The detail page only pre-loads 3~15 thumbnail photos; the full gallery lazy-loads when you click. First version captures what's visible.

**Known URL params** (discovered via browser exploration)

| Param | Format | Notes |
|-------|--------|-------|
| `power[]=N` | int | Fuel type; `4` = 純電車 |
| `price=min_max` | TWD | e.g. `0_1500000` = up to 150萬 |
| `exsits=1` | flag | Exclude not-in-store (note: official spelling is `exsits`, not `exists`) |
| `page=N` | int | 40 items per page |

**Detail page selectors** (stable substring matches on hashed CSS-module classes)

| Field | Selector | Notes |
|-------|----------|-------|
| title | `h1` | |
| price | `[class*="_price-text"]` + `[class*="_price-unit"]` | |
| msrp | `[class*="newcar-price"]` | Extract `X.X萬` |
| brand/model | `[class*="bread-crumbs"] a` | Last two car links |
| spec grid | `[class*="info-grid"] [class*="info-item"]` | label/value pairs |
| conditions | `[class*="vehicle-condition-item"] img[alt]` | |
| highlights | `[class*="newcar-equipment-item"] p` | |
| seller | `[class*="seller-intro"] h2 p` | |
| personal flag | `[class*="is-personal"]` | Dealer if missing |
| photos | `img[src*="/s{id}/"]` | Car-specific path only |

## Local database (optional)

See [`db/`](db/) for a Python script that syncs OpenCLI output into a local SQLite database with price history, view-count trends, and inventory tracking.

```bash
cd db
python sync.py --power 4 --max-price 150 --in-store-only
# → writes to ~/8891-db/cars.db
```

Captures time-series signals (price history, view-count growth, inventory changes).
Queries include: price drops over time, biggest MSRP discounts, view-count growth, best value cars.
See [`db/queries.sql`](db/queries.sql) for 13 ready-made query examples, and [`db/README.md`](db/README.md) for full docs.

