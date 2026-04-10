import { cli, Strategy } from '@jackwener/opencli/registry';

// 8891 汽車 - 單一車輛詳情頁
// URL 模式：https://auto.8891.com.tw/usedauto-infos-{id}.html
// SSR HTML，無需登入。支援 --id 單筆 或 --ids 批次（逗號分隔）。
//
// 欄位來源：
//   title         h1
//   price         [class*="auto-price"]
//   msrp          [class*="newcar-price"]        (新車價)
//   brand/model   breadcrumb 最後兩個 <a>
//   spec-grid     [class*="info-grid"] → label/value pairs
//                 所在地 / 里程實拍 / 引擎燃料 / (年份+領牌) / 滿電里程
//                 / 變速系統 / 驅動方式 / 車門乘客
//   conditions    [class*="vehicle-condition-item"] img[alt]
//   highlights    [class*="newcar-equipment-item"] p
//   photos        img src 符合 /YYYY/MM/DD/\d{10,} 模式
//   seller        [class*="seller-intro"] h2 p
//   seller_type   是否有 is-personal class → 車主自售 / 車商

cli({
  site: '8891',
  name: 'detail',
  description: '8891 汽車 - 單一車輛詳情（規格/配備/照片/賣家）',
  domain: 'auto.8891.com.tw',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', type: 'string', help: '單一車輛 ID，例：4600208' },
    { name: 'ids', type: 'string', help: '批次查詢，逗號分隔：4600208,4632355' },
    { name: 'delay-ms', type: 'int', default: 300, help: '批次之間延遲毫秒（避免觸發限流）' },
  ],
  columns: ['id', 'title', 'price', 'brand', 'model', 'year', 'mileage', 'location', 'seller', 'photo_count'],
  func: async (page, kwargs) => {
    // --- 組 ID 清單 ---
    const idList: string[] = [];
    if (kwargs.id) idList.push(String(kwargs.id).trim());
    if (kwargs.ids) {
      for (const s of String(kwargs.ids).split(',')) {
        const t = s.trim();
        if (t) idList.push(t);
      }
    }
    if (idList.length === 0) {
      throw new Error('請提供 --id 或 --ids 參數');
    }

    const delayMs = Number(kwargs['delay-ms']) || 0;
    const results: any[] = [];

    for (let i = 0; i < idList.length; i++) {
      const id = idList[i];
      const url = `https://auto.8891.com.tw/usedauto-infos-${id}.html`;

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const detail = await page.evaluate(`(() => {
        const $ = (sel) => document.querySelector(sel);
        const $$ = (sel) => Array.from(document.querySelectorAll(sel));
        const text = (el) => (el && el.textContent ? el.textContent.trim() : null);

        // --- title ---
        const title = text($('h1'));

        // --- price / msrp ---
        const priceText = text($('[class*="_price-text"]'));
        const priceUnit = text($('[class*="_price-unit"]'));
        const price = priceText && priceUnit ? priceText + priceUnit : (priceText || null);
        const msrpRaw = text($('[class*="newcar-price"]'));
        const msrpMatch = msrpRaw && msrpRaw.match(/([\\d.]+\\s*萬)/);
        const msrp = msrpMatch ? msrpMatch[1].replace(/\\s+/g, '') : null;

        // --- breadcrumb: brand / model ---
        const crumbLinks = $$('[class*="bread-crumbs"] a[href*="auto.8891.com.tw/"]');
        // 忽略第一個「中古車」, 保留 brand 和 model
        let brand = null;
        let model = null;
        for (const a of crumbLinks) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/auto\\.8891\\.com\\.tw\\/([^/?#]+)(?:\\/([^/?#]+))?\\/?$/);
          if (!m) continue;
          if (m[1] && !m[2]) brand = text(a);
          else if (m[1] && m[2]) { brand = brand || text(a); model = text(a); }
        }
        // 精準版：最後一個 a = model, 倒數第二個 = brand
        const carLinks = crumbLinks.filter(a => {
          const h = a.getAttribute('href') || '';
          return /auto\\.8891\\.com\\.tw\\/[^/?#]+/.test(h) && !/^https?:\\/\\/auto\\.8891\\.com\\.tw\\/?$/.test(h);
        });
        if (carLinks.length >= 1) brand = text(carLinks[carLinks.length - 2] || carLinks[0]) || brand;
        if (carLinks.length >= 2) model = text(carLinks[carLinks.length - 1]) || model;

        // --- spec grid (label / value pairs) ---
        const specs = {};
        $$('[class*="info-grid"] [class*="info-item"]').forEach((item) => {
          const value = text(item.querySelector('[class*="info-value"]'));
          const label = text(item.querySelector('[class*="info-label"]'));
          if (label && value) specs[label] = value;
        });
        // 特例：年份 item 的 label 是領牌日期，value 是出廠年
        // specs 裡會變成 "2022/12領牌": "2022年出廠"
        let year = null;
        let licenseDate = null;
        for (const [k, v] of Object.entries(specs)) {
          if (/\\d{4}\\/\\d{1,2}領牌/.test(k) && /\\d{4}年/.test(v)) {
            licenseDate = k.replace('領牌', '');
            year = v.replace('出廠', '');
            delete specs[k];
            break;
          }
        }

        // --- conditions ---
        const conditions = $$('[class*="vehicle-condition-item"] img')
          .map((img) => img.getAttribute('alt'))
          .filter(Boolean);

        // --- equipment highlights ---
        const highlights = $$('[class*="newcar-equipment-item"] p')
          .map((p) => text(p))
          .filter(Boolean);

        // --- photos (only car's own album, path contains /s{id}/) ---
        // 注意：詳情頁只預載 3 張縮圖，完整相簿需展開 gallery 才有
        const photoSet = new Set();
        $$('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (!/\\/s\\d+\\//.test(src)) return;
          // 去重：移除尺寸後綴 (_800_600 / _200_150) 和版本參數 (?v=N)
          const normalized = src
            .replace(/_\\d+_\\d+(\\.(?:jpg|png|webp))/, '$1')
            .replace(/\\?v=\\d+$/, '');
          photoSet.add(normalized);
        });
        const photos = Array.from(photoSet);

        // --- seller ---
        const sellerIntro = $('[class*="seller-intro"]');
        const seller = text(sellerIntro?.querySelector('h2 p')) || text(sellerIntro?.querySelector('h2'));
        const isPersonal = !!$('[class*="is-personal"]');

        return {
          title,
          price,
          msrp,
          brand,
          model,
          year,
          licenseDate,
          mileage: specs['里程實拍'] || null,
          fuel: specs['引擎燃料'] || null,
          evRange: specs['滿電里程'] || null,
          transmission: specs['變速系統'] || null,
          drivetrain: specs['驅動方式'] || null,
          doorsSeats: specs['車門乘客'] || null,
          location: specs['所在地'] || null,
          conditions,
          highlights,
          photos,
          seller,
          sellerType: isPersonal ? '車主自售' : '車商',
        };
      })()`);

      const d = detail as any;
      results.push({
        id,
        title: d.title || '',
        price: d.price || '',
        msrp: d.msrp || '',
        brand: d.brand || '',
        model: d.model || '',
        year: d.year || '',
        license_date: d.licenseDate || '',
        mileage: d.mileage || '',
        fuel: d.fuel || '',
        ev_range: d.evRange || '',
        transmission: d.transmission || '',
        drivetrain: d.drivetrain || '',
        doors_seats: d.doorsSeats || '',
        location: d.location || '',
        seller: d.seller || '',
        seller_type: d.sellerType || '',
        conditions: (d.conditions || []).join(' | '),
        highlights: (d.highlights || []).join(' | '),
        photo_count: (d.photos || []).length,
        photos: (d.photos || []).join(' '),
        url,
      });

      // 批次查詢時的延遲
      if (delayMs > 0 && i < idList.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return results;
  },
});
