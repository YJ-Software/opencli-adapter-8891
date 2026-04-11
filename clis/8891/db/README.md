# 8891-db — Local SQLite database for 8891 cars

Companion database for the `8891` OpenCLI adapters. Syncs listing
snapshots into SQLite so you can run historical queries (price drops,
view-count trends, inventory changes).

**Cross-platform.** Tested on Windows. The Python script uses only stdlib
(`sqlite3`, `subprocess`, `pathlib`) and resolves the `opencli` executable
via `shutil.which`, so it runs on Linux and macOS without modification.
On Linux/macOS use `python3` instead of `python` if your distro doesn't
alias them.

## Prerequisites

- Python 3.9+ (no third-party packages — `sqlite3` is in stdlib)
- `opencli` installed and on PATH:
  ```bash
  npm install -g @jackwener/opencli
  opencli doctor   # verify daemon + Browser Bridge extension
  ```
- Chrome/Chromium with the OpenCLI Browser Bridge extension installed

## Quick start

```bash
# 1. The db/ folder lives alongside the .ts adapters under ~/.opencli/clis/8891/db/
#    If you cloned the repo, just symlink or copy the whole 8891 site into place:
mkdir -p ~/.opencli/clis
cp -r clis/8891 ~/.opencli/clis/      # one-time install (or use ln -s)
cd ~/.opencli/clis/8891/db

# 2. First sync — electric cars under 150萬, in-store only (list only, fast)
python sync.py --power 4 --max-price 150 --in-store-only --list-only
# Linux/macOS:
python3 sync.py --power 4 --max-price 150 --in-store-only --list-only

# 3. Full sync — same filter but also fetch per-car detail for new IDs
python sync.py --power 4 --max-price 150 --in-store-only

# 4. Subsequent syncs — only updates changed fields + fetches detail for new cars
python sync.py --power 4 --max-price 150 --in-store-only
```

## Safety: gone-protection

If `sync.py` runs and the list comes back with fewer than 50% of the
currently-active cars in your DB, it auto-refuses to mark anyone as
inactive (and prints a warning). This prevents disasters when:
- you accidentally run with `--limit 3` while testing
- the upstream site has a partial outage
- the filter args are wrong

To override (when you genuinely want a partial sync), pass `--no-mark-gone`.

## What gets stored

### `cars` table (one row per car, upserted)

From `8891 list` every sync:
`title, price_wan, year, mileage_km, location, updated_ago_text,
view_count, current_viewers, tagline, promo, badges, url`

From `8891 detail` (only fetched once per car, or refreshed with
`--detail-stale-days N`):
`msrp_wan, brand, model, license_date, fuel, ev_range_km,
transmission, drivetrain, doors_seats, seller, seller_type,
conditions_json, highlights_json, photos_json`

Metadata: `first_seen_at, last_seen_at, detail_synced_at, is_active`

### Time-series tables

- `price_history` — one row per price change (only appended when price differs)
- `view_history` — one row per sync (captures the full view-count curve)
- `sync_runs` — log of every sync invocation with counts

## How `is_active` works

After each sync, any car that was `is_active=1` but didn't appear in
the current list result gets flipped to `is_active=0`. That's how you
tell which cars have been sold or delisted — they stay in the DB
forever, just marked inactive.

## Detail refresh strategy

By default, `detail` is only fetched for cars where `detail_synced_at IS NULL`.
Pass `--detail-stale-days 30` to also refresh cars whose detail was
fetched more than 30 days ago (catches highlight/photo changes).

## Common queries

See `queries.sql` for 13 ready-made queries including:

- Cheapest / best value
- Biggest discount from MSRP
- Price drops over time
- View-count growth (which cars are suddenly popular)
- Per-brand / per-year statistics
- New listings in last 7 days
- Recently delisted cars

Run them with:

```bash
# On Windows without sqlite3 CLI, use Python:
python -c "import sqlite3; conn = sqlite3.connect('cars.db');
for r in conn.execute(''' SELECT title, price_wan, view_count FROM cars
WHERE is_active=1 ORDER BY view_count DESC LIMIT 10 '''): print(r)"
```

Or install a GUI like [DB Browser for SQLite](https://sqlitebrowser.org/)
and open `cars.db` directly.

## Full sync flags

| Flag | Purpose |
|------|---------|
| `--power N` | Fuel type (4 = 純電車) |
| `--min-price N` | Lowest price in 萬 |
| `--max-price N` | Highest price in 萬 |
| `--in-store-only` | Exclude cars not-in-store |
| `--limit N` | Max cars to fetch (default 1000) |
| `--list-only` | Skip detail stage entirely |
| `--detail-stale-days N` | Also refresh detail if older than N days |
| `--detail-batch N` | Detail batch size (default 50) |
| `--detail-delay-ms N` | Delay between detail requests (default 300) |
| `--dry-run` | Preview opencli output without touching DB |
