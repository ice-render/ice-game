#!/usr/bin/env node
/**
 * 从上游 `ice-web-components/examples/` 抽取游戏页，生成三个 webpack 入口里的两个游戏入口。
 *
 * 为什么要有这个脚本，而不是手工拷一遍了事：
 * 拷贝之后两个工程就分叉了 —— 上游修了 `arcade.html` 的 bug，ice-game 不会自动拿到。
 * 有了它，「跟随上游」是一条命令（`npm run sync:upstream`）而不是一次人工比对。
 * 抽取口径保证**逐字**（除了下面写明的两处增补），所以生成物与上游页在同一版引擎下渲染结果一致。
 *
 * 每个页面对应的抽取规则（两个上游页结构一样，都是单文件 + 一个大内联 script）：
 *
 *   <!DOCTYPE html>
 *   <html lang="zh-CN">
 *     <meta charset="utf-8" />
 *     <title>…</title>
 *     <style>…</style>          ← 原样进 index.html
 *     <body>
 *       <canvas …></canvas>     ← 原样进 index.html
 *       <script src="…umd.js">  ← 丢掉（改由 main.ts 引模块）
 *       <script src="…umd.js">  ← 丢掉
 *       <script>…</script>      ← 正文逐字进 main.ts
 *     </body>
 *   </html>
 *
 * 生成物里**唯一**的增补是往 head 里插一行内联 data-URI favicon：不给 favicon 时浏览器会
 * 请求 `/favicon.ico` 吃一个 404，控制台多一条 error，「全程 console error 为 0」的 e2e 直接挂。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UPSTREAM_DIR = path.resolve(ROOT, '..', 'ice-web-components', 'examples');

/**
 * 一个卡带/一台机器 = 一个入口。`source` 是上游文件名，`name` 是本仓目录名（也是 chunk 名）。
 *
 * 全部落在 `src/ported/`（**上游移植分区**）—— 与 `src/games/`（自研小游戏）物理隔离：
 * 这边的产物禁止手改，那边的目录就是要改的。混在一起只靠文档约束，迟早有人改错地方。
 */
const PARTITION = 'ported';
const PAGES = [
  {
    name: 'arcade',
    source: 'arcade.html',
    meta: {
      title: 'ICE Arcade 掌机',
      tagline: '一台掌机，四张卡带 —— 开机先跑 BIOS 自检再选卡带',
      accent: '#0d6efd',
      features: ['俄罗斯方块', '贪吃蛇', '2048', 'CHIP-8'],
      controls: [
        ['方向键', '移动 / 旋转'],
        ['空格', '硬降 / 暂停'],
        ['P · R · L', '暂停 · 重开 · 排行榜'],
        ['F2', '回到 BIOS 菜单'],
      ],
    },
  },
  {
    name: 'windows-xp',
    source: 'windows-xp.html',
    meta: {
      title: 'Windows XP 桌面',
      tagline: '会自己开机的画布桌面：开机自检 → 欢迎屏 → 桌面',
      accent: '#245edb',
      features: ['扫雷', 'ICE Arcade', '记事本', '画图', '我的电脑', '我的文档', 'Internet Explorer', '显示属性'],
      controls: [
        ['双击图标', '打开程序'],
        ['拖标题栏', '移动窗口'],
        ['开始菜单', '注销 / 关机'],
        ['右键雷区', '插旗 / 问号'],
      ],
    },
  },
];

/** 品牌色 `#0d6efd` 的播放键，够小、无外部请求。 */
const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect width='32' height='32' rx='7' fill='%230d6efd'/>" +
  "<path d='M12 9l12 7-12 7z' fill='%23ffffff'/></svg>";

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);

/**
 * 把上游单文件页切成 `{ head, body }`。
 * `head` = 第一个 `<script src=` 之前的一切（含 DOCTYPE / style / canvas），去掉尾部空行；
 * `body` = 开头/结尾两个**独占一行**的 `<script>` / `</script>` 之间的正文（含原始缩进与空行）。
 *
 * ⚠️ 定位脚本标签必须按行匹配，不能按字符串找：`windows-xp.html` 的代码注释里出现了字面量
 * `<script>`（"避免把 <style>/<script>/导航噪声都塞进来"），`lastIndexOf('<script>')` 会命中
 * 注释里的那一个，然后从注释处开始截 —— 抽出来的正文少了一大半，而且不报错。
 */
function extract(html, source) {
  const headEnd = html.indexOf('<script src=');
  if (headEnd === -1) {
    throw new Error(`${source}: 没找到 <script src=，上游页结构变了，本脚本的抽取规则需要跟着改`);
  }
  const head = html.slice(0, headEnd).replace(/\s+$/, '');

  const lines = html.split('\n');
  const openIdx = lines.findIndex((line) => line.trim() === '<script>');
  // 反向找最后一个「独占一行的 </script>」
  let closeIdx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '</script>') {
      closeIdx = i;
      break;
    }
  }
  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    throw new Error(`${source}: 没找到独占一行的内联 <script>…</script> 正文`);
  }

  /** 第 i 行首字符在整个文本里的偏移：前面各行的长度 + 同样数量的换行。 */
  const offsetOfLine = (i) => {
    let n = i;
    for (let k = 0; k < i; k += 1) n += lines[k].length;
    return n;
  };
  const bodyStart = offsetOfLine(openIdx) + lines[openIdx].indexOf('<script>') + '<script>'.length;
  const bodyEnd = offsetOfLine(closeIdx) + lines[closeIdx].indexOf('</script>');
  const body = html.slice(bodyStart, bodyEnd);

  // 逐字自校验：抽出来的正文必须原封不动地存在于上游文件里（差一个字符就说明抽取口径错了）
  if (!html.includes(body)) {
    throw new Error(`${source}: 抽取出的正文不是上游文件的子串，抽取口径有 bug`);
  }
  if (body.trim().length < 500 || !body.includes('ICE')) {
    throw new Error(`${source}: 正文只有 ${body.trim().length} 字节 / 不含 ICE，明显抽错了`);
  }
  return { head, body };
}

/** 生成 `index.html`：上游 head 原样 + 一行 favicon + 入口注释。 */
function renderHtml(head, source) {
  const withFavicon = head.replace(/(\n\s*<title>.*<\/title>)/, `$1\n  <link rel="icon" href="${FAVICON}" />`);
  if (withFavicon === head) {
    throw new Error(`${source}: head 里没找到 <title>，favicon 注入失败`);
  }
  return (
    `${withFavicon}\n\n` +
    '    <!--\n' +
    `      入口脚本由 html-webpack-plugin 注入。上游页在这里的两行\n` +
    '        <script src="../node_modules/ice-render/dist/index.umd.js"></script>\n' +
    '        <script src="../dist/index.umd.js"></script>\n' +
    '      在本工程里不再需要：引擎与组件库改由 main.ts 从 node_modules 引，\n' +
    '      webpack 的 resolve.alias 保证全工程只有一份 ice-render（见 webpack.config.js）。\n' +
    '      本文件与 main.ts 都由 scripts/sync-upstream.mjs 生成，改玩法请改上游页。\n' +
    '    -->\n' +
    '  </body>\n' +
    '</html>\n'
  );
}

/** 生成 `main.ts`：两行 import + 上游正文逐字。 */
function renderTs(body, source) {
  return (
    '// @ts-nocheck\n' +
    '/**\n' +
    ' * ⚠️ 生成物，禁止手改：正文由 `scripts/sync-upstream.mjs` 从\n' +
    ` *    \`../ice-web-components/examples/${source}\` 的内联 <script> 正文**逐字**抽取。\n` +
    ' *    要改玩法请改上游页，然后 `npm run sync:upstream`。\n' +
    ' *\n' +
    ' * 与上游页的唯一差异 = 下面两行 import：上游靠 <script src="…umd.js"> 把 `ICE` / `ICEWEB`\n' +
    ' * 挂在 window 上，这里改成模块引入 —— `import * as` 拿到的命名空间对象与 UMD 全局**形状一致**\n' +
    ' * （`ICE.ICE`、`ICE.ICEBoxLayout`、`ICEWEB.ICEPanel` 照旧），所以正文一字不用改。\n' +
    ' *\n' +
    ' * 类型检查用 `@ts-nocheck` 关掉：这是上游的 JS 正文，"保持逐字"比"通过 strict 检查"重要。\n' +
    ' * 本仓的类型门禁落在 `src/domain`（纯逻辑）与 `src/home`（自己写的画布首页）上。\n' +
    ' */\n' +
    "import * as ICE from 'ice-render';\n" +
    "import * as ICEWEB from 'ice-web-components';\n" +
    body
  );
}

function main() {
  const rows = [];
  for (const page of PAGES) {
    const from = path.join(UPSTREAM_DIR, page.source);
    if (!fs.existsSync(from)) {
      throw new Error(`上游页面不存在：${from}`);
    }
    const { head, body } = extract(fs.readFileSync(from, 'utf8'), page.source);

    const outDir = path.join(ROOT, 'src', PARTITION, page.name);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(head, page.source), 'utf8');
    fs.writeFileSync(path.join(outDir, 'main.ts'), renderTs(body, page.source), 'utf8');

    // 目录元数据：**只在缺失时创建**，之后永不覆盖 —— 否则每次同步都会把手写的
    // tagline / controls 冲掉。文案改动直接编辑 `meta.json`（它不属于"上游生成物"）。
    const metaPath = path.join(outDir, 'meta.json');
    const metaCreated = !fs.existsSync(metaPath);
    if (metaCreated) {
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            slug: page.name,
            kind: 'machine', // machine = 上游移植的整机；game = 自研小游戏
            title: page.meta.title,
            tagline: page.meta.tagline,
            accent: page.meta.accent,
            features: page.meta.features,
            controls: page.meta.controls,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    }

    rows.push({
      page: page.name,
      source: page.source,
      metaCreated,
      // 上游正文行数 / 字节 / 指纹：下次同步时对一眼就知道上游动没动
      lines: body.split('\n').length - 1,
      bytes: Buffer.byteLength(body, 'utf8'),
      digest: sha256(body),
    });
  }

  const width = Math.max(...rows.map((r) => r.page.length));
  console.log('sync-upstream：从 ice-web-components/examples 抽取完成');
  for (const r of rows) {
    console.log(
      `  ${r.page.padEnd(width)}  ← ${r.source.padEnd(16)} ${String(r.lines).padStart(4)} 行 / ` +
        `${String(r.bytes).padStart(6)} 字节 / sha256:${r.digest}`,
    );
  }
  console.log(`\n生成物：src/${PARTITION}/<name>/{index.html,main.ts}（正文逐字，勿手改）`);
  if (rows.some((r) => r.metaCreated)) {
    console.log(`meta.json 已为首次出现的页面创建（之后不会被覆盖，文案直接改它）`);
  }
}

main();
