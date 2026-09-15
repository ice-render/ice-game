/**
 * SEO 元数据生成器的单测（纯函数，不需要 webpack / 浏览器）。
 *
 * 为什么值得单独测：这一层错了**不会报错**，只会静默地让搜索引擎看到一份坏数据 ——
 * 比如 `<title>` 被拼成两个、JSON-LD 里的 `</script>` 把页面写坏、
 * description 长到被搜索结果截断、结构化数据不是合法 JSON。
 * 这些在浏览器里看一切正常（用户看的是 canvas），只有爬虫受影响。
 *
 * 测试文件用 `.cjs`：被测对象 `scripts/lib/seo.cjs` 是构建期脚本（webpack 要 require 它），
 * 用同形态的测试可以直接 require，不必在 TS 里绕类型。见 jest.config.js 的 testMatch 说明。
 */
const seo = require('../scripts/lib/seo.cjs');

/* ------------------------------ 假数据 ------------------------------ */

/** 造一条和 `scanAll()` 返回结构一致的页面记录（只填 SEO 会用到的字段）。 */
function makePage(overrides = {}) {
  const slug = overrides.slug || 'demo';
  return {
    slug,
    partition: 'games',
    kind: overrides.kind || 'game',
    page: `${slug}.html`,
    chunk: slug,
    meta: {
      slug,
      kind: overrides.kind || 'game',
      title: overrides.title || '示例游戏',
      tagline: overrides.tagline || '这是一句话说明',
      accent: '#0d6efd',
      features: overrides.features || [],
      controls: overrides.controls || [['空格', '开始']],
      width: 1180,
      height: 800,
      background: '#080a0f',
    },
  };
}

const PAGES = [
  makePage({ slug: 'breakout', title: '打砖块', tagline: '挡板接球，清空所有砖块', controls: [['← →', '移动挡板'], ['空格', '发球']] }),
  makePage({ slug: 'arcade', kind: 'machine', title: 'ICE Arcade 掌机', tagline: '一台掌机，四张卡带', features: ['俄罗斯方块', '贪吃蛇'] }),
];

/** 一个最小但形态真实的页面 HTML（注意：**没有** `<head>` 标签，与仓里的模板一致）。 */
const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <meta charset="utf-8" />
  <title>旧标题</title>
  <body>
    <canvas id="canvas" width="1180" height="800"></canvas>
  </body>
</html>`;

/* ------------------------------ 文本工具 ------------------------------ */

describe('文本工具', () => {
  it('escapeHtml 转义全部敏感字符（& 必须最先处理，否则实体会被二次转义）', () => {
    expect(seo.escapeHtml(`<a href="x" & 'y'>`)).toBe('&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;');
    expect(seo.escapeHtml(undefined)).toBe('');
  });

  it('truncateDisplay 按显示宽度算（中日韩字符计 2）并在末尾加省略号', () => {
    // "中文字符测试" = 6 个汉字 = 12 显示宽度
    expect(seo.truncateDisplay('中文字符测试', 12)).toBe('中文字符测试');
    // 上限 10 时只装得下 5 个汉字，第 6 个放不下就整体截断
    expect(seo.truncateDisplay('中文字符测试', 10)).toBe('中文字符测…');
    // ASCII 只算 1
    expect(seo.truncateDisplay('abcdefgh', 8)).toBe('abcdefgh');
    expect(seo.truncateDisplay('abcdefgh', 5)).toBe('abcde…');
  });

  it('truncateDisplay 会先剥掉悬挂的标点再补省略号（不在"、"后面直接跟"…"）', () => {
    // 两处都是"截断点正好落在一个标点上"，剥掉它再补省略号
    expect(seo.truncateDisplay('一、二、三', 8)).toBe('一、二…');
    expect(seo.truncateDisplay('一、二、三', 4)).toBe('一…');
  });

  it('unique 去重且保持原顺序', () => {
    expect(seo.unique(['a', 'b', 'a', ' ', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('absoluteUrl 归一化斜杠；没有站点根时返回 null（不拼出半截地址）', () => {
    expect(seo.absoluteUrl('https://example.com/', 'index.html')).toBe('https://example.com/index.html');
    expect(seo.absoluteUrl('https://example.com/sub/', 'a.html')).toBe('https://example.com/sub/a.html');
    expect(seo.absoluteUrl('https://example.com', '')).toBe('https://example.com');
    expect(seo.absoluteUrl(null, 'index.html')).toBeNull();
  });
});

/* -------------------------------- TDK -------------------------------- */

describe('TDK', () => {
  it('title：首页带品牌与站点性质；游戏页把页面名放最前（那是被搜的词）', () => {
    expect(seo.homeTitle()).toContain(seo.SITE.name);
    const title = seo.pageTitle(PAGES[0]);
    expect(title.startsWith('打砖块')).toBe(true);
    expect(title).toContain(seo.SITE.name);
  });

  it('description 受长度上限约束（超长会被搜索结果截断在半个词上）', () => {
    for (const page of PAGES) {
      expect(seo.pageDescription(page).length).toBeLessThanOrEqual(160);
    }
    expect(seo.homeDescription(PAGES).length).toBeLessThanOrEqual(160);
  });

  it('description 里带上页面自己的说明与按键（这些是用户真正会搜的东西）', () => {
    const text = seo.pageDescription(PAGES[0]);
    expect(text).toContain('挡板接球');
    expect(text).toContain('← →');
  });

  it('页面很多时首页 description 折叠成"等 N 个"而不是无限变长', () => {
    const many = Array.from({ length: 20 }, (_, i) => makePage({ slug: `p${i}`, title: `游戏${i}` }));
    const text = seo.homeDescription(many);
    expect(text).toContain('等 20 个页面');
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it('keywords 有硬上限（堆砌既无益又难看）', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makePage({ slug: `p${i}`, title: `游戏${i}`, features: [`玩法${i}a`, `玩法${i}b`] }),
    );
    expect(seo.homeKeywords(many).split(',')).toHaveLength(16);
    expect(seo.pageKeywords(PAGES[0], PAGES).split(',').length).toBeLessThanOrEqual(12);
  });

  it('keywords 去重（同一页里的标题与 features 可能有重叠词）', () => {
    const page = makePage({ slug: 'dup', title: '打砖块', features: ['打砖块'] });
    const words = seo.pageKeywords(page, [page]).split(',');
    expect(new Set(words).size).toBe(words.length);
  });
});

/* ----------------------------- 结构化数据 ----------------------------- */

describe('JSON-LD 结构化数据', () => {
  it('首页给 WebSite + ItemList，ItemList 覆盖全部页面', () => {
    const data = seo.buildJsonLd({ page: null, pages: PAGES, siteUrl: null });
    expect(data.map((item) => item['@type'])).toEqual(['WebSite', 'ItemList']);
    expect(data[1].numberOfItems).toBe(PAGES.length);
    expect(data[1].itemListElement.map((el) => el.position)).toEqual([1, 2]);
  });

  it('游戏页给 VideoGame，并带上操作提示与"免费"报价', () => {
    const data = seo.buildJsonLd({ page: PAGES[0], pages: PAGES, siteUrl: null });
    expect(data['@type']).toBe('VideoGame');
    expect(data.gameTip).toContain('移动挡板');
    expect(data.offers.price).toBe('0');
    expect(data.inLanguage).toBe(seo.SITE.lang);
  });

  it('配了站点根才写绝对 URL（url / image / ItemList 的 url）', () => {
    const without = seo.buildJsonLd({ page: PAGES[0], pages: PAGES, siteUrl: null });
    expect(without.url).toBeUndefined();
    expect(without.image).toBeUndefined();

    const withSite = seo.buildJsonLd({ page: PAGES[0], pages: PAGES, siteUrl: 'https://example.com/game' });
    expect(withSite.url).toBe('https://example.com/game/breakout.html');
    expect(withSite.image).toBe('https://example.com/game/covers/breakout.png');
    expect(withSite.isPartOf.url).toBe('https://example.com/game/index.html');
  });

  it('序列化时把 < 转成 \\u003c —— 否则内容里的 </script> 会提前结束标签、整页坏掉', () => {
    const evil = makePage({ slug: 'evil', tagline: '</script><script>alert(1)</script>' });
    const fragment = seo.buildHeadFragment({ page: evil, pages: [evil], siteUrl: null, coverUrl: null });

    // 正则本身按"非贪婪匹配到第一个 </script>"切，所以能切出**一个**块 = 内容里没有提前收尾
    const blocks = fragment.match(/<script[\s\S]*?<\/script>/g) || [];
    expect(blocks).toHaveLength(1);

    // 去掉外层标签后，内部不许再出现裸的 <script / </script（转义后它们长成 \u003cscript）
    const inner = blocks[0].replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(inner).not.toContain('<script');
    expect(inner).not.toContain('</script');
    expect(inner).toContain('\\u003cscript');

    // 而且转义只是写法变化 —— JSON 解析回来内容一字不差
    expect(() => JSON.parse(inner)).not.toThrow();
    expect(JSON.parse(inner).description).toContain('</script>');
  });
});

/* ------------------------------- 注入 ------------------------------- */

describe('HTML 注入', () => {
  const ctx = { page: null, pages: PAGES, siteUrl: null, coverUrl: null };

  it('替换 <title> 而不是追加（追加会留下两个 title，浏览器取第一个 = 改了没生效）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain(`<title>${seo.homeTitle()}</title>`);
    expect(html).not.toContain('旧标题');
  });

  it('模板里没有 <head> 标签时，用 <body> 之前作锚点（HTML 允许省略 head）', () => {
    expect(PAGE_HTML).not.toContain('<head>');
    const html = seo.applySeo(PAGE_HTML, ctx);
    const bodyIndex = html.indexOf('<body');
    expect(html.indexOf('name="description"')).toBeLessThan(bodyIndex);
    expect(html).toContain('</body>');
  });

  it('有 </head> 时插在它之前', () => {
    const withHead = PAGE_HTML.replace('<body>', '</head>\n  <body>');
    const html = seo.applySeo(withHead, ctx);
    expect(html.indexOf('name="description"')).toBeLessThan(html.indexOf('</head>'));
  });

  it('viewport 按画布宽度生成（本仓固定设计尺寸，不设的话移动端会把画布裁掉两侧）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    expect(html).toContain('<meta name="viewport" content="width=1180" />');
    expect(seo.readCanvasWidth(PAGE_HTML)).toBe(1180);
  });

  it('已有 viewport 时替换而不是叠加', () => {
    const withViewport = PAGE_HTML.replace('<title>', '<meta name="viewport" content="width=device-width" />\n  <title>');
    const html = seo.applySeo(withViewport, ctx);
    expect(html.match(/name="viewport"/g)).toHaveLength(1);
    expect(html).toContain('width=1180');
  });

  it('幂等：注入两次不会叠出两份 meta（标记挡住第二次）', () => {
    const once = seo.applySeo(PAGE_HTML, ctx);
    const twice = seo.applySeo(once, ctx);
    expect(twice).toBe(once);
    expect(twice.match(/name="description"/g)).toHaveLength(1);
  });

  it('文字版：首页列出全部页面的**真实链接**（爬虫靠它发现全站，不依赖 sitemap）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    for (const page of PAGES) {
      expect(html).toContain(`<a href="${page.page}">${page.meta.title}</a>`);
    }
    expect(html).toContain(`class="${seo.SR_ONLY_CLASS}"`);
  });

  it('文字版：游戏页能回到首页，并链到同展区的其它页面', () => {
    const html = seo.applySeo(PAGE_HTML, { ...ctx, page: PAGES[1] });
    expect(html).toContain(`<a href="${seo.SITE.homePath}">`);
    expect(html).toContain(`<a href="${PAGES[0].page}">${PAGES[0].meta.title}</a>`);
  });

  it('文字版的内容与页面数据一致（不是另写一套给爬虫看的文案）', () => {
    const html = seo.applySeo(PAGE_HTML, { ...ctx, page: PAGES[0] });
    // tagline 与每条操作说明都必须原样出现 —— 这是"隐藏文字不算作弊"的前提
    expect(html).toContain(PAGES[0].meta.tagline);
    for (const [keys, action] of PAGES[0].meta.controls) {
      expect(html).toContain(`<dt>${keys}</dt><dd>${action}</dd>`);
    }
  });

  it('文字版样式用 clip 隐藏而**不是** display:none（后者会让屏幕阅读器与部分爬虫跳过）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    const style = html.slice(html.indexOf(`.${seo.SR_ONLY_CLASS}`));
    expect(style).toContain('clip-path: inset(50%)');
    expect(style).not.toContain('display: none');
    // 必须脱离文档流：首页/游戏页的 body 都是 flex，参与布局会把画布挤歪
    expect(style).toContain('position: absolute');
  });

  it('注入可抓取的 favicon 文件链接（data URI 图标搜索引擎不认）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    expect(html).toContain(`href="${seo.FAVICON_PATH}"`);
    expect(seo.FAVICON_SVG).toContain('<svg');
  });

  /**
   * 这条是**确定性**地守住一个 e2e 守不住的问题，所以必须留在单测里。
   *
   * 背景（实测）：把图标链接插到 `</head>` 之前（= head 末尾），Chrome 会在解析到它之前
   * 就认定"这页没有图标"，于是自己去请求 `/favicon.ico` → 404。
   * 而这个失败**e2e 抓不住**：favicon 请求是浏览器层的隐式行为、有竞态，
   * 且 404 会被 Chrome 缓存 —— 同一个位置改回去重跑，用例反而是绿的
   * （我做"门禁敏感度自检"时就是这么发现的）。
   *
   * 所以这里直接断言**产物里的位置关系**：图标链接必须排在 `<title>` 前面。
   * 位置对了，Chrome 就不会走那条隐式请求的路径 —— 与竞态和缓存无关。
   */
  it('站点图标链接必须排在 <title> 之前（排在后面会让 Chrome 去请求 /favicon.ico 并 404）', () => {
    const html = seo.applySeo(PAGE_HTML, ctx);
    const iconAt = html.toLowerCase().indexOf('rel="icon"');
    const titleAt = html.indexOf('<title>');
    // ⚠️ jest 的 `expect` 只收一个参数（`expect(v, '提示')` 是 Playwright 的用法，
    //    jest 会直接抛 `Expect takes at most one argument`）—— 所以说明写注释里。
    //    没找到图标链接时 iconAt = -1，下面第一条就会失败。
    expect(iconAt).toBeGreaterThan(-1);
    // 排在 <title> 之后 = 图标链接出现得太晚，Chrome 会先请求隐式的 /favicon.ico
    expect(iconAt).toBeLessThan(titleAt);

    // 顺带守住 charset 的位置：它必须落在文档前 1024 字节内（图标链接是插在它**之后**的）
    const charsetAt = html.toLowerCase().indexOf('charset');
    expect(charsetAt).toBeGreaterThan(-1);
    expect(charsetAt).toBeLessThan(1024);
  });
});

/* ---------------------------- 站点级资产 ---------------------------- */

describe('robots.txt 与 sitemap.xml', () => {
  it('没配站点根：robots.txt 说明原因，sitemap 不生成（规范要求绝对 URL，不写半截）', () => {
    const robots = seo.buildRobotsTxt(null);
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).not.toContain('Sitemap:');
    expect(robots).toContain('ICE_GAME_SITE_URL');
    expect(seo.buildSitemapXml({ pages: PAGES, siteUrl: null })).toBeNull();
  });

  it('配了站点根：robots 指向 sitemap，sitemap 覆盖首页与全部页面', () => {
    const siteUrl = 'https://example.com/game';
    expect(seo.buildRobotsTxt(siteUrl)).toContain('Sitemap: https://example.com/game/sitemap.xml');
    const xml = seo.buildSitemapXml({ pages: PAGES, siteUrl });
    expect(xml).toContain('<loc>https://example.com/game/index.html</loc>');
    expect(xml).toContain('<loc>https://example.com/game/breakout.html</loc>');
    expect(xml).toContain('<loc>https://example.com/game/arcade.html</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(PAGES.length + 1);
  });
});
