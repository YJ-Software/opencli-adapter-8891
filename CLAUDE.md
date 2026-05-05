# CLAUDE.md — Technical reference for future sessions

> Purpose: everything a future Claude session needs to extend or maintain the
> `8891` adapter suite without re-discovering it from scratch. User-facing
> docs live in `README.md`; this file is the developer cheat sheet.

---

## Architecture

```
(repo root = ~/.opencli/clis/8891/ after git clone)
├── list.ts / list.js      28 filter flags, source + compiled
├── detail.ts / detail.js  /usedauto-infos-{id}.html, DOM extraction
├── brands.json            66 brands x 870 kinds lookup (generated, 110 KB)
├── package.json           npm scripts: build / clean
├── tsconfig.build.json    tsc config
├── README.md / CLAUDE.md  Docs (ignored by opencli scanner)
├── .gitignore
└── db/
    ├── sync.py            Python 3.9+ stdlib, calls opencli subprocess, writes SQLite
    ├── schema.sql         cars (44 cols) + price_history + view_history + sync_runs
    ├── queries.sql        13 example SQL queries
    ├── extract-brands.py  One-time rebuild for brands.json (curl + regex)
    ├── README.md          User-facing sync docs
    └── .gitignore         *.db *.db-wal *.db-shm (DB files stay local)
```

**Install**: `git clone https://github.com/bareck/opencli-adapter-8891.git ~/.opencli/clis/8891`
**Update**: `cd ~/.opencli/clis/8891 && git pull`
**Rebuild after edit**: `npm install && npm run build`

**The site**: Next.js App Router with streaming RSC flight data in `window.__next_f`.
No API auth required for listing/detail pages (Tier 1 public per OpenCLI taxonomy)
but we use `Strategy.COOKIE` + `browser: true` anyway — it's more reliable than
naked HTTP for anti-bot edge cases, and the `page.goto` + `page.evaluate` flow is
what opencli expects.

---

## URL parameter cheat sheet

Every sidebar filter, verified via browser click + flight-data inspection.

### Path-based

| Filter | URL pattern | Notes |
|--------|-------------|-------|
| Brand | `/{brand-slug}` | e.g. `/tesla`, `/mercedes-benz` |
| Kind | `/{brand-slug}/{kind-slug}` | e.g. `/tesla/model-y`, `/toyota/corolla-altis` |

**Slug rule**: `name.toLowerCase().replace(/\s+/g, '-')`. Verified for all edge cases:
`Mercedes-Benz` → `mercedes-benz`, `Corolla Altis` → `corolla-altis`, `bZ4X` → `bz4x`,
`Prius α` → `prius-α` (Unicode passthrough, URL-encoded on HTTP).

### Query string

| Param | Type | Values | 8891 label |
|-------|------|--------|------------|
| `power[]=N` | int array | 0=汽油 1=柴油 2=油電複合 3=瓦斯雙燃料 4=純電 | 燃料 |
| `price=lo_hi` | range (TWD) | e.g. `0_1500000` = up to 150 萬 | 價格 |
| `y[]=YYYY_YYYY` | range | e.g. `2023_2025` (inclusive) | 年份/車齡 |
| `r[]=N` | int array | 1-25 (22 used, 9/16/18 reserved) | 地區 |
| `t[]=N` | int array | 1=轎車/跑車 2=休旅 3=貨車 5=其他 6=吉普 | 車種 |
| `g=lo_hi` | range (cc) | e.g. `1600_2000`; 排氣量; **single range, not array** | 排氣量 |
| `tab[]=N` | int array | 0=手排 1=自排 2=自手排 3=手自排 | 變速系統 |
| `drive[]=N` | int array | 2=2WD 4=4WD | 驅動方式 |
| `door[]=N` | int array | N = door_count − 2 (so 5門=3, 2門=0) | 車門數 |
| `chair[]=N` | int array | 2-10, 12 directly; 13 = 12座以上 | 乘客數 |
| `color[]=N` | int array | 0=白 1=紅 2=銀 3=灰 4=黑 5=黃 8=橙 9=綠 10=藍 11=紫 12=其他 13=棕 15=粉 | 車色 (IDs 6/7/14 missing!) |
| `page=N` | int | 40 items per page | 分頁 |
| `key=TEXT` | string (URL-encoded) | Free-text search; echoed in `selectData.keyword`; supports Chinese | 關鍵字搜尋 |
| `sort=FIELD-DIR` | string | 4 fields × 2 dirs = 8: `price-asc`, `price-desc`, `year-asc`, `year-desc`, `mile-asc`, `mile-desc`, `gas-asc`, `gas-desc`. Echoed in Next.js `urlParts`, not `selectData.sort` | 排序 |
| `exsits=1` | bool | **typo in source** — `exsits` not `exists` | 排除不在店 |
| `personal=1` | bool | | 個人自售 |
| `yx=1` | bool | | 8891 嚴選 |
| `report=1` | bool | | 認證車 |
| `inweek=1` | bool | ~7 days window | 最新刊登 |
| `video=1` | bool | | 影片看車 |

### Region ID → city map (hardcoded in `list.ts`)

```
 1=台北市    2=基隆市    3=新北市    4=新竹市    5=新竹縣
 6=桃園市    7=苗栗縣    8=台中市   10=彰化縣   11=南投縣
12=嘉義市   13=嘉義縣   14=雲林縣   15=台南市   17=高雄市
19=屏東縣   20=宜蘭縣   21=台東縣   22=花蓮縣   23=澎湖縣
24=金門縣   25=連江縣
```
IDs 9, 16, 18 are reserved / unused by 8891.

### Region groups (multi-city shortcuts)

| Group | City IDs | Cities |
|-------|----------|--------|
| 北部 | 1, 2, 3, 4, 5, 6, 20 | 台北 基隆 新北 新竹市 新竹縣 桃園 宜蘭 |
| 中部 | 7, 8, 10, 11, 14 | 苗栗 台中 彰化 南投 雲林 |
| 南部 | 12, 13, 15, 17, 19 | 嘉義市 嘉義縣 台南 高雄 屏東 |
| 東部 | 21, 22, 23, 24, 25 | 台東 花蓮 澎湖 金門 連江 |
| 離島 | 23, 24, 25 | 澎湖 金門 連江 |

Implemented as `r[]` expansion in `resolveRegion()` — user types `--region 北部`,
adapter emits 7 separate `r[]=N` params.

---

## opencli version requirement (CRITICAL)

**opencli >= v1.7.2 only loads `.js` adapters.** It explicitly rejects `.ts` files:

```
Ignoring TypeScript adapter C:\...\list.ts - .ts adapters are no longer loaded.
Rename to .js or convert to JavaScript.
```

This broke our adapter pack once when opencli auto-upgraded from v1.7.0 (which still loaded .ts via tsx) to v1.7.2. Fix: compile `.ts` to `.js` via tsc and install the `.js` files into `~/.opencli/clis/8891/`.

### Build pipeline (in the repo root)

| File | Purpose |
|------|---------|
| `package.json` | npm scripts: `build`, `install-local`, `clean` |
| `tsconfig.build.json` | tsc config — ESM / es2022 / resolveJsonModule / skipLibCheck |
| `_dist/` | Build intermediate (gitignored) |
| `list.js` / `detail.js` | Build outputs, **committed** so consumers don't need tsc |

**Build:** `npm install && npm run build`
- tsc compiles .ts -> `_dist/*.js`
- Script copies `_dist/*.js` alongside source
- Cleans `_dist/`

**Install to local runtime:** `npm run install-local`
- `cp list.js detail.js brands.json ~/.opencli/clis/8891/`
- `cp -r db/. ~/.opencli/db/`

**tsc emits type warnings** about `@jackwener/opencli/registry` and `node:fs` being "not found" — these are cosmetic (module resolution paths aren't configured for these). The `.js` output is correct and runs fine. Build script uses `;` (not `&&`) so non-zero tsc exit code doesn't break the copy step.

### Why we commit both .ts and .js

- **`.ts` = source of truth.** Edit it, then run `npm run build`.
- **`.js` = what opencli actually loads.** Committed so `git clone + cp` works without requiring Node/tsc at install time.
- `_dist/` and `node_modules/` are gitignored.

### Required `access` field (opencli runtime check)

Every `cli({...})` declaration must include `access: 'read' | 'write'`. Loading fails otherwise:

```
Failed to load module .../detail.js: Command 8891/detail must declare access: 'read' | 'write'
```

Both 8891 adapters (`list`, `detail`) are `access: 'read'` — they only read public listing/detail pages. Use `'write'` only for adapters that mutate remote state (post, edit, delete). Place the field right after `domain:` for consistency.

### Discovery path reference

Opencli's adapter scan (`node_modules/@jackwener/opencli/dist/src/discovery.js`):
1. **Fast path**: `cli-manifest.json` in package dir (built-in adapters only, 544 entries, 85 sites).
2. **Fallback**: `~/.opencli/clis/*/` filesystem scan. Only loads `.js`, explicitly warns + skips `.ts` (line ~175).
3. **Plugins**: `~/.opencli/plugins/*/` (flat scan, same .js-only rule, line ~229).

---

## Client-side filters (no server-side support)

Some things users ask for aren't exposed as URL filters. `list.ts` implements them client-side:

### Mileage range (`--min-mileage` / `--max-mileage`)

- 8891 has NO server-side mileage filter (only a sort option).
- Filter is applied in the pagination loop AFTER parsing each page.
- When `--max-mileage` is set and `--sort` is not, list.ts auto-injects `sort=mile-asc` so the pagination loop can early-exit when it hits a car whose km exceeds the cap.
- `MAX_PAGES_SAFETY = 15` (~45s at 3s/page goto) to stay under opencli's 60s command timeout. Going higher risks TIMEOUT exit code 75.
- `--min-mileage` alone does NOT auto-sort. With large inventory this can hit the page cap before finding matches. **Recommendation**: combine with `--brand` / `--year-from` / `--body` first to narrow the scan.
- Helper `parseMileageKm()` mirrors `sync.py`'s `parse_mileage_km` — handles `"10.6萬公里"`, `"2700公里"`, `"1.73萬公里"` forms. Cars with price=電洽 typically have `mileage_km == null`; they're excluded when `--max-mileage` is set.

---

## Site quirks (gotchas)

1. **`exsits` typo** — the 排除不在店 param is `exsits=1`, not `exists=1`. 8891's
   official spelling. Easy to "fix" by mistake.

2. **Lazy-loaded images** — the list page uses `react-lazyload`. Before the user
   scrolls, card `<img>` tags **do not exist in the DOM** — there's just a
   `<div class="lazyload-placeholder">`. Direct DOM querying for card thumbnails
   returned 0% coverage in early attempts.

   **Fix**: parse `window.__next_f` (Next.js RSC flight data) for the full listing
   items array — it contains `image` (300×225), `bigImage` (600×450),
   `dashboardImage` (odometer photo) URLs pre-resolved. No lazy-load issue.

3. **Flight data streaming race** — `__next_f` is added to by multiple
   `self.__next_f.push(...)` script tags that fire **after** `domcontentloaded`.
   `list.ts` evaluates too early on ~20% of page loads. Fix: poll for up to 6s
   waiting for `"listData":...,"items":[...]` to appear in the serialized flight
   data before parsing.

4. **Door ID offset** — `door[]=N` where `N = door_count - 2`. User input 5 (door
   count) maps to URL `door[]=3`. Always use `DOOR_INPUT_MAP` in `list.ts`.

5. **Color ID gaps** — 8891 skips color IDs 6, 7, 14. Maintaining a full sequential
   range will break.

6. **`g=` is single-range, not array** — every other range filter uses `foo[]=lo_hi`
   but 排氣量 uses bare `g=lo_hi`. Don't accidentally write `g[]=`.

7. **Hybrid ≠ 3** — power=3 is LPG (瓦斯雙燃料), not hybrid. Hybrid is power=2.
   Early commits had the wrong value in help text.

8. **Price `電洽`** — when a seller lists price as "電洽" (call for price), the
   `<b>` element contains literal `電洽` text. `list.ts` tests `/^[\d.]+$/` before
   appending `萬`. `sync.py` normalizes to `price_wan = NULL` in DB.

9. **`kind_id` may be 0** — for older/rare models, flight data has `id: 0` in
   `kindsList`. The slug still works for URL nav (`/mercedes-benz/190e`) but don't
   rely on kind ID for DB joins when it's 0.

10. **opencli update notice pollutes stdout** — `--format json` output may have a
    trailing `Update available: v1.7.0 → v1.7.2` notice after the JSON. Parsers
    must slice up to the last `]` before calling `json.loads()`. Seen in
    `sync.py` and all test snippets.

---

## Flight data parsing (the key technique)

`window.__next_f` is an array of `[tier: number, payload: string]` tuples added
by streaming SSR. To get structured data:

```js
const all = window.__next_f.map(p => (p && p[1]) || '').join('');
// Then find the section you want, e.g. for listing items:
const idx = all.indexOf('"listData":');
const itemsKey = '"items":';
const itemsIdx = all.indexOf(itemsKey, idx);
// Brace counter to find matching ']':
let j = itemsIdx + itemsKey.length;
while (j < all.length && all[j] !== '[') j++;
const start = j;
let depth = 0, inStr = false, esc = false;
for (; j < all.length; j++) {
  const c = all[j];
  if (esc) { esc = false; continue; }
  if (c === '\\') { esc = true; continue; }
  if (c === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) { j++; break; } }
}
const items = JSON.parse(all.slice(start, j));
```

**Why brace counter instead of regex**: the items JSON contains nested arrays
(`saleCodes: []`, `actives: []`) so a naive `[^\]]*` regex fails on most items.

**Per-item fields available**: `itemId, title, price, year/makeYear, mileage,
region, color, gas, brandEnName, brandId, kindEnName, kindId, memberId,
dayViewNum, totalViewNum, itemPostDate, itemRenewDate, image, bigImage,
dashboardImage, isSuperTop, isAudit, subTitle, standardPromotion`.

Flight data also contains `hotBrandData` (20-ish brands) and the A-Z brand
groups — `extract-brands.py` parses the full 66-brand list from one homepage fetch.

---

## CSS module selector patterns

8891 uses CSS Modules with hashed class names (`listItem_row-item__kj_nW`). Class
hashes change on rebuild, so always use substring match:

```ts
document.querySelector('[class*="row-item"]')    // ✓ stable
document.querySelector('.listItem_row-item__kj_nW')  // ✗ breaks on rebuild
```

### Useful stable selectors (list page)

| Element | Selector |
|---------|----------|
| Card root | `a.row-item` (already has unhashed class — rare) |
| Card title | `[class*="ib-it-text"]` |
| Price | `[class*="ib-price"] b` |
| Year / mileage | `[class*="ib-icon"]` (first two) |
| Location / updated / views | `[class*="ib-ii-item"]` (first three) |
| View count | `[class*="ib-ii-item"] .Red` (third item) |
| Viewers badge | `[class*="set-super-top-label-desc"]` |
| Trust badge image | `[class*="set-super-top-label"] img[alt]` |
| Tagline | `[class*="ib-info-oldtitle"]` |
| Promo | `[class*="promotion-tag"] p` |

### Detail page selectors (`detail.ts`)

| Field | Selector |
|-------|----------|
| Title | `h1` |
| Price text / unit | `[class*="_price-text"]` / `[class*="_price-unit"]` |
| MSRP | `[class*="newcar-price"]` (extract `X.X萬`) |
| Breadcrumb brand/model | `[class*="bread-crumbs"] a[href*="auto.8891.com.tw/"]` (last two) |
| Spec grid | `[class*="info-grid"] [class*="info-item"]` (label/value) |
| Conditions | `[class*="vehicle-condition-item"] img[alt]` |
| Highlights | `[class*="newcar-equipment-item"] p` |
| Seller name | `[class*="seller-intro"] h2 p` |
| Personal flag | `[class*="is-personal"]` (present = 車主自售) |
| Car photos only | `img[src]` where `src` matches `/\/s{id}\//` (car-album path) |

---

## `list.ts` lookup table summary

All lookups are module-level `const` maps at the top of `list.ts`, above the
`cli({...})` call:

| Constant | Purpose |
|----------|---------|
| `BRANDS` | Loaded from `brands.json` via `readFileSync + import.meta.url` |
| `REGION_LOOKUP` | 縣市 name → r[] ID (supports both `台北市` and `台北`) |
| `REGION_GROUPS` | `北部`/`中部`/... → array of r[] IDs |
| `FUEL_LOOKUP` / `FUEL_NAMES` | Chinese/English/ID → power value |
| `BODY_LOOKUP` / `BODY_NAMES` | Chinese/English/ID → t[] value |
| `COLOR_LOOKUP` | Chinese/English → color[] ID |
| `TRANSMISSION_LOOKUP` / `TRANSMISSION_NAMES` | → tab[] value |
| `DRIVETRAIN_LOOKUP` / `DRIVETRAIN_NAMES` | → drive[] value |
| `DOOR_INPUT_MAP` | `{ 2:0, 3:1, 4:2, 5:3, 6:4 }` (handles the -2 offset) |
| `SEAT_INPUT_VALUES` + `SEAT_12PLUS` | Set of valid seat counts + the "12+" special |

Each has a matching `resolveXxx(input)` function that accepts Chinese / English /
numeric ID and throws a helpful error (listing valid values) on unknown input.

---

## How to add a new filter

1. **Discover the URL param**:
   ```bash
   opencli browser open 'https://auto.8891.com.tw/'
   opencli browser state 2>&1 | grep -n '<TARGET_LABEL>'
   opencli browser click <ref>    # repeat, record URL change each time
   ```

2. **Verify via direct fetch** (avoids click-state drift):
   ```bash
   opencli browser eval '(async()=>{
     const r = await fetch("/?yourparam=value");
     const t = await r.text();
     const idx = t.indexOf("listSubTab");   // or selectData.<filterkey>
     return t.slice(idx, idx+200);
   })()'
   ```
   Flight data's `selectData` / `listSubTab` echoes back whatever filter was
   applied — the canonical confirmation that a param is accepted.

3. **Add to `list.ts`**:
   - If the filter has named options, add a lookup table + `resolveXxx()`
     function near the existing lookups.
   - Add the flag to the `args:` array.
   - Add URL construction in the `func: async (page, kwargs) =>` block
     (search for `// 車種 t[]=N` as a typical spot).
   - Update the `columns:` array only if the filter adds **new output fields**,
     not just input.

4. **Test** with a positive case, mutual-exclusion error path, and unknown-value
   error path. Use `--format json` + a Python one-liner to assert output:
   ```bash
   opencli 8891 list --new-flag X --limit 3 --format json > "$TEMP/t.json" 2>/dev/null
   python -c "import json, os, tempfile; ..."
   ```

5. **Pass through in `sync.py`**: add matching `parser.add_argument(...)` and
   append to `list_filter` in the right section.

6. **Commit with a short summary of the URL param, the verification, and one
   working example**. Past commits follow this format.

---

## How to regenerate `brands.json`

`brands.json` is generated, 110 KB. Run:

```bash
cd ~/.opencli/clis/8891/db
python extract-brands.py --verbose        # ~30 seconds, fetches via curl
```

Output goes to `../brands.json`. The script:
1. Fetches homepage via `curl` subprocess (avoids Windows Python SSL cert issue).
2. Parses `__next_f` payload (reverses JS string escapes before JSON regex).
3. Extracts 66 unique brands from the A-Z + hot-brand sections.
4. For each brand, fetches `/{brand-slug}` and parses `kindsList` (brace counter).
5. Writes aggregated `brands.json` with `{id, en, zh, slug, kinds: [{id, name, slug, count}]}`.

Rerun any time 8891 adds new brands/models. `list.ts` loads at module init via
`readFileSync(join(__dirname, 'brands.json'))`.

---

## Testing workflow (what actually works)

- **`opencli list`** to confirm all 3 commands are registered (reloads on file change, no build step).
- **Per-filter smoke test**: `--format json` + parse via Python one-liner + strip
  trailing update notice via `content[:content.rfind(']')+1]`.
- **Error path tests**: each `resolveXxx()` error message lists valid values, so
  `opencli 8891 list --brand fooBrand 2>&1 | tail -3` should show the first few
  brand examples.
- **Combined filter tests**: the "mega combo" with ≥10 filters simultaneously
  is the best integration test — any URL construction bug surfaces immediately.
- **Before claiming a feature works**: verify at least one real car came back with
  the expected attribute (e.g. `--color 紅` → at least one result with
  `color: 紅色` in output).
- **`sync.py` flag passthrough**: always test end-to-end with at least one sync
  that uses the new flag + `--list-only --no-mark-gone --limit 3`. The
  `--no-mark-gone` is mandatory when testing because gone-protection auto-kicks
  in below 50% of active count.

---

## Environment quirks

- **Windows `opencli` is a `.cmd`** — Python `subprocess.run([name])` fails on
  bare `"opencli"` because CreateProcess can't resolve the bash shim. `sync.py`
  uses `_find_opencli()` which prefers `opencli.cmd` on Windows, `opencli` on
  Linux/macOS, always returning an absolute path so `shell=False` works.

- **Windows Python SSL cert issue** — `urllib.request` fails with
  "Missing Subject Key Identifier" on 8891's cert. `extract-brands.py` shells
  out to `curl` instead (which is bundled with modern Windows and git-bash).

- **CRLF line-ending warnings on commit** — harmless on Windows if
  `core.autocrlf=true` (default). Git stores LF, working copy has CRLF. The
  `.gitattributes` could be added but hasn't been needed.

- **`~/.opencli/clis/{site}/` scanner** — opencli ignores non-`.ts` files, so
  the `db/` subdirectory (with Python, SQL, SQLite files) sits cleanly next to
  the `.ts` adapters without interfering with adapter discovery.

---

## Commit history highlights (for context archaeology)

| Commit | What it added |
|--------|---------------|
| `fb2a668` | Initial `electric.ts` + `list.ts` (4 filters) |
| `4392c6a` | `detail.ts` with 23 fields + two-stage workflow pattern |
| `707769c` | Time-series fields on list (view_count, updated_ago) + SQLite sync stack |
| `a056580` | Thumbnail extraction via `__next_f` flight data (solved lazy-load) |
| `1c2255e` | 12 more flight-data fields (brand_id, kind_id, day_views, member_id, ...) |
| `07b365e` | Cross-platform sync.py + gone-protection safety |
| `d144feb` | Refactor: co-locate `db/` under `db/` |
| `935684a` | First 5 new filters (brand/kind/year/region/personal) + Chinese lookup |
| `aeaabb4` | Power value enumeration (fixed hybrid vs LPG mix-up) |
| `d97f285` | 8 more filters (body/transmission/drivetrain/doors/seats/age/displacement) |
| `afbe6dd` | Final 6 filters (color + region groups + 4 toggles) → **100% sidebar coverage** |
| `f36e222` | docs: README rewrite + CLAUDE.md technical reference |
| `d43c74b` | `--search` free-text keyword filter (key= URL param) |
| `8b91817` | Build pipeline (tsc .ts to .js) + commit .js artifacts (opencli v1.7.2 compat) |
| TBD | Client-side mileage filter + server-side sort (5 new flags; 28 total) |

---

## Things *not* supported (known, deliberate)

- **Full photo gallery** — only 3-15 pre-loaded thumbnails captured from detail
  pages. Opening the gallery modal would require `browser click` interaction.
- **Dealer-only filter** — 8891 doesn't expose a `dealer=1` URL param, only
  `personal=1`. Workaround: filter post-hoc on `seller_type` field.
- **Sub-trim levels** — `kindsList` items have an empty `items: []` sub-array
  on most models. Per-trim filtering isn't available via URL.
- **Cross-site tracking** — same car listed under multiple 8891 category URLs
  has the same `itemId`, so `cars` table dedup is fine, but no explicit check.
- **Auto-refresh `brands.json` on sync** — currently manual. `sync.py
  --refresh-brands` could be added as a convenience.
