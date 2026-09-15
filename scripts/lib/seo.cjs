/**
 * 页面 SEO 元数据 —— **唯一实现**，被两处共用：
 *
 *  - `webpack.config.js` 的 `SeoPlugin`：给每个产出的 HTML 注入 head/body 片段；
 *  - `tests/seo.test.cjs`：纯函数单测（不依赖 webpack、不依赖浏览器）。
 *
 * ## 要解决的问题：整页内容都在 Canvas 里，爬虫一个字都读不到
 *
 * 本仓所有页面都是**整屏画布应用**：文字是 `fillText` 画上去的像素，DOM 里只有一个
 * `<canvas>`。后果有两层，而它们的修法是同一个：
 *
 * | 读者 | 现状 | 本模块给它什么 |
 * |---|---|---|
 * | 搜索引擎爬虫 | 页面像是"空壳"，读不到标题/说明/链接，也无法顺着链接发现其它页面 | `<title>` / `<meta>` / JSON-LD / **语义化的文字版 + 真实 `<a>` 链接** |
 * | 屏幕阅读器 | 同样只看到一个 canvas，无法导航 | 同一份文字版 |
 *
 * ## ⚠️ 关于"隐藏文字"：这不是黑帽 SEO，别改成那样
 *
 * 搜索引擎惩罚的是**隐藏与可见内容不一致的文字**（`display:none` 里塞关键词堆砌）。
 * 这里的文字版：
 *
 *  1. **与画布上画的内容完全一致** —— 同一份 `meta.json` / 目录数据生成，
 *     连操作说明都是从 `controls` 逐条来的（不存在"只给爬虫看的内容"）；
 *  2. 用 `.ice-seo-sr`（clip-path + 1px）隐藏而不是 `display:none` —— 这正是
 *     Bootstrap `.visually-hidden` 那套无障碍标准做法，屏幕阅读器照常读；
 *  3. 里面的链接是**真能点的**（也因此在键盘 Tab 顺序里）——
 *     对纯 canvas 应用这是净增益：原先键盘用户没有任何可达的入口。
 *
 * 所以要改这段内容时，**先改画布**，再让它跟着变；不要为了关键词往里加画布上没有的东西。
 *
 * ## ⚠️ 站点地址：没有就不写，绝不编
 *
 * `canonical` / `og:url` / `og:image` / `sitemap.xml` 都要求**绝对 URL**，
 * 而本仓 `ice-game` 目前**没有 GitHub 远端、也没有域名**。所以：
 *
 *  - 配了 `ICE_GAME_SITE_URL` → 全都有（含 sitemap.xml）；
 *  - 没配 → **省略这几个字段、不生成 sitemap.xml**，并在构建输出里提示一句。
 *
 * 宁可少几个字段，也不写一个假的域名 —— 页脚挂 404 比不挂更糟（同 AGENTS 铁律 10）。
 * 爬虫发现页面的主路径本来就是**首页里的链接**，那条不依赖域名。
 */
const SR_ONLY_CLASS = 'ice-seo-sr';

/**
 * 注入标记：head 片段的第一行。
 *
 * 用途有两个，都是"以后不会踩坑"的保险：
 *  1. **幂等** —— `applySeo` 开头检查它，已经注入过就直接返回（重复调用会叠出两份 meta）；
 *  2. **自解释** —— 产物是 minify 过的，唯有这段格式化注释能让人看出"这段是生成的，
 *     要改去改 `scripts/lib/seo.cjs`"，而不是手改 dist。
 */
const SEO_MARKER = '<!-- ice-seo:injected -->';

/**
 * 站点图标的**文件**路径。
 *
 * 页面里本来已经有一个内联的 `data:image/svg+xml` 图标（用于避免 `/favicon.ico` 404），
 * 但**搜索引擎不认 data URI** —— Google 要求 favicon 是一个可抓取的 URL。
 * 所以额外产出一个真实文件，并注入 `<link rel="icon">` 指向它。
 * 内联那个保留（浏览器仍可用它，且 404 防线不动）。
 */
const FAVICON_PATH = 'favicon.svg';

/** 站点图标内容（与页面里内联的那个同形：一块冰 / 等距 3D 冰块，自绘 CC0）。 */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="22 22 84 84">
  <path d="M79 44 L79 98 L101 82 L101 28 Z" fill="#79d0ec" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
  <path d="M27 44 L79 44 L79 98 L27 98 Z" fill="#a6e3f5" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
  <path d="M27 44 L79 44 L101 28 L49 28 Z" fill="#e6fbff" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
</svg>
`;

/** 站点级常量。品牌名与主题色与画布上画的一致（`src/home/`）。 */
const SITE = {
  /** 站点名 —— 搜索结果里显示的品牌名，也是 JSON-LD 的 `name`。 */
  name: '画布游戏厅',
  /** 英文别名（`og:site_name` 与 JSON-LD 的 `alternateName`）。 */
  nameEn: 'ICE Game',
  author: '大漠穷秋',
  license: 'MIT',
  lang: 'zh-CN',
  /** 移动端状态栏 / 地址栏主题色，与页面底色（`#080a0f`）一致。 */
  themeColor: '#080a0f',
  /** 首页文件名（相对路径，与 webpack `publicPath: ''` 的约定一致）。 */
  homePath: 'index.html',
  /**
   * 首页自身的一句话定位（写死在代码里而不是从目录推 —— 它描述的是"这个站是什么"，
   * 不是任何一个页面）。页面级描述才是从目录动态生成的。
   */
  tagline: '用 ICE 家族的渲染引擎与画布控件做的单页小游戏合集',
};

/**
 * 兜底画布宽度（读不到 `<canvas width>` 时用）。
 *
 * 正常情况下视口按**每个页面自己的画布宽度**设（`readCanvasWidth`）——
 * 本仓的画布宽度并不统一（小游戏与首页是 1180，Windows XP 桌面是 1440×900），
 * 写死一个值会让其中一个页面的移动端初始视口与画布不匹配。
 */
const DEFAULT_CANVAS_WIDTH = 1180;

/* ================================ 文本工具 ================================ */

/** HTML 转义（`&` 必须先替换，否则后面的实体会被二次转义）。 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 压掉换行与连续空白（`meta` 的 content 里不该有换行）。 */
function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 按**显示长度**截断（中日韩字符计 2，其它计 1）。
 *
 * `meta description` 在搜索结果里会被截断显示，主动截到长度上限可以避免
 * "被搜索引擎随机切在半个词上"。用显示宽度而不是字符数：中文的显示宽度是英文的两倍。
 */
function truncateDisplay(value, maxWidth) {
  const text = normalize(value);
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 2 : 1;
    if (width + w > maxWidth) return `${out.replace(/[、，,。.\s]+$/, '')}…`;
    width += w;
    out += ch;
  }
  return out;
}

/** 去重并保持原顺序（关键词重复对搜索没有增益，只会显得堆砌）。 */
function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = normalize(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * 关键词条数上限。
 *
 * 这条 meta 的作用被高估很久了：**Google 明确忽略它**，百度官方也说它对排名没有影响。
 * 留着是因为它是 TDK 惯例的一部分、成本为零，而且某些**站内搜索/聚合站**仍会读它。
 *
 * 既然几乎不影响排名，**堆砌就只剩坏处**（观感差、且一旦真有搜索引擎惩罚堆砌就是白挨）。
 * 所以给一个硬上限，并把最相关的排在最前 —— 具体游戏名是长尾词，比"网页小游戏"这种
 * 大词更容易带来真实流量，所以它们排在通用词**前面**。
 */
const KEYWORD_LIMIT = { home: 16, page: 12 };

/** 去重 → 截到上限 → 拼成 meta content。 */
function toKeywords(words, limit) {
  return unique(words).slice(0, limit).join(',');
}

/** 取一页的 URL（相对路径；有站点根时由调用方拼成绝对地址）。 */
function pageHref(page) {
  return page && page.page ? page.page : SITE.homePath;
}

/**
 * 拼一个可用的**绝对地址**；没有站点根就返回 `null`。
 *
 * `base` 可以带子目录（如 `https://example.com/ice-game`），拼接时会归一化斜杠。
 */
function absoluteUrl(base, relative) {
  if (!base) return null;
  const root = String(base).replace(/\/+$/, '');
  const tail = String(relative ?? '').replace(/^\/+/, '');
  return tail ? `${root}/${tail}` : root;
}

/* ============================== 每页的 TDK ============================== */

/**
 * 把页面清单压成一行可读的列举（超过 `max` 个就折叠成"等 N 个页面"）。
 *
 * 首页描述要列游戏名（那是关键词来源），但不能因为有 30 个游戏就让描述长到被截断。
 */
function enumerateTitles(pages, max = 6) {
  const titles = pages.map((page) => normalize(page.meta.title));
  if (titles.length <= max) return titles.join('、');
  return `${titles.slice(0, max).join('、')} 等 ${titles.length} 个页面`;
}

/** 首页 `<title>`。品牌名在前，后缀说明站点性质。 */
function homeTitle() {
  return `${SITE.name} — ICE 家族的 Canvas 单页小游戏合集`;
}

/** 首页 `<meta name="description">`：从目录动态列举，加了游戏自动跟着变。 */
function homeDescription(pages) {
  const list = enumerateTitles(pages);
  return truncateDisplay(
    `${SITE.name}：${SITE.tagline} —— ${list}。浏览器打开即玩，无需服务端、无需安装。`,
    150,
  );
}

/** 首页 `<meta name="keywords">`。顺序 = 相关度从高到低（见 `KEYWORD_LIMIT` 的说明）。 */
function homeKeywords(pages) {
  return toKeywords(
    [
      SITE.name,
      SITE.nameEn,
      // 具体页面名（长尾词，最有价值）排在通用大词前面
      ...pages.map((page) => page.meta.title),
      ...pages.flatMap((page) => page.meta.features),
      'Canvas 小游戏',
      '网页小游戏',
      '在线小游戏',
      'HTML5 游戏',
      '免安装小游戏',
      'ice-render',
    ],
    KEYWORD_LIMIT.home,
  );
}

/** 游戏页 `<title>`：**页面名在前**（那是用户搜索的那个词），品牌名在后。 */
function pageTitle(page) {
  return `${page.meta.title} — ${SITE.name} | ${SITE.nameEn}`;
}

/** 游戏页 `<meta name="description">`。 */
function pageDescription(page) {
  const controls = page.meta.controls.map(([keys]) => keys).join(' / ');
  const how = controls ? `支持键盘操作（${controls}）` : '支持键盘操作';
  const isMachine = page.meta.kind === 'machine';
  const kind = isMachine ? '整机模拟' : '小游戏';
  return truncateDisplay(
    `${page.meta.title}：${page.meta.tagline}。${SITE.name}里的${kind}，${how}，浏览器打开即玩，无需服务端、无需安装。`,
    150,
  );
}

/** 游戏页 `<meta name="keywords">`。 */
function pageKeywords(page, pages) {
  const isMachine = page.meta.kind === 'machine';
  return toKeywords(
    [
      page.meta.title,
      ...page.meta.features,
      ...(isMachine ? ['浏览器模拟器', '在线模拟器', '免安装模拟器'] : []),
      'Canvas 小游戏',
      '在线小游戏',
      '网页小游戏',
      '免安装',
      // 同展区的其它页面名：帮"同类还玩了什么"这类查询，也顺带体现站内主题聚合
      ...(pages || []).filter((other) => other.slug !== page.slug && other.kind === page.kind).map((other) => other.meta.title),
      SITE.name,
      SITE.nameEn,
      'ice-render',
    ],
    KEYWORD_LIMIT.page,
  );
}

/* ============================== HTML 片段 ============================== */

/**
 * `.ice-seo-sr` 的样式：**视觉隐藏但对屏幕阅读器与爬虫可见**。
 *
 * 用 `clip-path: inset(50%)`（现代）+ `clip: rect(0 0 0 0)`（兼容）而不是
 * `display: none` / `visibility: hidden` —— 后两者会让辅助技术与部分爬虫直接跳过它，
 * 那这段文字版就白写了。
 *
 * `position: absolute` 还有一个必须的作用：**脱离文档流**。
 * 首页 body 是 flex 列布局、游戏页是 flex 居中，文字版如果参与布局会把画布挤歪。
 */
const SR_ONLY_CSS = `
    /*
      ${SR_ONLY_CLASS}：给搜索引擎与屏幕阅读器读的「文字版」。
      canvas 里的内容两者都读不到（前者没有 DOM 文本，后者只有一块画布）。

      内容与画布上显示的**完全一致**（同一份 meta.json / 目录数据），所以这不是
      隐藏关键词，而是同一份内容的可访问替代表示 —— 改文字版之前请先改画布。
      用 clip 隐藏而不用 display:none：后者会让屏幕阅读器与部分爬虫跳过它。
      详见 scripts/lib/seo.cjs 顶部说明。
    */
    .${SR_ONLY_CLASS} {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }`;

/**
 * head 片段：TDK + Open Graph + Twitter Card + 可选 canonical + 文字版样式 + JSON-LD。
 *
 * 只在有站点根时写 `canonical` / `og:url` / `og:image`（三者都要求绝对 URL）——
 * 见文件头"站点地址"那段。
 */
function buildHeadFragment({ page, pages, siteUrl, coverUrl }) {
  const isHome = !page;
  const title = isHome ? homeTitle() : pageTitle(page);
  const description = isHome ? homeDescription(pages) : pageDescription(page);
  const keywords = isHome ? homeKeywords(pages) : pageKeywords(page, pages);
  const self = isHome ? SITE.homePath : pageHref(page);
  const canonical = absoluteUrl(siteUrl, self);
  const ogImage = coverUrl && siteUrl ? absoluteUrl(siteUrl, coverUrl) : null;

  const lines = [
    `    ${SEO_MARKER}`,
    `    <!-- 以下 SEO 元数据由 scripts/lib/seo.cjs 统一注入（改文案改那里，别手改产物） -->`,
    `    <meta name="description" content="${escapeHtml(description)}" />`,
    `    <meta name="keywords" content="${escapeHtml(keywords)}" />`,
    `    <meta name="author" content="${escapeHtml(SITE.author)}" />`,
    // keywords 已被 Google 忽略（百度也只剩很弱的参考），但它是 TDK 的惯例组成部分，
    // 且成本为零 —— 保留，只是别指望它。真正起作用的是 title / description / 结构化数据。
    `    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />`,
    `    <meta name="theme-color" content="${SITE.themeColor}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="${escapeHtml(`${SITE.name} ${SITE.nameEn}`)}" />`,
    `    <meta property="og:title" content="${escapeHtml(title)}" />`,
    `    <meta property="og:description" content="${escapeHtml(description)}" />`,
    `    <meta property="og:locale" content="zh_CN" />`,
    `    <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
    `    <meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `    <meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ];

  if (canonical) lines.push(`    <link rel="canonical" href="${escapeHtml(canonical)}" />`);
  if (canonical) lines.push(`    <meta property="og:url" content="${escapeHtml(canonical)}" />`);
  if (ogImage) {
    lines.push(`    <meta property="og:image" content="${escapeHtml(ogImage)}" />`);
    lines.push(`    <meta property="og:image:alt" content="${escapeHtml(`${title} 界面截图`)}" />`);
    lines.push(`    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />`);
  }

  lines.push(`    <style>${SR_ONLY_CSS}\n    </style>`);
  lines.push(`    <script type="application/ld+json">\n${indent(jsonLdJson({ page, pages, siteUrl }), 6)}\n    </script>`);

  return lines.join('\n');
}

/**
 * JSON-LD 结构化数据。
 *
 * 首页给 `WebSite` + `ItemList`（Google 据此理解"这是一个游戏合集，下面有这些页面"）；
 * 游戏页给 `VideoGame`（比笼统的 `SoftwareApplication` 更贴切，且是 Google 认的类型）。
 *
 * `offers` 写 0 元（本仓确实免费）——Google 会据此标"免费"。
 */
function buildJsonLd({ page, pages, siteUrl }) {
  const author = { '@type': 'Person', name: SITE.author };
  const siteRef = {
    '@type': 'WebSite',
    name: SITE.name,
    alternateName: SITE.nameEn,
    inLanguage: SITE.lang,
    ...(absoluteUrl(siteUrl, SITE.homePath) ? { url: absoluteUrl(siteUrl, SITE.homePath) } : {}),
  };

  if (page) {
    return {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: page.meta.title,
      description: pageDescription(page),
      ...(absoluteUrl(siteUrl, pageHref(page)) ? { url: absoluteUrl(siteUrl, pageHref(page)) } : {}),
      ...(absoluteUrl(siteUrl, SITE.homePath) ? { image: absoluteUrl(siteUrl, `covers/${page.slug}.png`) } : {}),
      genre: page.meta.kind === 'machine' ? '模拟器' : '街机',
      gamePlatform: 'Web browser',
      playMode: 'SinglePlayer',
      applicationCategory: 'Game',
      operatingSystem: '支持 Canvas 2D 的现代浏览器',
      inLanguage: SITE.lang,
      author,
      isPartOf: siteRef,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
      ...(page.meta.controls.length
        ? {
            // 操作说明放进结构化数据：搜索结果可能把"怎么玩"一并展示出来
            gameTip: page.meta.controls.map(([keys, action]) => `${keys}：${action}`).join('；'),
          }
        : {}),
    };
  }

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${SITE.name}收录的全部页面`,
    numberOfItems: pages.length,
    itemListElement: pages.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.meta.title,
      description: item.meta.tagline,
      ...(absoluteUrl(siteUrl, pageHref(item)) ? { url: absoluteUrl(siteUrl, pageHref(item)) } : {}),
    })),
  };

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      ...siteRef,
      description: homeDescription(pages),
      author,
      license: 'https://opensource.org/licenses/MIT',
      isFamilyFriendly: true,
    },
    itemList,
  ];
}

/**
 * 把 JSON-LD 序列化成可嵌进 `<script>` 的文本。
 *
 * `JSON.stringify` 之后再转义 `<`：内容里一旦出现 `</script>`（哪怕是游戏描述里的
 * 字符串），浏览器会**提前结束 script 标签**，页面直接坏掉。转成 `\u003c` 在 JSON 里
 * 是完全等价的写法。
 */
function jsonLdJson(input) {
  return JSON.stringify(buildJsonLd(input), null, 2).replace(/</g, '\\u003c');
}

/** 按给定缩进给多行文本加前缀。 */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

/**
 * body 里的**文字版**：与画布内容一致的可读结构 + **真实可点的链接**。
 *
 * 链接是这里最有价值的部分 —— 首页列出全部页面，任何一页又能回到首页与同组页面，
 * 于是**爬虫从任意一个入口都能爬到全站**（不依赖 sitemap，也就不依赖域名）。
 */
function buildMirrorFragment({ page, pages }) {
  const groups = [
    { kind: 'game', label: '小游戏', items: pages.filter((item) => item.kind === 'game') },
    { kind: 'machine', label: '整机展厅', items: pages.filter((item) => item.kind === 'machine') },
  ].filter((group) => group.items.length > 0);

  /** 一个页面的 `<li>`（标题做成链接，后面跟说明）。 */
  const item = (target) =>
    `          <li><a href="${escapeHtml(pageHref(target))}">${escapeHtml(target.meta.title)}</a>` +
    ` —— ${escapeHtml(target.meta.tagline)}</li>`;

  const blocks = [];

  if (page) {
    /* ---------------------------- 游戏页 ---------------------------- */
    const siblings = groups.find((group) => group.kind === page.kind);
    blocks.push(
      `      <p><a href="${escapeHtml(SITE.homePath)}">← 返回${escapeHtml(SITE.name)}</a></p>`,
      `      <h1>${escapeHtml(page.meta.title)}</h1>`,
      `      <p>${escapeHtml(page.meta.tagline)}</p>`,
    );
    if (page.meta.controls.length) {
      blocks.push(
        '      <h2>怎么玩</h2>',
        '      <dl>',
        ...page.meta.controls.map(([keys, action]) => `        <dt>${escapeHtml(keys)}</dt><dd>${escapeHtml(action)}</dd>`),
        '      </dl>',
      );
    }
    if (page.meta.features.length) {
      blocks.push(
        `      <h2>${page.meta.kind === 'machine' ? '内含程序' : '内容'}</h2>`,
        '      <ul>',
        ...page.meta.features.map((feature) => `        <li>${escapeHtml(feature)}</li>`),
        '      </ul>',
      );
    }
    /*
     * 站内其它页面：**同展区在前，其它展区在后**。
     *
     * 为什么连其它展区也要链（而不是只链同展区）：内链是爬虫发现页面的基础设施。
     * 只链同展区的话，`breakout.html`（游戏组里唯一的页面）就**一条站内链接都没有**，
     * 从它出发爬不到两台整机 —— 链接图不连通，而这个洞只在"某一组只有一个页面"时出现，
     * 很容易漏（本仓的测试就是先按"只有同展区"写的，跑出来才发现）。
     */
    const sameGroup = (siblings ? siblings.items : []).filter((other) => other.slug !== page.slug);
    const otherGroups = groups.filter((group) => group.kind !== page.kind).flatMap((group) => group.items);
    const others = [...sameGroup, ...otherGroups];
    if (others.length) {
      blocks.push(`      <h2>站内其它页面</h2>`, '      <ul>', ...others.map(item), '      </ul>');
    }
  } else {
    /* ----------------------------- 首页 ----------------------------- */
    blocks.push(
      `      <h1>${escapeHtml(SITE.name)} —— ${escapeHtml(SITE.tagline)}</h1>`,
      `      <p>${escapeHtml(homeDescription(pages))}</p>`,
    );
    for (const group of groups) {
      blocks.push(`      <h2>${escapeHtml(group.label)}</h2>`, '      <ul>', ...group.items.map(item), '      </ul>');
    }
    blocks.push(
      '      <h2>技术栈</h2>',
      '      <p>页面与控件全部由 ICE 家族在 HTML5 Canvas 上绘制，画面里没有任何位图资源。</p>',
      '      <ul>',
      '        <li>ice-render：Canvas 2D 渲染引擎（家族的地基）</li>',
      '        <li>ice-web-components：画布原生 UI 控件库</li>',
      '        <li>@damoqiongqiu/ice-chart：交互式图表库</li>',
      '      </ul>',
      `      <p>源码与文档：<a href="https://github.com/ice-render">github.com/ice-render</a></p>`,
    );
  }

  return [
    `    <!-- 文字版（视觉隐藏，屏幕阅读器与搜索引擎可见）：内容与 canvas 上显示的一致，`,
    `         由 scripts/lib/seo.cjs 从同一份 meta.json / 目录数据生成。改内容请改画布。 -->`,
    `    <div class="${SR_ONLY_CLASS}" role="region" aria-label="${escapeHtml(
      page ? `${page.meta.title}（文字版）` : `${SITE.name}页面导航（文字版）`,
    )}">`,
    ...blocks,
    '    </div>',
  ].join('\n');
}

/* ============================== 站点级资产 ============================== */

/** `robots.txt`：允许全站抓取；配了站点根才带 sitemap 行。 */
function buildRobotsTxt(siteUrl) {
  const lines = ['User-agent: *', 'Allow: /', ''];
  const sitemap = absoluteUrl(siteUrl, 'sitemap.xml');
  if (sitemap) {
    lines.push(`Sitemap: ${sitemap}`, '');
  } else {
    // 说清楚"为什么这里没有 Sitemap 行"：不是漏了，而是还没有站点根。
    lines.push('# 本站尚未配置对外域名，因此未生成 sitemap.xml。');
    lines.push('# 配置 ICE_GAME_SITE_URL 后重新构建即可（见 README 的 SEO 一节）。');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * `sitemap.xml`。**只在有站点根时生成** —— sitemap 规范要求 `<loc>` 是绝对 URL，
 * 而本仓目前没有域名，写相对路径会被搜索引擎判为无效文件。
 */
function buildSitemapXml({ pages, siteUrl }) {
  const home = absoluteUrl(siteUrl, SITE.homePath);
  if (!home) return null;
  const urls = [home, ...pages.map((page) => absoluteUrl(siteUrl, pageHref(page)))];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url>\n    <loc>${escapeHtml(url)}</loc>\n  </url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/* ================================ 注入 ================================ */

/**
 * 从 HTML 里读画布宽度（用于设移动端视口）。
 *
 * 本仓所有页面都是固定设计尺寸，视口按画布宽设才不会有横向滚动；
 * 而画布宽度是页面自己声明的（`<canvas width="1180">`），所以从 HTML 里读，
 * 不在 SEO 模块里再写一份（那样加一个非 1180 宽的页面就会错）。
 */
function readCanvasWidth(html) {
  const match = /<canvas[^>]*\bwidth\s*=\s*["']?(\d+)/i.exec(html);
  return match ? Number(match[1]) : null;
}

/**
 * 往 HTML 里插入 head 片段。
 *
 * ⚠️ 不能用"在 `</head>` 前插入"这一种写法：本仓的模板（`src/templates/page.html`、
 * 两个 ported 页）都**没有显式的 `<head>` 标签**（HTML 允许省略，解析器会自动补），
 * 于是 `</head>` 在源文本里不存在。兜底锚点是 `<body>` 之前 —— 那在解析语义上
 * 仍然是 head 的内容。
 */
function injectHead(html, snippet) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n  </head>`);
  const body = /<body[\s>]/i.exec(html);
  if (!body) throw new Error('注入 SEO 失败：既没有 </head>，也找不到 <body>');
  return `${html.slice(0, body.index)}${snippet}\n\n  ${html.slice(body.index)}`;
}

/**
 * 往 head 的**最前面**插入内容（图标链接专用 —— 尽早出现很重要，见 `applySeo` 的说明）。
 *
 * 锚点依次退化：`<head>` 开标签 → `<meta charset>` 之后 → `<html>` 开标签之后。
 * 本仓的模板都写的是隐式 head（没有 `<head>`），所以实际走第二条；
 * 而把内容插在 `charset` **之后**还有个必须的理由：`charset` 必须落在文档前 1024 字节内。
 */
function injectHeadTop(html, snippet) {
  const anchors = [/<head[^>]*>/i, /<meta[^>]+charset[^>]*>/i, /<html[^>]*>/i];
  for (const pattern of anchors) {
    const match = pattern.exec(html);
    if (!match) continue;
    const at = match.index + match[0].length;
    return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`;
  }
  return `${snippet}\n${html}`;
}

/**
 * 往 HTML 里插入 body 片段（锚点 `</body>`，没有就追加到末尾）。
 */
function injectBody(html, snippet) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n  </body>`);
  return `${html}\n${snippet}\n`;
}

/**
 * 给一个产出的 HTML 施加全部 SEO 改动，返回新的 HTML。
 *
 * 四步（顺序无关，但都作用在同一份字符串上）：
 *  1. 换 `<title>`（模板里那个只有页面名，缺品牌后缀与关键词）；
 *  2. 补 `<meta name="viewport">`（原来一个都没有，移动端会把画布裁掉两侧）；
 *  3. head 片段（TDK / OG / canonical / JSON-LD / 隐藏样式）；
 *  4. body 文字版。
 *
 * @param {string} html 已由 html-webpack-plugin 产出的 HTML
 * @param {{ page: any|null, pages: any[], siteUrl: string|null, coverUrl?: string|null }} ctx
 *        `page` 为 `null` 表示首页
 */
function applySeo(html, ctx) {
  const { page, pages, siteUrl, coverUrl = null } = ctx;
  const title = page ? pageTitle(page) : homeTitle();

  /*
   * 幂等保护：已经注入过就原样返回。
   *
   * 正常流程下每个产物只会被注入一次（html-webpack-plugin 每次都从模板重新生成），
   * 但 `applySeo` 是个公开的纯函数 —— 被调用两次会叠出两份 `meta`（浏览器取第一个，
   * 于是"改了没生效"，而且从产物上看不出原因）。一条标记就把这类事故挡在门外。
   */
  if (html.includes(SEO_MARKER)) return html;

  let out = html;

  /*
   * ① 站点图标链接 —— 必须插在 head 的**最前面**。这条是踩出来的：
   *
   * Chrome 有个**隐式行为**：只要它在解析到 `<link rel="icon">` 之前就认定"这页没有图标"，
   * 就会自己去请求 `/favicon.ico`。而 favicon 是**浏览器层**发起的请求，
   * **不经过页面的网络栈** —— `page.on('response')` 收不到它，只在控制台留下一条
   * 不含 URL 的 `Failed to load resource … 404`（实测确认：URL 就是 /favicon.ico）。
   *
   * 实测：把图标链接跟着其它 meta 一起插到 `</head>` 之前（= head 末尾），
   * 首页与所有游戏页立刻都多出一条 /favicon.ico 404；插到 `<meta charset>` 之后
   * 就再没出现过（由 e2e 的"无 console error"守着）。
   *
   * 模板里原有的那个**内联 data URI 图标不动**：它是有价值的兜底（万一 favicon.svg
   * 没加载上，标签页图标仍然有，同样能挡住隐式的 /favicon.ico 请求）。
   * 但**搜索引擎不认 data URI** —— 它要求图标是可抓取的 URL，所以必须再给一个**文件**。
   */
  out = injectHeadTop(out, `    <link rel="icon" type="image/svg+xml" href="${FAVICON_PATH}" />`);

  /* ② <title>：替换而不是追加 —— 追加会留下两个 title（浏览器取第一个，等于没改） */
  if (/<title>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  } else {
    out = injectHead(out, `    <title>${escapeHtml(title)}</title>`);
  }

  /* ③ viewport：按**这个页面自己的画布宽度**设（已经有就替换，模板将来加了也不会重复） */
  const viewport = `width=${readCanvasWidth(out) || DEFAULT_CANVAS_WIDTH}`;
  if (/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i, `<meta name="viewport" content="${viewport}" />`);
  } else {
    out = injectHead(out, `    <meta name="viewport" content="${viewport}" />`);
  }

  /* ④ head 片段 */
  out = injectHead(out, buildHeadFragment({ page, pages, siteUrl, coverUrl }));

  /* ⑤ body 文字版 */
  out = injectBody(out, buildMirrorFragment({ page, pages }));

  return out;
}

module.exports = {
  SITE,
  SR_ONLY_CLASS,
  SEO_MARKER,
  FAVICON_PATH,
  FAVICON_SVG,
  DEFAULT_CANVAS_WIDTH,
  escapeHtml,
  normalize,
  truncateDisplay,
  unique,
  absoluteUrl,
  enumerateTitles,
  homeTitle,
  homeDescription,
  homeKeywords,
  pageTitle,
  pageDescription,
  pageKeywords,
  buildHeadFragment,
  buildMirrorFragment,
  buildJsonLd,
  buildRobotsTxt,
  buildSitemapXml,
  readCanvasWidth,
  applySeo,
};
