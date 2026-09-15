import { expect, test, type Page } from '@playwright/test';
import { PAGES, entryPages } from '../src/domain/catalog';
import { FAMILY_HOME, FAMILY_REPOS } from '../src/domain/family-repos';

/**
 * SEO 回归：断言**构建产物**里的 SEO 元数据真的对。
 *
 * 为什么这一层必须单独测（而且测的是 dist 产物而不是 src）：
 *
 *  这些页面全是整屏画布，用户在浏览器里**看不到**任何 SEO 相关的东西 ——
 *  `<title>` 不显示在页面上、meta 只给爬虫看、文字版是 1px 隐藏的。
 *  也就是说 SEO 全错了也不会有任何症状，只有搜索排名受影响。
 *  所以判据必须落在"产出文件里到底写了什么"，而且必须能挡住这几类真实事故：
 *
 *   - `<title>` 被拼成两个（浏览器取第一个 → 改了没生效）；
 *   - JSON-LD 里出现裸 `</script>`（提前收尾 → 整页坏掉，但用户在 canvas 上看不出）；
 *   - 文字版被 `display:none`（屏幕阅读器与部分爬虫直接跳过 → 白写）；
 *   - 文字版里的链接是死链（爬虫顺着爬发现不了页面）；
 *   - 配/不配站点根时字段该出现的出现、该消失的消失（**不能出现半个假地址**）。
 *
 * ## 两个常量**刻意写死**在这里
 *
 * `SITE_NAME` 与 `SR_ONLY_CLASS` 都能从 `scripts/lib/seo.cjs` 读，但那是 CJS（构建期脚本），
 * 在 TS 测试里引用要额外维护一份 `.d.cts` 类型声明 —— 为两个字符串不划算。
 * 写死的代价是"改品牌名或改类名时这两处测试会红"：**那正是想要的信号**，
 * 品牌名变了测试本来就该跟着变。真正需要防漂移的是**地址**，用下面那条清单断言守（见文末）。
 */
const SITE_NAME = '画布游戏厅';
const SR_ONLY_CLASS = 'ice-seo-sr';

const SEO_PAGES = [
  { path: '/index.html', isHome: true },
  ...PAGES.map((page) => ({ path: `/${page.page}`, isHome: false })),
];

/** 读一个页面的 DOM 层 SEO 状态（在浏览器里跑，拿到的是解析后的真实结果）。 */
async function readSeo(page: Page, path: string) {
  await page.goto(path);
  return page.evaluate((srClass) => {
    const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
    const prop = (property: string) => document.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;
    const icons = Array.from(document.querySelectorAll('link[rel~="icon"]')).map((el) => el.getAttribute('href') ?? '');
    const ld = document.querySelector('script[type="application/ld+json"]');
    const sr = document.querySelector(`.${srClass}`);
    const srStyle = sr ? getComputedStyle(sr) : null;
    const srRect = sr ? sr.getBoundingClientRect() : null;
    // 画布的设计宽度（视口应当与它一致 —— 本仓画布宽度并不统一：XP 桌面是 1440）。
    // ⚠️ 字母边（letterbox）页会在运行时用 fitCanvasToDisplaySize 把 <canvas> 的 width 属性
    // 改成「显示尺寸」，所以这里不能直接读属性，要除以引擎视口缩放还原成设计宽度
    // （screen = world * scale → world = screen / scale）。scale 缺失的页（小游戏 / 首页）按 1 处理。
    const firstCanvas = document.querySelector('canvas');
    const ice = (window as any).__arcade?.ice || (window as any).__result?.ice || null;
    const scale = ice && ice.viewport ? (ice.viewport.scale || 1) : 1;
    const rect = firstCanvas ? firstCanvas.getBoundingClientRect() : null;
    const canvasWidth = rect ? Math.round(rect.width / scale) : null;
    return {
      titleCount: document.querySelectorAll('title').length,
      title: document.title,
      description: meta('description'),
      keywords: meta('keywords'),
      robots: meta('robots'),
      viewport: meta('viewport'),
      canvasWidth,
      ogTitle: prop('og:title'),
      ogDescription: prop('og:description'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      ogImageCount: document.querySelectorAll('meta[property="og:image"]').length,
      icons,
      jsonLdRaw: ld ? ld.textContent : null,
      sr: sr
        ? {
            text: sr.textContent.replace(/\s+/g, ' ').trim(),
            links: Array.from(sr.querySelectorAll('a')).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
            headings: Array.from(sr.querySelectorAll('h1,h2')).map((h) => h.tagName),
            width: srRect!.width,
            height: srRect!.height,
            display: srStyle!.display,
            position: srStyle!.position,
            clipPath: srStyle!.clipPath,
          }
        : null,
    };
  }, SR_ONLY_CLASS);
}

test.describe('SEO：TDK 与结构化数据', () => {
  for (const target of SEO_PAGES) {
    test(`${target.path} 的 title / description / JSON-LD 都正确`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const seo = await readSeo(page, target.path);

      // ① title 只能有一个（两个的话浏览器取第一个，等于改动没生效）
      expect(seo.titleCount, 'title 被拼成了多个').toBe(1);
      expect(seo.title.length, 'title 太短，等于没有').toBeGreaterThan(8);
      // 站点名必须在 title 里（品牌词 + 搜索结果里的辨识度）
      expect(seo.title).toContain(SITE_NAME);

      // ② description 要有、且不能长到被搜索结果截断
      expect(seo.description, '缺 meta description').toBeTruthy();
      expect(seo.description!.length).toBeGreaterThan(20);
      expect(seo.description!.length).toBeLessThanOrEqual(160);
      expect(seo.keywords, '缺 meta keywords').toBeTruthy();
      expect(seo.robots, '缺 robots 指令').toContain('index');

      // ③ viewport 必须与**这个页面自己的画布宽度**一致。
      //    本仓不做响应式重排（固定设计尺寸），视口不匹配的话移动端会把画布两侧裁掉。
      //    ⚠️ 别写成固定的 1180：Windows XP 桌面的画布是 1440×900，各页并不统一
      //    —— 这条断言最早就是硬编码 1180 而假失败的。
      expect(seo.canvasWidth, '页面里没有画布？').toBeGreaterThan(0);
      expect(seo.viewport, 'viewport 与画布宽度不一致（移动端会裁掉画布两侧）').toBe(`width=${seo.canvasWidth}`);

      // ④ Open Graph（分享到社交平台时用）
      expect(seo.ogTitle).toBe(seo.title);
      expect(seo.ogDescription).toBe(seo.description);

      // ⑤ JSON-LD 必须是可解析的合法 JSON，且类型符合页面角色
      expect(seo.jsonLdRaw, '缺 JSON-LD').toBeTruthy();
      const data = JSON.parse(seo.jsonLdRaw!);
      const types = (Array.isArray(data) ? data : [data]).map((item: any) => item['@type']);
      if (target.isHome) {
        expect(types).toEqual(['WebSite', 'ItemList']);
        const list = data[1];
        expect(list.numberOfItems, 'ItemList 没覆盖全部页面').toBe(PAGES.length);
      } else {
        expect(types).toEqual(['VideoGame']);
        expect(data.inLanguage).toBe('zh-CN');
        expect(data.offers?.price, '免费游戏应标 0 元（搜索里会显示"免费"）').toBe('0');
      }

      // ⑥ 站点图标必须是**可抓取的文件**，且只有一个 icon 链接。
      //    data URI 图标能避开 /favicon.ico 404，但**搜索引擎不认**；
      //    留两个 icon 链接还会让"到底用哪个"变得不确定（踩过）。
      const icons = seo.icons.filter((href) => !href.startsWith('data:'));
      expect(icons, '应当只有一个非 data: 的图标链接').toHaveLength(1);
      expect(icons[0], '站点图标必须指向可抓取的文件').toContain('favicon');

      expect(errors).toEqual([]);
    });
  }

  test('配了站点根时才写 canonical / og:url（没配就一个假地址都不许出现）', async ({ page }) => {
    const seo = await readSeo(page, '/index.html');
    const configured = process.env.ICE_GAME_SITE_URL;

    if (!configured) {
      /*
       * 本仓目前没有对外域名，所以构建时 `ICE_GAME_SITE_URL` 未配置 →
       * canonical 必须**缺席**。
       *
       * 这条断言守的是"诚实"：编一个不存在的域名写进 canonical，比不写更糟
       * （搜索引擎会把规范化指向一个 404）。
       */
      expect(seo.canonical, '未配置站点根却写了 canonical —— 那是编出来的地址').toBeNull();
      const data = JSON.parse(seo.jsonLdRaw!);
      expect(data[0].url, '未配置站点根却写了绝对 url').toBeUndefined();
      expect(seo.ogImageCount, '未配置站点根却写了 og:image —— 相对路径的 og:image 多数平台解析不了').toBe(0);
    } else {
      // 配了就必须全线补齐：canonical / og:url / og:image 都是**绝对**地址
      expect(seo.canonical, '配了站点根却没写 canonical').toContain(configured);
      expect(seo.canonical).toContain('/index.html');
      const data = JSON.parse(seo.jsonLdRaw!);
      expect(data[0].url).toBe(`${configured.replace(/\/+$/, '')}/index.html`);
      // 首页自己没有封面 → 借站点里第一张封面当分享图（否则分享卡片没图）
      expect(seo.ogImageCount, '配了站点根却没写 og:image，分享卡片会没图').toBeGreaterThan(0);
    }
  });
});

test.describe('SEO：给爬虫与屏幕阅读器看的「文字版」', () => {
  test('文字版确实存在，且是「视觉隐藏」而不是「对辅助技术隐藏」', async ({ page }) => {
    const seo = await readSeo(page, '/index.html');
    expect(seo.sr, '缺文字版').not.toBeNull();

    // 视觉上真的看不见（1px + clip）——否则会盖在画布上
    expect(seo.sr!.width, '文字版没有被缩小到不可见').toBeLessThanOrEqual(2);
    expect(seo.sr!.height).toBeLessThanOrEqual(2);
    expect(seo.sr!.clipPath).toContain('inset');

    /*
     * 但**不能**是 `display: none` / `visibility: hidden`。
     *
     * 这是这套方案最容易写错的一处：`display:none` 同样"看不见"，
     * 而它会让屏幕阅读器与部分爬虫**直接跳过**这段 DOM，于是这段文字等于没写。
     * （用 clip 隐藏是 Bootstrap `.visually-hidden` 那套无障碍标准做法。）
     */
    expect(seo.sr!.display, '文字版用了 display:none —— 辅助技术会跳过它').not.toBe('none');
    // 必须脱离文档流：首页/游戏页的 body 都是 flex，参与布局会把画布挤歪
    expect(seo.sr!.position).toBe('absolute');
  });

  test('文字版内容与页面数据一致（不是另写给爬虫的关键词）', async ({ page }) => {
    // 首页：每个页面的标题与说明都要在
    const home = await readSeo(page, '/index.html');
    const homeText = home.sr!.text;
    for (const item of PAGES) {
      expect(homeText, `首页文字版缺 ${item.slug} 的标题`).toContain(item.title);
      expect(homeText, `首页文字版缺 ${item.slug} 的说明`).toContain(item.tagline);
    }

    // 游戏页：自己的说明与每一条操作说明都要在（操作的原文来自 meta.json）
    for (const item of PAGES) {
      const seo = await readSeo(page, `/${item.page}`);
      for (const [keys, action] of item.controls) {
        expect(seo.sr!.text, `${item.slug} 文字版缺操作「${keys}」`).toContain(keys);
        expect(seo.sr!.text, `${item.slug} 文字版缺操作说明「${action}」`).toContain(action);
      }
    }
  });

  test('文字版的链接图是连通的：任意页面都能爬到首页与其它页面', async ({ page }) => {
    // ① 首页链到全部页面
    const home = await readSeo(page, '/index.html');
    const homeHrefs = home.sr!.links.map((link) => link.href);
    for (const path of entryPages()) {
      expect(homeHrefs, `首页文字版没有链到 ${path}`).toContain(path);
    }

    // ② 每个页面都链回首页，且链到**所有其它页面**（不只是同展区的）
    for (const item of PAGES) {
      const seo = await readSeo(page, `/${item.page}`);
      const hrefs = seo.sr!.links.map((link) => link.href);
      expect(hrefs, `${item.slug} 文字版没有回到首页的链接`).toContain('index.html');
      for (const other of PAGES) {
        if (other.slug === item.slug) continue;
        expect(hrefs, `${item.slug} 文字版没有链到 ${other.slug}`).toContain(other.page);
      }
      // 自己不该链自己
      expect(hrefs, `${item.slug} 文字版链到了自己`).not.toContain(item.page);
    }
  });

  test('文字版里的链接是**真链接**：真点击能到达目标页（不是死链）', async ({ page }) => {
    await page.goto('/index.html');
    // 链接是隐藏的，所以走 DOM 点击（Playwright 的可见性检查会拒绝隐藏元素）；
    // 但这仍然验证了"href 真的可导航"—— 死链在这里会 404 而不是静默失败。
    await page.evaluate(() => {
      const link = document.querySelector('.ice-seo-sr a[href="breakout.html"]') as HTMLAnchorElement;
      link.click();
    });
    await page.waitForURL(/breakout\.html$/);
    expect(page.url()).toMatch(/breakout\.html$/);

    // 从游戏页再点回首页
    await page.evaluate(() => {
      const link = document.querySelector('.ice-seo-sr a[href="index.html"]') as HTMLAnchorElement;
      link.click();
    });
    await page.waitForURL(/index\.html$/);
    expect(page.url()).toMatch(/index\.html$/);
  });

  test('文字版里的外链都必须与 family-repos.ts 一致（地址只有一份事实来源）', async ({ page }) => {
    const home = await readSeo(page, '/index.html');

    /*
     * 这条守的是一个**真实的漂移风险**：`scripts/lib/seo.cjs` 是构建期 CJS，
     * 读不到 `src/domain/family-repos.ts`（TS），所以它里面的家族主页地址是**硬编码**的。
     * 两处各写一份就不可能靠"记得同步"来保证一致 —— 用清单断言兜住：
     * 文字版里出现的每个外链，都必须在 family-repos.ts 的已核实清单里。
     */
    const allowed = new Set<string>([FAMILY_HOME, ...FAMILY_REPOS.map((repo) => repo.url)]);
    const external = home.sr!.links.map((link) => link.href!).filter((href) => /^https?:\/\//.test(href));

    expect(external.length, '首页文字版应当指向家族主页').toBeGreaterThan(0);
    for (const href of external) {
      expect(allowed.has(href), `文字版里的外链 ${href} 不在 family-repos.ts 的清单里（地址漂移了？）`).toBe(true);
    }
  });
});

test.describe('SEO：站点级文件', () => {
  test('robots.txt 可访问、允许抓取，且不会指向不存在的 sitemap', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response!.status()).toBe(200);
    const body = (await response!.text()).trim();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');

    // sitemap 规范要求绝对 URL，所以未配置域名时**不能**留一行指向 sitemap.xml
    // （留了就是一个 404 的 Sitemap 声明，比不写更糟）
    if (!process.env.ICE_GAME_SITE_URL) {
      expect(body, '未配置域名却声明了 sitemap').not.toMatch(/^Sitemap:/m);
      // 用 request API 而不是 page.goto：goto 遇到 4xx 会**抛错**而不是返回状态码
      const missing = await page.request.get('/sitemap.xml');
      expect(missing.status(), '未配置域名却生成了 sitemap.xml').toBe(404);
    } else {
      expect(body).toMatch(/^Sitemap:/m);
    }
  });

  test('favicon.svg 可访问（搜索引擎要求图标是可抓取的 URL）', async ({ page }) => {
    const response = await page.request.get('/favicon.svg');
    expect(response.status()).toBe(200);
    const svg = await response.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 32 32"');
  });
});
