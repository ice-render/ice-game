const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { buildMarkers, collectCopies, findDuplicates, describeDuplicates } = require('./scripts/lib/family-guard.cjs');
const { scanAll } = require('./scripts/lib/scan-games.cjs');
const { applySeo, buildRobotsTxt, buildSitemapXml, FAVICON_PATH, FAVICON_SVG } = require('./scripts/lib/seo.cjs');

const WORKSPACE = path.resolve(__dirname, '..');

/**
 * ICE 家族各仓是**并列的兄弟目录**，不是一个 monorepo。
 *
 * 每个包的 `node_modules` 里还各自躺着一份自己装的 `ice-render`
 * （实测：ice-web-components 带 2.10.0、ice-chart 带 2.10.1、ice-entity-designer 带 2.10.1），
 * 直接用 node 的解析规则打包会解析出**多份引擎实例** —— 引擎的类身份
 * （`typeId` 注册表、`instanceof`、事件总线）就会错位，表现是
 * 「组件画不出来 / 跨库拿不到同一个 ICE」。
 *
 * 所以把每个包**都** alias 到同级仓库目录，强制整个工程只有一份 `ice-render`。
 * 三件套缺一不可：漏掉谁，谁就会把自己 `node_modules` 里那份引擎拖进来。
 * 副作用是好的：改完兄弟仓库 `npm run build` 一下，本工程立刻吃到新产物。
 *
 * ⚠️ 依赖声明是 `file:../<repo>`（npm 装成软链），但**别只靠它**：
 * `file:` 只决定"包本身从哪来"，包**内部** import 的 `ice-render` 仍按 node 规则从它自己的
 * `node_modules` 解析。alias 才是那份保险。
 * 注意 `@damoqiongqiu/ice-chart` 的**包名带 scope**，key 必须写完整包名。
 *
 * 🔒 这条约定由本文件的 `SingleEnginePlugin`（见文件尾部）在每次构建时断言：
 * 同一个家族包出现两份不同的模块资源，构建**直接失败**（而不是上线后画面空白）。
 */
const family = {
  'ice-render': path.resolve(WORKSPACE, 'ice-render'),
  '@damoqiongqiu/ice-chart': path.resolve(WORKSPACE, 'ice-chart'),
  'ice-web-components': path.resolve(WORKSPACE, 'ice-web-components'),
};

/**
 * **本工程依赖的家族包名单** —— 从 `package.json` 的 dependencies 推导，**不从 `family` 推**。
 *
 * 两份名单的区别很关键：「哪些包必须只有一份产物」是**意图**（写在 package.json 里），
 * 与"实际配了哪些 alias"是两回事。
 *
 * 第一版把这里写成 `Object.keys(family)`，结果是：删掉某条 alias 时，插件**连守护那个包
 * 这件事也一起停掉了** —— 正好漏掉它唯一该抓的那类错误（实测漏判三份引擎，
 * 产物 1010 KiB → 1.49 MiB，构建却"成功"）。
 *
 * 现在名单从 package.json 来，于是**加新依赖时不需要人记得改这里**：
 * 新加的家族包一进 dependencies 就自动被守护，且下面的自检会逼你补 alias。
 * 认家族包按命名约定（`ice-*` / `@damoqiongqiu/*`），普通第三方依赖不纳入。
 */
const pkg = require('./package.json');
const GUARDED_PACKAGES = Object.keys(pkg.dependencies || {}).filter(
  (name) => name.startsWith('ice-') || name.startsWith('@damoqiongqiu/'),
);

/** 反向自检：`family` 里不该有 dependencies 里没有的包（避免 alias 一堆用不上的东西）。 */
const extraAliases = Object.keys(family).filter((key) => !GUARDED_PACKAGES.includes(key));

// 配置自检：名单里的每个包都必须有 alias —— 否则它内部会去自己的 node_modules 找引擎。
// 放在配置加载期抛错（比构建到一半才发现早，也比"静默多打一份引擎"早）。
for (const key of GUARDED_PACKAGES) {
  if (!family[key]) {
    throw new Error(
      `webpack.config.js：package.json 依赖里有 ${key}，但 resolve.alias 缺了它 —— ` +
        `它内部 import 的 ice-render 会解析到它自己 node_modules 里的那份，打出多份引擎。`,
    );
  }
}
if (extraAliases.length) {
  throw new Error(
    `webpack.config.js：resolve.alias 里的 ${extraAliases.join('、')} 不在 package.json 的 dependencies 里。` +
      `要么补依赖，要么删掉这条 alias —— 两边保持一致，否则"守护名单"和"实际打包的东西"会各说各话。`,
  );
}

/**
 * 每个守护包的路径标记。除了包名形态，还含 **alias 目标目录的 basename** ——
 * 带 scope 的包（`@damoqiongqiu/ice-chart`）经 alias 解析后路径里没有 scope 那一层，
 * 只按包名匹配会永远看不到它。详见 `scripts/lib/family-guard.cjs`。
 */
const FAMILY_MARKERS = buildMarkers(GUARDED_PACKAGES, family);

/**
 * 构建期断言「每个家族包只进来一份产物」。
 *
 * 多份引擎是最贵的一类 bug：不报错、不崩，只是组件静默画不出来 / 事件收不到，
 * 而且只在"某个页面同时用了两个家族包"时才暴露。放在构建期断言，零额外成本
 * （复用本次构建的模块图，不额外跑一遍 webpack）。
 *
 * 判据本身在 `scripts/lib/family-guard.cjs`（与 `scripts/check-wiring.cjs` 共用一份）——
 * 那条判据踩过两个"看起来在工作、其实是空门"的坑，注释都记在那个文件里：
 *   ① 用 `indexOf` 定位包目录会被本工程的路径名（工作区叫 `ice-render`）骗到；
 *   ② 只按包名匹配，会永远看不到带 scope 的包（`@damoqiongqiu/ice-chart`）经 alias 进来的那份。
 *
 * ⚠️ 断言必须挂在 `finishModules` 而**不能挂在 `done`**：`done` 触发时 stats 已经生成，
 * 此时往 `compilation.errors` 里 push 完**不会有任何输出** —— 这个门禁会静默变成摆设
 * （第一版就是这么写的，实测漏判了三份引擎）。
 *
 * 结果同时挂在 `compilation.__iceFamilyCopies` 上，供 `scripts/check-wiring.cjs` 打印。
 */
class SingleEnginePlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('SingleEnginePlugin', (compilation) => {
      compilation.hooks.finishModules.tap('SingleEnginePlugin', (modules) => {
        const copies = collectCopies(modules, FAMILY_MARKERS);
        // 给外部脚本读（check-wiring 用它打印"每个包实际进来几条"）
        compilation.__iceFamilyCopies = copies;

        const dupes = findDuplicates(copies);
        if (dupes.length === 0) return;

        compilation.errors.push(
          new compiler.webpack.WebpackError(
            `检测到家族包被打了多份产物 —— 同一个包里会出现多个 ICE 实例（组件静默画不出来）：\n` +
              `${describeDuplicates(dupes)}\n` +
              `修法：确认 webpack.config.js 的 resolve.alias 里有这个包，见该文件里的 family 说明。`,
          ),
        );
      });
    });
  }
}

/**
 * 把首页的卡片封面（`src/home/covers/*.png`）原样拷进 `dist/covers/`。
 *
 * 为什么不走 `import cover from './covers/x.png'`（asset modules）：
 * 那样**每加一个游戏都得改 import 列表**，正好破坏了本仓"目录驱动、加游戏不改配置"的约定。
 * 封面是"有就用、没有就退回占位块"的可选资源，用**稳定路径**（`covers/<slug>.png`）加载最简单：
 * - 首页按 `src/domain/catalog.generated.json` 里的 `cover` 标记决定加载还是占位；
 * - 那个标记由 `gen-catalog` 检查文件是否存在得出（构建前置自动跑），所以不会有"标记说有、文件没有"。
 * 顺带：不经 webpack 处理就没有 contenthash，但封面本来就不需要缓存失效策略（本地演示站）。
 */
class CopyCoversPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CopyCoversPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'CopyCoversPlugin', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          const dir = path.join(__dirname, 'src', 'home', 'covers');
          if (!fs.existsSync(dir)) return;
          for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith('.png')) continue;
            compilation.emitAsset(`covers/${name}`, new compiler.webpack.sources.RawSource(fs.readFileSync(path.join(dir, name))));
          }
        },
      );
    });
  }
}

/**
 * 给每个产出的 HTML 注入 SEO 元数据（TDK / Open Graph / JSON-LD / 文字版）。
 *
 * ## 为什么必须在这一层做，而不是改模板
 *
 * 本仓三种页面的 HTML 来源完全不同：
 *   - 首页 `src/home/index.html`（自己写）
 *   - 小游戏 `src/templates/page.html`（共用模板 + meta.json 注入）
 *   - 整机 `src/ported/<slug>/` 与 `src/machines/<slug>/` 的 `index.html`（各自带骨架：style + canvas；
 *     `ported` 是上游逐字抽取（禁止手改，会被 sync 覆盖）、`machines` 自维护可手改，但 SEO 都在产出后统一注入）
 *
 * 第三种里 `ported` 的「禁止手改」是硬约束（会被 `npm run sync:upstream` 覆盖），`machines` 虽可手改
 * 但 SEO 同样统一在产出后注入，所以 SEO 只能
 * **产出之后**统一追加。好处顺带把前两种也覆盖了：加新游戏自动有 SEO，不用记着配。
 *
 * ## 时机：必须在 html-webpack-plugin 之后
 *
 * HWP 在 `PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE`(700) 里生成并 minify HTML；
 * 这里挂在 `OPTIMIZE_TRANSFER`(3000)，拿到的是最终 HTML（`<head>` / `</head>` /
 * `</body>` 都已存在，minifier 会把这些可选标签补齐）。
 *
 * 代价：注入的片段**不会被 minify**（带缩进、注释也留着）。这是有意的 ——
 * 产物里那段格式化的注释能让后来的人一眼看出"这段是生成的，别手改产物"，
 * 几百字节换一个不会被误解的产物，划算。
 *
 * ## 站点地址
 *
 * `canonical` / `og:url` / `og:image` / `sitemap.xml` 都需要**绝对 URL**，
 * 而本仓没有域名 → 只读环境变量 `ICE_GAME_SITE_URL`，**没配就省略这几个字段**
 * （绝不编一个假域名，理由见 `scripts/lib/seo.cjs` 顶部）。
 */
class SeoPlugin {
  /**
   * @param {{ pages: any[] }} options 扫目录得到的页面清单（与 entry / HWP 同一份）
   */
  constructor(options) {
    this.pages = options.pages;
  }

  apply(compiler) {
    const { Compilation, sources, WebpackError } = compiler.webpack;

    compiler.hooks.thisCompilation.tap('SeoPlugin', (compilation) => {
      compilation.hooks.processAssets.tap({ name: 'SeoPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER }, () => {
        const siteUrl = normalizeSiteUrl(process.env.ICE_GAME_SITE_URL);
        if (process.env.ICE_GAME_SITE_URL && !siteUrl) {
          compilation.errors.push(
            new WebpackError(
              `ICE_GAME_SITE_URL="${process.env.ICE_GAME_SITE_URL}" 不是合法的 http(s) 地址 —— ` +
                `SEO 的 canonical / og:url / sitemap.xml 需要绝对 URL。已按"未配置"处理（这些字段省略）。`,
            ),
          );
        }

        /**
         * 这个页面用哪张图当分享封面（`og:image` 用）。
         *
         * - 游戏页用它自己的封面（`covers/<slug>.png`，由 `CopyCoversPlugin` 拷进 dist）；
         * - **首页自己没有封面** —— 分享到社交平台时没图会很难看，所以借"站点里第一张有封面的截图"
         *   当站点预览图。语义上说得通（它就是访客进站第一眼看到的东西）。
         *   要更像样的分享卡片，将来可以专门烘一张 1200×630 的图放进来。
         * - 只有这个 asset **真的存在**才引用（`gen-catalog` 的 `cover` 标记保证过，
         *   但这里再确认一次：引一个 404 的图比不引更糟）。
         */
        const pickCover = (page) => {
          const candidates = page ? [page] : this.pages;
          for (const item of candidates) {
            const path = `covers/${item.slug}.png`;
            if (compilation.getAsset(path)) return path;
          }
          return null;
        };

        // ① 每个 HTML 各注入一次
        for (const name of Object.keys(compilation.assets)) {
          if (!name.endsWith('.html')) continue;
          // 首页（`index.html`）在 pages 里找不到 → page = null，走站点级文案
          const page = this.pages.find((item) => item.page === name) || null;
          const html = compilation.getAsset(name).source.source().toString();
          const next = applySeo(html, { page, pages: this.pages, siteUrl, coverUrl: pickCover(page) });
          compilation.updateAsset(name, new sources.RawSource(next));
        }

        // ② 站点级文件
        compilation.emitAsset('robots.txt', new sources.RawSource(buildRobotsTxt(siteUrl)));
        // 真实可抓取的站点图标：页面里内联的 data URI 图标能避免 /favicon.ico 404，
        // 但搜索引擎不认 data URI，必须有一个文件（见 seo.cjs 的 FAVICON_PATH 说明）。
        compilation.emitAsset(FAVICON_PATH, new sources.RawSource(FAVICON_SVG));
        const sitemap = buildSitemapXml({ pages: this.pages, siteUrl });
        if (sitemap) {
          compilation.emitAsset('sitemap.xml', new sources.RawSource(sitemap));
        } else if (compiler.options.mode === 'production') {
          // 不是错误，是"还差一步"。只在 production 提示，免得 dev 每次重建都刷屏。
          console.log(
            '\n  ℹ️  SEO：未配置 ICE_GAME_SITE_URL，已跳过 canonical / og:url / sitemap.xml。\n' +
              '      有对外域名后加一次环境变量即可全部补齐：ICE_GAME_SITE_URL=https://example.com npm run build\n' +
              '      （爬虫发现页面靠的是首页里那些真实链接，这部分不受影响）',
          );
        }
      });
    });
  }
}

/**
 * 归一化站点地址：只接受 `http(s)://host[/path]`，去掉末尾斜杠。
 * 非法输入返回 `null`（调用方按"未配置"处理，而不是拿一个坏地址去拼 URL）。
 */
function normalizeSiteUrl(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!/^https?:\/\/[^\s/]+/i.test(text)) return null;
  return text.replace(/\/+$/, '');
}

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  /**
   * **扫目录得到全部页面** —— 新增游戏不需要改这个文件。
   *
   * 扫描与校验的唯一实现在 `scripts/lib/scan-games.cjs`（`gen-catalog` / `check-games` 共用同一份），
   * 所以"构建收了哪些页面"与"首页列了哪些页面"永远不会各说各话。
   * 元数据非法（slug 不一致、kind 不符、字段缺失…）会在这里**直接抛错**，而不是打包一个坏页面。
   */
  const { items: pages, errors: scanErrors } = scanAll(__dirname);
  if (scanErrors.length) {
    throw new Error(`页面元数据有问题，先修好再构建：\n  - ${scanErrors.join('\n  - ')}`);
  }
  const games = pages.filter((p) => p.partition === 'games');
  // 整机分区（ported = 上游逐字移植的整机，当前无页；machines = 自维护的整机（windows-xp / arcade））都自带
  // index.html 骨架（style + canvas），不套小游戏共用模板，走同一段 HtmlWebpackPlugin 生成。
  const machinePartitions = ['ported', 'machines'];
  const ported = pages.filter((p) => machinePartitions.includes(p.partition));

  return {
    /**
     * **一个页面 = 一个入口 = 一个 HTML**，而不是一个 HTML 里的多个页签。
     *
     * 与 ice-smart-water（单 HTML + 页签）有意不同：那是一个业务系统的多个模块，共用一套
     * 工况 / 筛选状态；这里每个游戏都独占整屏与键盘、彼此零共享状态 ——
     * 硬塞进一个页面，只会让「切页要重建整个游戏」比「开个新页面」更贵。
     *
     * entry 与 HtmlWebpackPlugin 都由上面的扫目录结果生成：
     * - 小游戏（`src/games/*`）→ 共用 `src/templates/page.html`，标题/尺寸/背景由 meta.json 注入
     * - 整机（`src/ported/*` 上游移植 / `src/machines/*` 自维护）→ 用各自的 index.html（自带骨架，不能统一模板）
     */
    entry: {
      home: path.resolve(__dirname, 'src/home/main.ts'),
      ...Object.fromEntries(pages.map((p) => [p.chunk, p.entry])),
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      // 所有 HTML 都落在 dist 根，chunk 也在根 —— `publicPath: ''` 下相对路径全部成立，
      // 换成子目录就要处理 `../`，没有必要。
      publicPath: '',
      filename: isProd ? '[name].[contenthash:8].js' : '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: family,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              // 只转译不做类型检查（类型门禁交给 `npm run types:check`），构建快得多
              loader: 'ts-loader',
              options: { transpileOnly: true },
            },
          ],
        },
      ],
    },
    plugins: [
      // 构建期断言"每个家族包只进来一份产物"（多份引擎 = 组件静默画不出来）
      new SingleEnginePlugin(),
      // 首页卡片封面：原样拷进 dist/covers/（稳定路径，加游戏不用改配置）
      new CopyCoversPlugin(),
      // 游戏厅首页（自己写的骨架）
      new HtmlWebpackPlugin({ template: 'src/home/index.html', filename: 'index.html', chunks: ['home'] }),
      // 自研小游戏：共用模板 + meta.json 注入
      ...games.map(
        (g) =>
          new HtmlWebpackPlugin({
            template: path.resolve(__dirname, 'src/templates/page.html'),
            filename: g.page,
            chunks: [g.chunk],
            templateParameters: {
              title: g.meta.title,
              width: g.meta.width,
              height: g.meta.height,
              background: g.meta.background,
            },
          }),
      ),
      // 整机（ported 上游移植 / machines 自维护）：各自带骨架，不套共用模板
      ...ported.map(
        (p) =>
          new HtmlWebpackPlugin({
            template: path.join(p.dir, 'index.html'),
            filename: p.page,
            chunks: [p.chunk],
          }),
      ),
      /**
       * SEO 注入 —— 放在**最后**（可读性上表示"它作用于上面全部产出的 HTML"）。
       * 真正决定时机的是插件内部的资产阶段（`OPTIMIZE_TRANSFER`），与这里的顺序无关。
       */
      new SeoPlugin({ pages }),
    ],
    devServer: {
      // 8098：家族端口分配见 playwright.config.ts 顶部注释；
      // 本机 8096/8097 被无关常驻服务占着，撞了可以用 ICE_GAME_PORT 覆盖
      port: Number(process.env.ICE_GAME_PORT || 8098),
      open: false,
      hot: false,
      // 每个页面互相独立，没有 history 路由，走默认的静态中间件即可
      historyApiFallback: false,
    },
    optimization: {
      /**
       * **抽一份共享的家族包 chunk**（`family.<hash>.js`），含 ice-render / ice-web-components / ice-chart。
       *
       * 早期这里是 `splitChunks: { chunks: () => false }`，理由写的是"每页独立、抽公共包只会多一次请求"。
       * 但那个理由对 ice-game 不成立：每个页面 ~780KiB 里 **~771KiB 都是家族包**
       * （ice-render 283 + ice-web-components 488），抽成一份共享 chunk 之后：
       *  - 浏览器只下载一次、跨四个页面缓存 → 逛完整个站的总传输从 3.1MiB 降到 ~1.2MiB；
       *  - 单引擎守护不受影响：`splitChunks` 只重排**输出 chunk**、不动**模块图**，
       *    `SingleEnginePlugin` 仍按模块 `resource` 数出每个家族包 1 份（见 family-guard.cjs）；
       *  - GitHub Pages 走 HTTP/2，多一个并行请求的成本可忽略。
       *
       * 这正是 smart-water 单入口天然享有的「共享」，ice-game 多入口需要显式抽出来才能得到。
       * `test` 复用与单引擎守护同一套 `FAMILY_MARKERS`，避免两处各写一份路径正则。
       */
      splitChunks: {
        cacheGroups: {
          family: {
            test: (module) => {
              const r = module.resource;
              if (!r) return false;
              return Object.values(FAMILY_MARKERS).some((markers) =>
                markers.some((marker) => r.includes(marker.slice(0, -1))),
              );
            },
            name: 'family',
            chunks: 'all',
            priority: 20,
          },
        },
      },
      runtimeChunk: false,
    },
    performance: { hints: false },
    devtool: isProd ? false : 'eval-source-map',
  };
};
