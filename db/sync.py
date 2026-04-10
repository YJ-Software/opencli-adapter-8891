#!/usr/bin/env python3
"""
8891 中古車資料庫同步腳本

用法：
    python sync.py --power 4 --max-price 150 --in-store-only
    python sync.py --power 4 --limit 1000           # 大批抓取
    python sync.py --list-only                      # 只跑 list 階段，跳過 detail
    python sync.py --detail-stale-days 30           # detail 過 30 天重抓

流程：
    1. 呼叫 `opencli 8891 list ...` 抓當前所有車
    2. 比對 DB：新增 / 更新（price, mileage, view_count...）/ 標記下架
    3. 對「沒有 detail」或「detail 過期」的 ID 呼叫 `opencli 8891 detail`
    4. 記錄 sync_runs + price_history + view_history
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_DIR = Path(__file__).resolve().parent
DB_PATH = DB_DIR / "cars.db"
SCHEMA_PATH = DB_DIR / "schema.sql"

# Windows: opencli 是 .cmd，subprocess 直接呼叫找不到，要指到具體路徑
OPENCLI_CMD = shutil.which("opencli") or shutil.which("opencli.cmd") or "opencli"


# ─────────────────────────────────────────────────────
# 欄位正規化
# ─────────────────────────────────────────────────────

def parse_price_wan(price_text: str | None) -> float | None:
    """135.0萬 → 135.0；電洽 → None"""
    if not price_text:
        return None
    m = re.match(r"^([\d.]+)\s*萬", price_text)
    return float(m.group(1)) if m else None


def parse_year(year_text: str | None) -> int | None:
    """2022年 → 2022"""
    if not year_text:
        return None
    m = re.match(r"(\d{4})", year_text)
    return int(m.group(1)) if m else None


def parse_mileage_km(mileage_text: str | None) -> float | None:
    """
    10.6萬公里 → 106000
    2700公里 → 2700
    1.73萬公里 → 17300
    """
    if not mileage_text:
        return None
    m = re.match(r"([\d.]+)\s*萬\s*公里", mileage_text)
    if m:
        return float(m.group(1)) * 10000
    m = re.match(r"([\d,]+)\s*公里", mileage_text)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


def parse_ev_range_km(range_text: str | None) -> int | None:
    """480公里 → 480"""
    if not range_text or range_text == "-":
        return None
    m = re.match(r"(\d+)", range_text)
    return int(m.group(1)) if m else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ─────────────────────────────────────────────────────
# opencli 呼叫
# ─────────────────────────────────────────────────────

def run_opencli_json(args: list[str]) -> list[dict[str, Any]]:
    """執行 opencli 並解析 JSON 輸出。"""
    cmd = [OPENCLI_CMD, *args, "--format", "json"]
    print(f"  ▶ opencli {' '.join(args)} --format json", flush=True)
    # Windows: .cmd 需要 shell=True 或直接指向 .cmd 檔
    use_shell = sys.platform == "win32" and not OPENCLI_CMD.lower().endswith(".cmd")
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=use_shell,
    )
    if result.returncode != 0:
        print(f"  ✗ opencli failed (exit {result.returncode})", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"opencli exited {result.returncode}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"  ✗ JSON decode failed: {e}", file=sys.stderr)
        print(result.stdout[:500], file=sys.stderr)
        raise
    return data if isinstance(data, list) else []


def opencli_list(filter_args: list[str], limit: int) -> list[dict[str, Any]]:
    return run_opencli_json(["8891", "list", "--limit", str(limit), *filter_args])


def opencli_detail(ids: list[str], delay_ms: int = 300) -> list[dict[str, Any]]:
    if not ids:
        return []
    return run_opencli_json([
        "8891", "detail",
        "--ids", ",".join(ids),
        "--delay-ms", str(delay_ms),
    ])


# ─────────────────────────────────────────────────────
# DB 初始化
# ─────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    return conn


# ─────────────────────────────────────────────────────
# Upsert 邏輯
# ─────────────────────────────────────────────────────

LIST_MUTABLE_FIELDS = (
    "title", "price_wan", "year", "mileage_km", "location",
    "updated_ago_text", "view_count", "current_viewers",
    "tagline", "promo", "badges", "url",
)


def upsert_from_list(
    conn: sqlite3.Connection,
    items: list[dict[str, Any]],
    observed_at: str,
) -> dict[str, int]:
    """把 list 結果寫入 DB。回傳 {new, updated, gone, price_changes}"""
    stats = {"new": 0, "updated": 0, "gone": 0, "price_changes": 0}

    existing = {
        row["id"]: row
        for row in conn.execute("SELECT id, price_wan, view_count, is_active FROM cars")
    }

    seen_ids: set[str] = set()

    for item in items:
        car_id = item.get("id")
        if not car_id:
            continue
        seen_ids.add(car_id)

        row = {
            "id": car_id,
            "title": item.get("title") or None,
            "price_wan": parse_price_wan(item.get("price")),
            "year": parse_year(item.get("year")),
            "mileage_km": parse_mileage_km(item.get("mileage")),
            "location": item.get("location") or None,
            "updated_ago_text": item.get("updated_ago") or None,
            "view_count": item.get("view_count") if isinstance(item.get("view_count"), int) else None,
            "current_viewers": item.get("current_viewers") or None,
            "tagline": item.get("tagline") or None,
            "promo": item.get("promo") or None,
            "badges": item.get("badges") or None,
            "url": item.get("url") or None,
        }

        prev = existing.get(car_id)
        if prev is None:
            # INSERT
            fields = [*LIST_MUTABLE_FIELDS, "id", "first_seen_at", "last_seen_at", "is_active"]
            values = [row[f] for f in LIST_MUTABLE_FIELDS] + [car_id, observed_at, observed_at, 1]
            placeholders = ",".join("?" * len(fields))
            conn.execute(
                f"INSERT INTO cars ({','.join(fields)}) VALUES ({placeholders})",
                values,
            )
            stats["new"] += 1
        else:
            # UPDATE 可變欄位
            set_clause = ", ".join(f"{f}=?" for f in LIST_MUTABLE_FIELDS)
            values = [row[f] for f in LIST_MUTABLE_FIELDS]
            conn.execute(
                f"UPDATE cars SET {set_clause}, last_seen_at=?, is_active=1 WHERE id=?",
                [*values, observed_at, car_id],
            )
            stats["updated"] += 1

        # price_history：新車或價格變動時寫入
        new_price = row["price_wan"]
        old_price = prev["price_wan"] if prev else None
        if new_price is not None and old_price != new_price:
            conn.execute(
                "INSERT INTO price_history (car_id, price_wan, observed_at) VALUES (?,?,?)",
                (car_id, new_price, observed_at),
            )
            if prev is not None:
                stats["price_changes"] += 1

        # view_history：每次 sync 都記錄一次（看熱度趨勢）
        if row["view_count"] is not None:
            conn.execute(
                "INSERT INTO view_history (car_id, view_count, observed_at) VALUES (?,?,?)",
                (car_id, row["view_count"], observed_at),
            )

    # 標記下架（is_active=1 但這次沒看到）
    if seen_ids:
        placeholders = ",".join("?" * len(seen_ids))
        gone = conn.execute(
            f"UPDATE cars SET is_active=0 WHERE is_active=1 AND id NOT IN ({placeholders})",
            list(seen_ids),
        )
        stats["gone"] = gone.rowcount or 0

    conn.commit()
    return stats


# ─────────────────────────────────────────────────────
# Detail 同步
# ─────────────────────────────────────────────────────

DETAIL_FIELDS = (
    "msrp_wan", "brand", "model", "license_date", "fuel", "ev_range_km",
    "transmission", "drivetrain", "doors_seats", "seller", "seller_type",
    "conditions_json", "highlights_json", "photos_json",
)


def find_detail_targets(
    conn: sqlite3.Connection,
    stale_days: int | None,
) -> list[str]:
    """找出需要抓 detail 的 ID：
       - is_active=1
       - AND (detail_synced_at IS NULL  OR  過期 stale_days 天)
    """
    if stale_days is None:
        # 只抓從未抓過的
        rows = conn.execute(
            "SELECT id FROM cars WHERE is_active=1 AND detail_synced_at IS NULL"
        )
    else:
        rows = conn.execute(
            """
            SELECT id FROM cars
            WHERE is_active=1
              AND (detail_synced_at IS NULL
                   OR julianday('now') - julianday(detail_synced_at) >= ?)
            """,
            (stale_days,),
        )
    return [r["id"] for r in rows]


def apply_detail(conn: sqlite3.Connection, items: list[dict[str, Any]], observed_at: str) -> int:
    """把 detail 結果寫回 cars 表。回傳更新筆數。"""
    count = 0
    for item in items:
        car_id = item.get("id")
        if not car_id:
            continue

        # 把 detail 的原始字串欄位轉成 DB 欄位
        row = {
            "msrp_wan": parse_price_wan(item.get("msrp")),
            "brand": item.get("brand") or None,
            "model": item.get("model") or None,
            "license_date": item.get("license_date") or None,
            "fuel": item.get("fuel") or None,
            "ev_range_km": parse_ev_range_km(item.get("ev_range")),
            "transmission": item.get("transmission") or None,
            "drivetrain": item.get("drivetrain") or None,
            "doors_seats": item.get("doors_seats") or None,
            "seller": item.get("seller") or None,
            "seller_type": item.get("seller_type") or None,
            # detail 欄位裡 conditions/highlights/photos 是用 " | " 或空白分隔的字串
            "conditions_json": json.dumps(
                [s.strip() for s in (item.get("conditions") or "").split("|") if s.strip()],
                ensure_ascii=False,
            ),
            "highlights_json": json.dumps(
                [s.strip() for s in (item.get("highlights") or "").split("|") if s.strip()],
                ensure_ascii=False,
            ),
            "photos_json": json.dumps(
                [s for s in (item.get("photos") or "").split() if s],
                ensure_ascii=False,
            ),
        }

        set_clause = ", ".join(f"{f}=?" for f in DETAIL_FIELDS)
        values = [row[f] for f in DETAIL_FIELDS]
        conn.execute(
            f"UPDATE cars SET {set_clause}, detail_synced_at=? WHERE id=?",
            [*values, observed_at, car_id],
        )
        count += 1

    conn.commit()
    return count


# ─────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="8891 sync")
    # list filter 參數直接 pass through 給 opencli
    parser.add_argument("--power", help="燃料代碼，例：4")
    parser.add_argument("--min-price", type=int)
    parser.add_argument("--max-price", type=int)
    parser.add_argument("--in-store-only", action="store_true")
    parser.add_argument("--limit", type=int, default=1000, help="list 抓幾筆（預設 1000 大於單次結果）")
    # sync 控制
    parser.add_argument("--list-only", action="store_true", help="只跑 list 階段")
    parser.add_argument("--detail-stale-days", type=int, default=None,
                        help="detail 過 N 天重抓（預設只抓 detail_synced_at IS NULL 的）")
    parser.add_argument("--detail-batch", type=int, default=50, help="每批 detail 幾筆")
    parser.add_argument("--detail-delay-ms", type=int, default=300, help="detail 之間延遲")
    parser.add_argument("--dry-run", action="store_true", help="不寫入 DB")
    args = parser.parse_args()

    # 組 opencli list filter 參數
    list_filter: list[str] = []
    if args.power:
        list_filter += ["--power", args.power]
    if args.min_price is not None:
        list_filter += ["--min-price", str(args.min_price)]
    if args.max_price is not None:
        list_filter += ["--max-price", str(args.max_price)]
    if args.in_store_only:
        list_filter += ["--in-store-only"]

    print(f"[8891-sync] DB: {DB_PATH}")
    print(f"[8891-sync] filter: {' '.join(list_filter) or '(none)'}")
    print(f"[8891-sync] dry-run: {args.dry_run}")
    print()

    conn = init_db()

    # ─── sync_runs 開頭 ───
    started_at = now_iso()
    filter_args_str = " ".join(list_filter)
    run_id = None
    if not args.dry_run:
        cur = conn.execute(
            "INSERT INTO sync_runs (started_at, filter_args) VALUES (?,?)",
            (started_at, filter_args_str),
        )
        run_id = cur.lastrowid
        conn.commit()

    try:
        # ─── Stage 1: list ───
        print("[1/2] Fetching list...")
        list_items = opencli_list(list_filter, args.limit)
        print(f"  ✓ got {len(list_items)} items")

        if args.dry_run:
            print("  (dry-run, skipping DB writes)")
            print("\nSample item:")
            if list_items:
                print(json.dumps(list_items[0], ensure_ascii=False, indent=2))
            return 0

        print("[1/2] Upserting list data...")
        list_stats = upsert_from_list(conn, list_items, started_at)
        print(
            f"  ✓ new={list_stats['new']} "
            f"updated={list_stats['updated']} "
            f"gone={list_stats['gone']} "
            f"price_changes={list_stats['price_changes']}"
        )

        # ─── Stage 2: detail ───
        detail_count = 0
        if args.list_only:
            print("\n[2/2] Skipping detail (--list-only)")
        else:
            print("\n[2/2] Finding detail targets...")
            targets = find_detail_targets(conn, args.detail_stale_days)
            print(f"  ✓ {len(targets)} cars need detail")

            if targets:
                for batch_start in range(0, len(targets), args.detail_batch):
                    batch = targets[batch_start:batch_start + args.detail_batch]
                    print(
                        f"  ▶ batch {batch_start // args.detail_batch + 1} "
                        f"({len(batch)} cars)..."
                    )
                    details = opencli_detail(batch, args.detail_delay_ms)
                    n = apply_detail(conn, details, now_iso())
                    detail_count += n
                    print(f"    ✓ wrote {n}")

        # ─── sync_runs 結束 ───
        conn.execute(
            """
            UPDATE sync_runs
               SET finished_at=?, list_count=?, new_count=?,
                   updated_count=?, gone_count=?, detail_count=?
             WHERE id=?
            """,
            (
                now_iso(),
                len(list_items),
                list_stats["new"],
                list_stats["updated"],
                list_stats["gone"],
                detail_count,
                run_id,
            ),
        )
        conn.commit()

        print("\n[done] Sync complete")
        print(f"  list={len(list_items)}  new={list_stats['new']}  updated={list_stats['updated']}  "
              f"gone={list_stats['gone']}  detail={detail_count}")
        return 0

    except Exception as e:
        print(f"\n[error] {e}", file=sys.stderr)
        if run_id is not None:
            conn.execute(
                "UPDATE sync_runs SET finished_at=?, error=? WHERE id=?",
                (now_iso(), str(e), run_id),
            )
            conn.commit()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
