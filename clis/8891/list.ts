import { cli, Strategy } from '@jackwener/opencli/registry';

// 8891 汽車 - 通用列表命令，支援常見篩選
// URL 範例：https://auto.8891.com.tw/?power[]=4&price=0_1500000&exsits=1&page=1
//
// 已知參數：
//   power[]=N       燃料類型（4=純電車；其餘值尚未窮舉）
//   price=min_max   價格範圍，單位 TWD（此 CLI 對外以「萬」計）
//   exsits=1        排除不在店（8891 官方拼字就是 exsits，非 exists）
//   page=N          頁碼，每頁 40 筆

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
    { name: 'power', type: 'string', help: '燃料類型代碼，例：4=純電車（可多值以逗號分隔：4,3）' },
    { name: 'min-price', type: 'int', help: '最低價格（單位：萬）' },
    { name: 'max-price', type: 'int', help: '最高價格（單位：萬）' },
    { name: 'in-store-only', type: 'bool', default: false, help: '排除不在店車輛' },
  ],
  columns: ['rank', 'id', 'title', 'price', 'year', 'mileage', 'location', 'updated_ago', 'view_count', 'current_viewers', 'url'],
  func: async (page, kwargs) => {
    const startPage = Number(kwargs.page) || 1;
    const limit = Number(kwargs.limit) || 20;
    const pagesNeeded = Math.ceil(limit / 40);

    // --- 組 query string ---
    const params: string[] = [];

    if (kwargs.power) {
      const powers = String(kwargs.power).split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of powers) params.push(`power[]=${encodeURIComponent(p)}`);
    }

    const minWan = kwargs['min-price'] != null ? Number(kwargs['min-price']) : null;
    const maxWan = kwargs['max-price'] != null ? Number(kwargs['max-price']) : null;
    if (minWan != null || maxWan != null) {
      const lo = minWan != null ? minWan * 10000 : 0;
      const hi = maxWan != null ? maxWan * 10000 : 99999999;
      params.push(`price=${lo}_${hi}`);
    }

    if (kwargs['in-store-only']) params.push('exsits=1');

    const baseQuery = params.join('&');
    const rows: any[] = [];

    for (let p = startPage; p < startPage + pagesNeeded; p++) {
      const url = `https://auto.8891.com.tw/?${baseQuery}${baseQuery ? '&' : ''}page=${p}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const pageRows = await page.evaluate(`(() => {
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
      price: item.price || '',
      year: item.year || '',
      mileage: item.mileage || '',
      location: item.location || '',
      updated_ago: item.updated_ago || '',
      view_count: item.view_count ?? '',
      current_viewers: item.current_viewers || '',
      tagline: item.tagline || '',
      promo: item.promo || '',
      badges: item.badges || '',
      url: item.url || '',
    }));
  },
});
