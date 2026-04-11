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

// ─── 車色 → color[]=N，可多選（ID 不連續，有些數字是 8891 內部保留）───
const COLOR_LOOKUP: Record<string, number> = {
  '白': 0, '白色': 0, 'white': 0,
  '紅': 1, '紅色': 1, 'red': 1,
  '銀': 2, '銀色': 2, 'silver': 2,
  '灰': 3, '灰色': 3, 'gray': 3, 'grey': 3,
  '黑': 4, '黑色': 4, 'black': 4,
  '黃': 5, '黃色': 5, 'yellow': 5,
  '橙': 8, '橙色': 8, '橘': 8, '橘色': 8, 'orange': 8,
  '綠': 9, '綠色': 9, 'green': 9,
  '藍': 10, '藍色': 10, 'blue': 10,
  '紫': 11, '紫色': 11, 'purple': 11, 'violet': 11,
  '棕': 13, '棕色': 13, '咖啡': 13, '咖啡色': 13, 'brown': 13,
  '粉': 15, '粉色': 15, 'pink': 15,
  '其他': 12, '其他顏色': 12, 'other': 12,
};

function resolveColor(input: string): number {
  const norm = input.toLowerCase().trim();
  if (/^\d+$/.test(norm)) {
    const n = parseInt(norm, 10);
    return n; // 直接用數字 ID
  }
  if (norm in COLOR_LOOKUP) return COLOR_LOOKUP[norm];
  if (input in COLOR_LOOKUP) return COLOR_LOOKUP[input];
  throw new Error(
    `Unknown color: "${input}". Valid: 白/紅/銀/灰/黑/黃/橙/綠/藍/紫/棕/粉/其他 ` +
    `or white/red/silver/gray/black/yellow/orange/green/blue/purple/brown/pink`,
  );
}

// ─── 車種 (body style) → t[]=N，可多選 ─────────
const BODY_LOOKUP: Record<string, number> = {
  // 轎車/跑車 = 1
  '轎車': 1, '跑車': 1, '轎車/跑車': 1, '轎跑': 1,
  'sedan': 1, 'coupe': 1, 'sports': 1, 'sport': 1,
  // 休旅車 = 2
  '休旅': 2, '休旅車': 2, 'suv': 2, 'crossover': 2,
  // 貨車 = 3
  '貨車': 3, 'truck': 3, 'van': 3,
  // 其他車型 = 5
  '其他': 5, '其他車型': 5, 'other': 5, 'misc': 5,
  // 吉普車 = 6
  '吉普': 6, '吉普車': 6, 'jeep': 6,
};
const BODY_NAMES: Record<number, string> = {
  1: '轎車/跑車', 2: '休旅車', 3: '貨車', 5: '其他車型', 6: '吉普車',
};

// ─── 變速系統 → tab[]=N，可多選（注意 URL key 是 tab，不是 transmission）─
const TRANSMISSION_LOOKUP: Record<string, number> = {
  '手排': 0, 'manual': 0, 'mt': 0,
  '自排': 1, 'automatic': 1, 'at': 1, 'auto': 1,
  '自手排': 2, 'amt': 2, 'dct': 2, 'dsg': 2, 'pdk': 2,
  '手自排': 3, 'tiptronic': 3,
};
const TRANSMISSION_NAMES: Record<number, string> = {
  0: '手排', 1: '自排', 2: '自手排', 3: '手自排',
};

// ─── 驅動方式 → drive[]=N，可多選（2=二驅、4=四驅）───
const DRIVETRAIN_LOOKUP: Record<string, number> = {
  '2wd': 2, '2驅': 2, '二驅': 2, '兩驅': 2, '前驅': 2, '後驅': 2,
  'fwd': 2, 'rwd': 2, 'front-wheel': 2, 'rear-wheel': 2, '兩輪驅動': 2,
  '4wd': 4, '4驅': 4, '四驅': 4, 'awd': 4, '全輪': 4, '全輪驅動': 4, '四輪驅動': 4,
};
const DRIVETRAIN_NAMES: Record<number, string> = { 2: '2WD', 4: '4WD' };

// ─── 車門數 → door[]=N，N = 門數 - 2（2 門=0, 6 門=4）───
const DOOR_INPUT_MAP: Record<number, number> = {
  2: 0, 3: 1, 4: 2, 5: 3, 6: 4,
};

// ─── 乘客數 → chair[]=N（2-10 / 12 直通，"12+" → 13）───
const SEAT_INPUT_VALUES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
const SEAT_12PLUS = 13;

function resolveBody(input: string): number {
  const norm = input.toLowerCase().trim();
  if (/^\d+$/.test(norm)) {
    const n = parseInt(norm, 10);
    if (n in BODY_NAMES) return n;
    throw new Error(`Unknown body ID: ${n}. Valid: 1,2,3,5,6`);
  }
  if (norm in BODY_LOOKUP) return BODY_LOOKUP[norm];
  if (input in BODY_LOOKUP) return BODY_LOOKUP[input];
  throw new Error(
    `Unknown body: "${input}". Valid: ${Object.values(BODY_NAMES).join(' / ')} ` +
    `(or sedan/suv/truck/jeep/other)`,
  );
}

function resolveTransmission(input: string): number {
  const norm = input.toLowerCase().trim();
  if (/^\d+$/.test(norm)) {
    const n = parseInt(norm, 10);
    if (n in TRANSMISSION_NAMES) return n;
    throw new Error(`Unknown transmission ID: ${n}. Valid: 0-3`);
  }
  if (norm in TRANSMISSION_LOOKUP) return TRANSMISSION_LOOKUP[norm];
  if (input in TRANSMISSION_LOOKUP) return TRANSMISSION_LOOKUP[input];
  throw new Error(
    `Unknown transmission: "${input}". Valid: 手排/自排/自手排/手自排 or manual/automatic/amt/tiptronic`,
  );
}

function resolveDrivetrain(input: string): number {
  const norm = input.toLowerCase().trim();
  if (/^\d+$/.test(norm)) {
    const n = parseInt(norm, 10);
    if (n === 2 || n === 4) return n;
    throw new Error(`Unknown drivetrain: ${n}. Valid: 2 (2WD) / 4 (4WD)`);
  }
  if (norm in DRIVETRAIN_LOOKUP) return DRIVETRAIN_LOOKUP[norm];
  if (input in DRIVETRAIN_LOOKUP) return DRIVETRAIN_LOOKUP[input];
  throw new Error(
    `Unknown drivetrain: "${input}". Valid: 2WD / 4WD / AWD / FWD / RWD / 前驅 / 後驅 / 四驅`,
  );
}

function resolveDoors(input: string): number {
  const n = parseInt(input.trim(), 10);
  if (!Number.isFinite(n) || !(n in DOOR_INPUT_MAP)) {
    throw new Error(`Unknown door count: "${input}". Valid: 2, 3, 4, 5, 6`);
  }
  return DOOR_INPUT_MAP[n];
}

function resolveSeats(input: string): number {
  const s = input.trim();
  if (s === '12+' || s === '>12' || s === '12以上') return SEAT_12PLUS;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || !SEAT_INPUT_VALUES.has(n)) {
    throw new Error(
      `Unknown seat count: "${input}". Valid: 2-10, 12, or 12+ (for 12 座以上)`,
    );
  }
  return n;
}

// ─── 排序 → sort=FIELD-DIRECTION ───
// 8891 接受 4 field × 2 direction = 8 值
const SORT_FIELDS = new Set(['price', 'year', 'mile', 'gas']);
const SORT_DIRECTIONS = new Set(['asc', 'desc']);
function resolveSort(input: string): string {
  const norm = input.toLowerCase().trim();
  // Shorthand: "mile" → "mile-asc"
  if (SORT_FIELDS.has(norm)) return norm + '-asc';
  // Full form: "mile-asc"
  const m = norm.match(/^([a-z]+)-(asc|desc)$/);
  if (m && SORT_FIELDS.has(m[1]) && SORT_DIRECTIONS.has(m[2])) return norm;
  throw new Error(
    `Unknown --sort "${input}". Valid: price / year / mile / gas, ` +
    `with optional -asc/-desc suffix. E.g. "mile-asc" / "price-desc" / "year" (→ year-asc)`,
  );
}

// 把 "10.6萬公里" / "2700公里" 正規化成整數 km（跟 sync.py 的 parse_mileage_km 同步）
function parseMileageKm(text: string | null): number | null {
  if (!text) return null;
  const w = text.match(/([\d.]+)\s*萬\s*公里/);
  if (w) return Math.round(parseFloat(w[1]) * 10000);
  const k = text.match(/([\d,]+)\s*公里/);
  if (k) return parseInt(k[1].replace(/,/g, ''), 10);
  return null;
}

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

// 地區分組：使用者輸入 "北部" → 展開成多個縣市 ID
const REGION_GROUPS: Record<string, number[]> = {
  '北部': [1, 2, 3, 4, 5, 6, 20],     // 台北, 基隆, 新北, 新竹市, 新竹縣, 桃園, 宜蘭
  '中部': [7, 8, 10, 11, 14],         // 苗栗, 台中, 彰化, 南投, 雲林
  '南部': [12, 13, 15, 17, 19],       // 嘉義市, 嘉義縣, 台南, 高雄, 屏東
  '東部': [21, 22, 23, 24, 25],       // 台東, 花蓮, 澎湖, 金門, 連江（含離島）
  '離島': [23, 24, 25],               // 澎湖, 金門, 連江（單獨取離島三縣）
};

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
    // 關鍵字搜尋（free text — 對應 8891 URL 參數 key=）
    { name: 'search', type: 'string', help: '關鍵字搜尋：free text，對應 8891 key= URL 參數。可與其他 filter 疊加，例：--search "Model Y Long Range"' },
    // 廠牌 / 車系（URL path）
    { name: 'brand', type: 'string', help: '廠牌：slug / 英文 / 中文，例：tesla / Tesla / 特斯拉' },
    { name: 'kind', type: 'string', help: '車系：slug 或 name，例：model-y / "Model Y"（需配合 --brand）' },
    // 年份範圍（絕對年份，與 --max-age/--min-age 互斥）
    { name: 'year-from', type: 'int', help: '年份下限（例：2020，含）' },
    { name: 'year-to', type: 'int', help: '年份上限（例：2024，含）' },
    // 車齡（相對於當年）— 更口語的年份輸入
    { name: 'max-age', type: 'int', help: '車齡上限（年）。例：--max-age 3 = 3 年以內。與 --year-from/to 互斥' },
    { name: 'min-age', type: 'int', help: '車齡下限（年）。例：--min-age 1 --max-age 3 = 1~3 年' },
    // 地區（中文縣市名或分組名，逗號分隔多選）
    { name: 'region', type: 'string', help: '地區：中文縣市名或分組（北部/中部/南部/東部/離島），逗號多選，例：北部,台南' },
    // 車色
    { name: 'color', type: 'string', help: '車色：白/紅/銀/灰/黑/黃/橙/綠/藍/紫/棕/粉 或英文，逗號多選' },
    // Toggle flags
    { name: 'personal-only', type: 'bool', default: false, help: '只看個人自售（預設含車商）' },
    { name: 'audit-only', type: 'bool', default: false, help: '只看 8891 認證車 (report=1)' },
    { name: 'premium-only', type: 'bool', default: false, help: '只看 8891 嚴選 (yx=1)' },
    { name: 'recent-only', type: 'bool', default: false, help: '只看最新刊登 (inweek=1，約 7 天內)' },
    { name: 'has-video', type: 'bool', default: false, help: '只看有影片看車的車輛' },
    // 車種 / 變速 / 驅動 / 車門 / 座位
    { name: 'body', type: 'string', help: '車種：轎車/休旅車/貨車/吉普車/其他，或 sedan/suv/truck/jeep，逗號多選' },
    { name: 'transmission', type: 'string', help: '變速：手排/自排/自手排/手自排，或 manual/automatic/amt/tiptronic，逗號多選' },
    { name: 'drivetrain', type: 'string', help: '驅動：2WD / 4WD / AWD / FWD / RWD / 前驅 / 後驅 / 四驅，逗號多選' },
    { name: 'doors', type: 'string', help: '車門數：2-6，逗號多選。例：--doors 4,5' },
    { name: 'seats', type: 'string', help: '乘客數：2-10 / 12 / 12+，逗號多選。例：--seats 5,7' },
    // 排氣量（cc 優先，若都沒給可用 liter）
    { name: 'min-cc', type: 'int', help: '排氣量下限（cc）' },
    { name: 'max-cc', type: 'int', help: '排氣量上限（cc）' },
    { name: 'min-liter', type: 'float', help: '排氣量下限（L），自動 × 1000 轉 cc' },
    { name: 'max-liter', type: 'float', help: '排氣量上限（L），自動 × 1000 轉 cc' },
    // 里程範圍（客戶端 filter — 8891 沒有伺服器端 filter；用 km 或 萬km）
    // 搭配 --sort mile-asc（或用 --max-mileage 自動觸發）可提前停止翻頁
    { name: 'min-mileage', type: 'int', help: '里程下限（km）— 客戶端 filter' },
    { name: 'max-mileage', type: 'int', help: '里程上限（km）— 客戶端 filter；若未指定 --sort 會自動用 sort=mile-asc 提前停頁' },
    { name: 'min-mileage-wan', type: 'float', help: '里程下限（萬 km），例：--min-mileage-wan 1.5 = 15000 km' },
    { name: 'max-mileage-wan', type: 'float', help: '里程上限（萬 km），例：--max-mileage-wan 5 = 50000 km' },
    // 排序
    { name: 'sort', type: 'string', help: '排序：price / year / mile / gas，可加 -asc/-desc（例：--sort mile-asc / price-desc）' },
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

    // 年份範圍 / 車齡（兩者互斥）
    const yFrom = kwargs['year-from'] != null ? Number(kwargs['year-from']) : null;
    const yTo = kwargs['year-to'] != null ? Number(kwargs['year-to']) : null;
    const maxAge = kwargs['max-age'] != null ? Number(kwargs['max-age']) : null;
    const minAge = kwargs['min-age'] != null ? Number(kwargs['min-age']) : null;
    const hasAbsYear = yFrom != null || yTo != null;
    const hasAge = maxAge != null || minAge != null;
    if (hasAbsYear && hasAge) {
      throw new Error('不能同時使用 --year-from/--year-to 和 --max-age/--min-age');
    }
    if (hasAbsYear) {
      const lo = yFrom ?? 1990;
      const hi = yTo ?? new Date().getFullYear() + 1;
      if (lo > hi) throw new Error(`--year-from (${lo}) 必須 ≤ --year-to (${hi})`);
      params.push(`y[]=${lo}_${hi}`);
    } else if (hasAge) {
      const now = new Date().getFullYear();
      // age: 越小 = 越新。max-age=3 意思是 3 年以內（含今年 ~ 3 年前）
      const hi = now - (minAge ?? 0) + 1; // 最新年份
      const lo = now - (maxAge ?? 50);    // 最舊年份
      if (lo > hi) throw new Error(`--min-age (${minAge}) 必須 ≤ --max-age (${maxAge})`);
      params.push(`y[]=${lo}_${hi}`);
    }

    // 車種 t[]=N
    if (kwargs.body) {
      for (const s of String(kwargs.body).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`t[]=${resolveBody(s)}`);
      }
    }

    // 變速 tab[]=N
    if (kwargs.transmission) {
      for (const s of String(kwargs.transmission).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`tab[]=${resolveTransmission(s)}`);
      }
    }

    // 驅動 drive[]=N
    if (kwargs.drivetrain) {
      for (const s of String(kwargs.drivetrain).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`drive[]=${resolveDrivetrain(s)}`);
      }
    }

    // 車門 door[]=N（N = door_count - 2）
    if (kwargs.doors) {
      for (const s of String(kwargs.doors).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`door[]=${resolveDoors(s)}`);
      }
    }

    // 座位 chair[]=N
    if (kwargs.seats) {
      for (const s of String(kwargs.seats).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`chair[]=${resolveSeats(s)}`);
      }
    }

    // 排氣量 g=min_max (cc)。cc 和 liter 互斥，cc 優先
    const minCc = kwargs['min-cc'] != null ? Number(kwargs['min-cc']) : null;
    const maxCc = kwargs['max-cc'] != null ? Number(kwargs['max-cc']) : null;
    const minLiter = kwargs['min-liter'] != null ? Number(kwargs['min-liter']) : null;
    const maxLiter = kwargs['max-liter'] != null ? Number(kwargs['max-liter']) : null;
    const hasCc = minCc != null || maxCc != null;
    const hasLiter = minLiter != null || maxLiter != null;
    if (hasCc && hasLiter) {
      throw new Error('不能同時使用 --min-cc/--max-cc 和 --min-liter/--max-liter');
    }
    if (hasCc) {
      const lo = minCc ?? 0;
      const hi = maxCc ?? 9999;
      if (lo > hi) throw new Error(`--min-cc (${lo}) 必須 ≤ --max-cc (${hi})`);
      params.push(`g=${lo}_${hi}`);
    } else if (hasLiter) {
      const lo = minLiter != null ? Math.round(minLiter * 1000) : 0;
      const hi = maxLiter != null ? Math.round(maxLiter * 1000) : 9999;
      if (lo > hi) throw new Error(`--min-liter (${minLiter}) 必須 ≤ --max-liter (${maxLiter})`);
      params.push(`g=${lo}_${hi}`);
    }

    // 地區（逗號分隔 → 支援縣市名 或 北部/中部/南部/東部/離島 分組）
    if (kwargs.region) {
      const names = String(kwargs.region).split(',').map((s) => s.trim()).filter(Boolean);
      const collectedIds = new Set<number>();
      for (const name of names) {
        if (name in REGION_GROUPS) {
          // 分組：展開成多個縣市 ID
          for (const id of REGION_GROUPS[name]) collectedIds.add(id);
          continue;
        }
        const id = REGION_LOOKUP[name];
        if (id == null) {
          throw new Error(
            `Unknown region: "${name}". Valid groups: 北部/中部/南部/東部/離島 ` +
            `or 縣市: ${Object.keys(REGION_LOOKUP).filter((k) => !/^.{2}$/.test(k)).join(', ')}`,
          );
        }
        collectedIds.add(id);
      }
      for (const id of collectedIds) params.push(`r[]=${id}`);
    }

    // 車色 color[]=N
    if (kwargs.color) {
      for (const s of String(kwargs.color).split(',').map((x) => x.trim()).filter(Boolean)) {
        params.push(`color[]=${resolveColor(s)}`);
      }
    }

    // Toggle flags
    if (kwargs['personal-only']) params.push('personal=1');
    if (kwargs['in-store-only']) params.push('exsits=1');
    if (kwargs['audit-only']) params.push('report=1');
    if (kwargs['premium-only']) params.push('yx=1');
    if (kwargs['recent-only']) params.push('inweek=1');
    if (kwargs['has-video']) params.push('video=1');

    // 關鍵字搜尋（free text）
    if (kwargs.search) {
      const q = String(kwargs.search).trim();
      if (q) params.push(`key=${encodeURIComponent(q)}`);
    }

    // 里程範圍（客戶端 filter — 8891 沒伺服器端支援）
    // 解析 km 或 萬km 兩種輸入
    let minMileageKm: number | null = null;
    let maxMileageKm: number | null = null;
    if (kwargs['min-mileage'] != null) minMileageKm = Number(kwargs['min-mileage']);
    if (kwargs['max-mileage'] != null) maxMileageKm = Number(kwargs['max-mileage']);
    if (kwargs['min-mileage-wan'] != null) {
      if (minMileageKm != null) throw new Error('不能同時使用 --min-mileage 和 --min-mileage-wan');
      minMileageKm = Math.round(Number(kwargs['min-mileage-wan']) * 10000);
    }
    if (kwargs['max-mileage-wan'] != null) {
      if (maxMileageKm != null) throw new Error('不能同時使用 --max-mileage 和 --max-mileage-wan');
      maxMileageKm = Math.round(Number(kwargs['max-mileage-wan']) * 10000);
    }
    if (minMileageKm != null && maxMileageKm != null && minMileageKm > maxMileageKm) {
      throw new Error(`--min-mileage (${minMileageKm}) 必須 ≤ --max-mileage (${maxMileageKm})`);
    }

    // 排序 + 自動優化：有 --max-mileage 又沒指定 --sort → 自動 mile-asc 以便提前停頁
    let sortValue: string | null = null;
    if (kwargs.sort) {
      sortValue = resolveSort(String(kwargs.sort));
    } else if (maxMileageKm != null) {
      sortValue = 'mile-asc';
    }
    if (sortValue) params.push(`sort=${sortValue}`);

    const baseQuery = params.join('&');
    const rows: any[] = [];

    // 分頁迴圈 — 重構以支援客戶端 filter
    // 原本用 pagesNeeded 固定抓幾頁；改成持續抓到 limit 達標或沒資料
    // MAX_PAGES_SAFETY：防 runaway + 避開 opencli 60s timeout。
    // 每頁 page.goto 約 ~3s，15 頁 ≈ 45s 留空間給其他邏輯。
    // 對大範圍 --min-mileage 查詢，建議用 --brand / --year-from 等縮小 inventory 再濾。
    const MAX_PAGES_SAFETY = 15;
    let exitEarly = false;
    for (let p = startPage; p < startPage + MAX_PAGES_SAFETY && !exitEarly; p++) {
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
      if (listRows.length === 0) break;

      // 客戶端 filter — 針對里程範圍（8891 沒伺服器端）
      for (const item of listRows) {
        const km = parseMileageKm(item.mileage);
        if (minMileageKm != null && (km == null || km < minMileageKm)) continue;
        if (maxMileageKm != null && km != null && km > maxMileageKm) {
          // 若為 mile-asc 排序，後面的只會更大 → 提前停頁
          if (sortValue === 'mile-asc') {
            exitEarly = true;
            break;
          }
          continue;
        }
        if (maxMileageKm != null && km == null) continue; // 電洽/缺里程的車在 --max-mileage 時排除
        rows.push(item);
        if (rows.length >= limit) {
          exitEarly = true;
          break;
        }
      }
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
