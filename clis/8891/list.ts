import { cli, Strategy } from '@jackwener/opencli/registry';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 8891 汽車 - 通用列表命令，支援常見篩選
//
// 已知參數：
//   /{brand}                廠牌 slug（URL 路徑）
//   /{brand}/{kind}          廠牌+車系 slug（URL 路徑）
//   power[]=N                燃料類型（4=純電車）
//   price=min_max            價格範圍，單位 TWD
//   y[]=YYYY_YYYY            年份範圍（含頭尾）
//   r[]=N                    地區代碼（可多個，1=台北市、8=台中市...）
//   personal=1               只看個人自售
//   exsits=1                 排除不在店
//   page=N                   頁碼，每頁 40 筆

// ─── 載入 brands.json（66 品牌 + 870 車系） ────────────────────
// 用 readFileSync + import.meta.url 而非 `import brands from`，因為 opencli 直接
// 載入 .ts 並透過 ts-node/jit 編譯，JSON import 不一定被支援。
const __dirname = dirname(fileURLToPath(import.meta.url));

interface Kind {
  id: number;
  name: string;
  slug: string;
  count: number;
}
interface Brand {
  id: number;
  en: string;
  zh: string;
  slug: string;
  kinds: Kind[];
}

const BRANDS: Brand[] = JSON.parse(
  readFileSync(join(__dirname, 'brands.json'), 'utf-8'),
);

// 5 種燃料類型：名稱 → 8891 power ID
// 驗證方法：側欄點擊每個選項觀察 URL 變化；對 selectData 確認 label 對應
const FUEL_LOOKUP: Record<string, number> = {
  // 汽油
  '汽油': 0, '汽油車': 0, 'gasoline': 0, 'petrol': 0, 'gas': 0,
  // 柴油
  '柴油': 1, '柴油車': 1, 'diesel': 1,
  // 油電複合（Hybrid / HEV / PHEV）
  '油電': 2, '油電複合': 2, '油電複合車': 2, '油電混合': 2,
  'hybrid': 2, 'hev': 2, 'phev': 2,
  // 瓦斯雙燃料（LPG / CNG dual fuel）
  '瓦斯': 3, '瓦斯雙燃料': 3, '雙燃料': 3,
  'lpg': 3, 'cng': 3,
  // 純電
  '純電': 4, '純電車': 4, '電動': 4, '電動車': 4,
  'electric': 4, 'ev': 4, 'bev': 4,
};

const FUEL_NAMES: Record<number, string> = {
  0: '汽油', 1: '柴油', 2: '油電複合', 3: '瓦斯雙燃料', 4: '純電',
};

// 廠牌查找前，讓 --power 接受名稱或數字 ID
// 輸入 "4" / "電動" / "electric" 都 → 4
function resolveFuel(input: string): number {
  const norm = input.toLowerCase().trim();
  // 直接是數字
  if (/^\d+$/.test(norm)) {
    const n = parseInt(norm, 10);
    if (n in FUEL_NAMES) return n;
    throw new Error(`Unknown fuel ID: ${n}. Valid IDs: 0-4`);
  }
  // 名稱查找（試英文 lowercase 和原始中文）
  if (norm in FUEL_LOOKUP) return FUEL_LOOKUP[norm];
  if (input in FUEL_LOOKUP) return FUEL_LOOKUP[input];
  throw new Error(
    `Unknown fuel: "${input}". Valid: 汽油/柴油/油電/瓦斯/純電 ` +
    `or electric/hybrid/diesel/gasoline/lpg or numeric 0-4`,
  );
}

// 22 個縣市：名稱 → 8891 地區 ID
const REGION_LOOKUP: Record<string, number> = {
  '台北市': 1, '台北': 1,
  '基隆市': 2, '基隆': 2,
  '新北市': 3, '新北': 3,
  '新竹市': 4,
  '新竹縣': 5, '新竹': 4, // 預設「新竹」指新竹市
  '桃園市': 6, '桃園': 6,
  '苗栗縣': 7, '苗栗': 7,
  '台中市': 8, '台中': 8,
  '彰化縣': 10, '彰化': 10,
  '南投縣': 11, '南投': 11,
  '嘉義市': 12,
  '嘉義縣': 13, '嘉義': 12, // 預設「嘉義」指嘉義市
  '雲林縣': 14, '雲林': 14,
  '台南市': 15, '台南': 15,
  '高雄市': 17, '高雄': 17,
  '屏東縣': 19, '屏東': 19,
  '宜蘭縣': 20, '宜蘭': 20,
  '台東縣': 21, '台東': 21,
  '花蓮縣': 22, '花蓮': 22,
  '澎湖縣': 23, '澎湖': 23,
  '金門縣': 24, '金門': 24,
  '連江縣': 25, '連江': 25,
};

// 廠牌查找：接受 slug / 英文名 / 中文名，回傳 Brand 物件
function resolveBrand(input: string): Brand {
  const norm = input.toLowerCase().trim();
  for (const b of BRANDS) {
    if (b.slug === norm) return b;
    if (b.en.toLowerCase() === norm) return b;
    if (b.zh && b.zh === input) return b;
  }
  // 提供友善錯誤
  const samples = BRANDS.slice(0, 5).map((b) => `${b.slug}(${b.zh || b.en})`).join(', ');
  throw new Error(
    `Unknown brand: "${input}". Try slug / English / 中文，例：${samples}... (66 brands total)`,
  );
}

// 車系查找：scoped to brand；接受 slug 或原始 name
function resolveKind(brand: Brand, input: string): Kind {
  const norm = input.toLowerCase().trim().replace(/\s+/g, '-');
  for (const k of brand.kinds) {
    if (k.slug === norm) return k;
    if (k.name.toLowerCase() === input.toLowerCase()) return k;
  }
  const samples = brand.kinds.slice(0, 5).map((k) => k.slug).join(', ');
  throw new Error(
    `Unknown kind "${input}" under brand ${brand.slug}. Try: ${samples}... (${brand.kinds.length} kinds)`,
  );
}

cli({
  site: '8891',
  name: 'list',
  description: '8891 汽車 - 通用列表（支援燃料/價格/是否在店篩選）',
  domain: 'auto.8891.com.tw',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '結果筆數（每頁 40 筆自動翻頁）' },
    { name: 'page', type: 'int', default: 1, help: '起始頁碼（從 1 開始）' },
    // 廠牌 / 車系（URL path）
    { name: 'brand', type: 'string', help: '廠牌：slug / 英文 / 中文，例：tesla / Tesla / 特斯拉' },
    { name: 'kind', type: 'string', help: '車系：slug 或 name，例：model-y / "Model Y"（需配合 --brand）' },
    // 年份範圍
    { name: 'year-from', type: 'int', help: '年份下限（例：2020，含）' },
    { name: 'year-to', type: 'int', help: '年份上限（例：2024，含）' },
    // 地區（中文縣市名，逗號分隔多選）
    { name: 'region', type: 'string', help: '地區：中文縣市名，逗號分隔多選，例：台北,台中,高雄' },
    // 個人自售
    { name: 'personal-only', type: 'bool', default: false, help: '只看個人自售（預設含車商）' },
    // 既有
    { name: 'power', type: 'string', help: '燃料：名稱或 ID，可多值逗號分隔。0=汽油 / 1=柴油 / 2=油電複合 / 3=瓦斯雙燃料 / 4=純電。例：--power 純電 / --power 2,4 / --power hybrid,ev' },
    { name: 'min-price', type: 'int', help: '最低價格（單位：萬）' },
    { name: 'max-price', type: 'int', help: '最高價格（單位：萬）' },
    { name: 'in-store-only', type: 'bool', default: false, help: '排除不在店車輛' },
  ],
  columns: ['rank', 'id', 'title', 'brand', 'model', 'color', 'price', 'year', 'mileage', 'location', 'view_count', 'day_views', 'thumbnail', 'url'],
  func: async (page, kwargs) => {
    const startPage = Number(kwargs.page) || 1;
    const limit = Number(kwargs.limit) || 20;
    const pagesNeeded = Math.ceil(limit / 40);

    // --- 構 URL path（廠牌 / 車系）---
    let basePath = '/';
    if (kwargs.brand) {
      const brand = resolveBrand(String(kwargs.brand));
      basePath = `/${brand.slug}`;
      if (kwargs.kind) {
        const kind = resolveKind(brand, String(kwargs.kind));
        basePath = `/${brand.slug}/${kind.slug}`;
      }
    } else if (kwargs.kind) {
      throw new Error('--kind 必須搭配 --brand 一起使用');
    }

    // --- 組 query string ---
    const params: string[] = [];

    if (kwargs.power) {
      const inputs = String(kwargs.power).split(',').map((s) => s.trim()).filter(Boolean);
      for (const input of inputs) {
        const id = resolveFuel(input);
        params.push(`power[]=${id}`);
      }
    }

    const minWan = kwargs['min-price'] != null ? Number(kwargs['min-price']) : null;
    const maxWan = kwargs['max-price'] != null ? Number(kwargs['max-price']) : null;
    if (minWan != null || maxWan != null) {
      const lo = minWan != null ? minWan * 10000 : 0;
      const hi = maxWan != null ? maxWan * 10000 : 99999999;
      params.push(`price=${lo}_${hi}`);
    }

    // 年份範圍
    const yFrom = kwargs['year-from'] != null ? Number(kwargs['year-from']) : null;
    const yTo = kwargs['year-to'] != null ? Number(kwargs['year-to']) : null;
    if (yFrom != null || yTo != null) {
      const lo = yFrom ?? 1990;
      const hi = yTo ?? new Date().getFullYear() + 1;
      if (lo > hi) throw new Error(`--year-from (${lo}) 必須 ≤ --year-to (${hi})`);
      params.push(`y[]=${lo}_${hi}`);
    }

    // 地區（逗號分隔中文名 → r[]=N 多個）
    if (kwargs.region) {
      const names = String(kwargs.region).split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const id = REGION_LOOKUP[name];
        if (id == null) {
          throw new Error(
            `Unknown region: "${name}". Valid: ${Object.keys(REGION_LOOKUP).filter((k) => !/^.{2}$/.test(k)).join(', ')}`,
          );
        }
        params.push(`r[]=${id}`);
      }
    }

    if (kwargs['personal-only']) params.push('personal=1');
    if (kwargs['in-store-only']) params.push('exsits=1');

    const baseQuery = params.join('&');
    const rows: any[] = [];

    for (let p = startPage; p < startPage + pagesNeeded; p++) {
      const url = `https://auto.8891.com.tw${basePath}?${baseQuery}${baseQuery ? '&' : ''}page=${p}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const pageRows = await page.evaluate(`(async () => {
        // === 從 Next.js __next_f flight data 抓取結構化資料（含圖片 URL）===
        // 列表卡片是 lazy-load，<img> 在滾動前不存在；但 flight data 已含完整資訊
        // Flight data 是 streaming 進來，可能 domcontentloaded 後還沒到，所以 polling 等
        const flightById = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const tryParse = () => {
          if (!window.__next_f) return false;
          const all = window.__next_f.map((p) => (p && p[1]) || '').join('');
          const ldIdx = all.indexOf('"listData":');
          if (ldIdx < 0) return false;
          const itemsKey = '"items":';
          const itemsIdx = all.indexOf(itemsKey, ldIdx);
          if (itemsIdx < 0) return false;
          try {
            let i = itemsIdx + itemsKey.length;
            while (i < all.length && all[i] !== '[') i++;
            const start = i;
            let depth = 0, inStr = false, esc = false;
            for (; i < all.length; i++) {
              const c = all[i];
              if (esc) { esc = false; continue; }
              if (c === '\\\\') { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === '[') depth++;
              else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
            }
            if (depth !== 0) return false; // 還沒收尾
            const arr = JSON.parse(all.slice(start, i));
            if (!Array.isArray(arr) || arr.length === 0) return false;
            for (const it of arr) {
              if (it && it.itemId) flightById[String(it.itemId)] = it;
            }
            return true;
          } catch (e) { return false; }
        };
        // Polling: 最多 6 秒等 flight data
        for (let attempt = 0; attempt < 30; attempt++) {
          if (tryParse()) break;
          await sleep(200);
        }

        const cards = document.querySelectorAll('a.row-item');
        const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
        return Array.from(cards).map((card) => {
          const titleEl = card.querySelector('[class*="ib-it-text"]');
          const priceEl = card.querySelector('[class*="ib-price"] b');
          const icons = card.querySelectorAll('[class*="ib-icon"]');
          const infoItems = card.querySelectorAll('[class*="ib-ii-item"]');
          const href = card.getAttribute('href') || '';
          const idMatch = href.match(/usedauto-infos-(\\d+)/);
          const absUrl = href.startsWith('http')
            ? href
            : 'https://auto.8891.com.tw' + href;
          let priceText = null;
          if (priceEl && priceEl.textContent) {
            const t = priceEl.textContent.trim();
            priceText = /^[\\d.]+$/.test(t) ? t + '萬' : t;
          }
          // view_count 藏在 .ii-item[2] 的 .Red 裡（如 "1912次瀏覽"）
          const viewEl = infoItems[2]?.querySelector('.Red');
          const viewCount = viewEl ? parseInt(text(viewEl) || '0', 10) : null;
          // current_viewers 從 "26人在看" / "99+人在看"
          const viewersEl = card.querySelector('[class*="set-super-top-label-desc"]');
          const currentViewers = text(viewersEl);
          // 賣點 / promo
          const promoEl = card.querySelector('[class*="promotion-tag"] p');
          // 從 flight data 拿縮圖、品牌/車型、賣家、色彩等結構化資料
          const carId = idMatch ? idMatch[1] : null;
          const flight = (carId ? flightById[carId] : null) || {};
          // 信任標章
          const trustBadgeEl = card.querySelector('[class*="set-super-top-label"] img');
          const auditLabelEl = card.querySelector('[class*="audit-label"] img');
          const badges = [];
          if (trustBadgeEl && trustBadgeEl.getAttribute('alt')) badges.push(trustBadgeEl.getAttribute('alt'));
          if (auditLabelEl && auditLabelEl.getAttribute('alt')) badges.push(auditLabelEl.getAttribute('alt'));
          return {
            id: idMatch ? idMatch[1] : null,
            title: text(titleEl),
            price: priceText,
            year: text(icons[0]),
            mileage: text(icons[1]),
            location: text(infoItems[0]),
            updated_ago: text(infoItems[1]),
            view_count: viewCount,
            current_viewers: currentViewers,
            tagline: text(card.querySelector('[class*="ib-info-oldtitle"]')),
            promo: text(promoEl),
            badges: badges.join(','),
            // 從 flight data 補的結構化欄位（比 DOM 抓更穩、無需進 detail）
            brand_id: flight.brandId ?? null,
            brand_en_name: flight.brandEnName || null,
            kind_id: flight.kindId ?? null,
            kind_en_name: flight.kindEnName || null,
            color: flight.color || null,
            gas: flight.gas || null,
            day_views: flight.dayViewNum ?? null,
            item_post_date: flight.itemPostDate || null,
            item_renew_date: flight.itemRenewDate || null,
            member_id: flight.memberId ?? null,
            thumbnail: flight.image || null,
            big_image: flight.bigImage || null,
            dashboard_image: flight.dashboardImage || null,
            url: absUrl.split('?')[0],
          };
        });
      })()`);

      const listRows = Array.isArray(pageRows) ? (pageRows as any[]) : [];
      rows.push(...listRows);
      if (listRows.length === 0) break;
      if (rows.length >= limit) break;
    }

    return rows.slice(0, limit).map((item, i) => ({
      rank: i + 1,
      id: item.id || '',
      title: item.title || '',
      // 來自 flight data 的結構化欄位
      brand: item.brand_en_name || '',
      brand_id: item.brand_id ?? '',
      model: item.kind_en_name || '',
      kind_id: item.kind_id ?? '',
      color: item.color || '',
      gas: item.gas || '',
      // 從 DOM 抓的（current_viewers / view_count / updated_ago 是 DOM 顯示文字）
      price: item.price || '',
      year: item.year || '',
      mileage: item.mileage || '',
      location: item.location || '',
      updated_ago: item.updated_ago || '',
      view_count: item.view_count ?? '',
      day_views: item.day_views ?? '',
      current_viewers: item.current_viewers || '',
      tagline: item.tagline || '',
      promo: item.promo || '',
      badges: item.badges || '',
      // flight data 的精準時間戳（vs updated_ago 模糊文字）
      item_post_date: item.item_post_date || '',
      item_renew_date: item.item_renew_date || '',
      member_id: item.member_id ?? '',
      // 圖片
      thumbnail: item.thumbnail || '',
      big_image: item.big_image || '',
      dashboard_image: item.dashboard_image || '',
      url: item.url || '',
    }));
  },
});
