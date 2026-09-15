#!/usr/bin/env node
/**
 * 家族「接线」门禁 —— 断言三件套（ice-render / ice-web-components / @damoqiongqiu/ice-chart）
 * 在本工程里**真的能一起打包，且每个包只进来一份**。
 *
 * 为什么要有这个脚本，而不是只靠 webpack.config.js 里的 `SingleEnginePlugin`：
 *
 * 插件只在"这个包**被 import 了**"的时候才看得到它。而 `ice-chart` 是给接下来要做的游戏备的
 * 依赖，**当前没有任何页面 import 它** —— 插件的守护对它是**空的**：哪天 alias 或依赖被改坏，
 * 构建照样绿，直到有人开始写第一个用图表的游戏才发现。
 * 这个脚本主动**构造一次真实的打包**（入口 `tests/wiring/family-smoke.ts`，产物丢临时目录，
 * 不进 dist），把所有家族包都拉进模块图，于是插件的断言对每一个包都生效。
 *
 * 三层断言：
 *   1. **静态**：`tsconfig.json` 的 `paths` 覆盖了每个家族依赖，且指向的文件**真的存在**
 *      （写错路径会让 tsc 把所有相关类型静默降级成 `any` —— 比报错更危险）；
 *      以及 `node_modules` 里装的是指向兄弟仓的**软链**（`file:` 依赖），不是 npm 副本。
 *   2. **打包**：以冒烟入口跑一次 webpack，构建必须成功 ——
 *      `SingleEnginePlugin` 在里面守着"每个家族包只一份"。
 *   3. **可读性**：打印每个家族包实际打进来的模块与产物体积，
 *      多一份引擎会让体积肉眼可见地涨（实测：正常 1008 KiB，多两份引擎 1.49 MiB）。
 *
 * 用法：`node scripts/check-wiring.cjs`（或 `npm run check:wiring`）。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const { buildMarkers, collectCopies, findDuplicates } = require('./lib/family-guard.cjs');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

/**
 * 读 JSONC（本仓的 `tsconfig.json` 带注释，`require` 会直接抛 SyntaxError）。
 * 用**扫描器**而不是正则：正则会把字符串里的 `//`（比如路径）误当注释切掉。
 */
function readJsonc(file) {
  const src = fs.readFileSync(file, 'utf8');
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 1;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  // 去掉对象/数组结尾的多余逗号（tsconfig 里很常见）
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** 家族包：按命名约定从 dependencies 里挑（与 webpack.config.js 同一口径）。 */
const FAMILY = Object.keys(pkg.dependencies || {}).filter(
  (name) => name.startsWith('ice-') || name.startsWith('@damoqiongqiu/'),
);

const problems = [];

/* ------------------------ ⓪ 判据自测（喂合成路径，锁死两个坑） ------------------------ */

/**
 * 判据本身必须有回归测试 —— 判据写错的症状是"永远返回 0 重复"（构建全绿、画面空白），
 * 只有正反用例都在，才能证明它既敏感又不误报。
 *
 * 三个用例各自锁一条**实测踩过/实测确认**的口径（详见 `scripts/lib/family-guard.cjs` 文件头）：
 *  A  多份引擎的真实路径形状（workspace 目录本身就叫 `ice-render`）
 *  B  带 scope 的包：alias 进来的那份 + 嵌套的另一份（只按包名匹配会漏）
 *  A' 祖先目录里也出现 `<pkg>/dist/` → 只有 lastIndexOf 能取对内层（这条才真正区分 indexOf）
 *  C  干净路径 → 一个重复都不该报（防误报）
 */
function selfTestFamilyGuard() {
  const family = {
    'ice-render': '/w/ice-render/ice-render',
    'ice-web-components': '/w/ice-render/ice-web-components',
    '@damoqiongqiu/ice-chart': '/w/ice-render/ice-chart',
  };
  const markers = buildMarkers(Object.keys(family), family);
  const failures = [];
  const check = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(got)}`);
    }
  };

  // 用例 A：一份正常 + 两份嵌套副本 —— 这正是"少配 alias"时产物里的真实形状。
  // 注意 workspace 目录本身也叫 `ice-render`（与真实工程一致）。
  const caseA = [
    { resource: '/w/ice-render/ice-game/src/home/main.ts' },
    { resource: '/w/ice-render/ice-render/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-web-components/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-chart/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-chart/node_modules/ice-render/dist/index.cjs' },
    { resource: '/w/ice-render/ice-web-components/node_modules/ice-render/dist/index.cjs' },
  ];
  const a = collectCopies(caseA, markers);
  check('[自测A] ice-render 应数出 3 份', a.get('ice-render').size, 3);
  check('[自测A] ice-web-components 应为 1 份', a.get('ice-web-components').size, 1);
  check('[自测A] @damoqiongqiu/ice-chart 应为 1 份', a.get('@damoqiongqiu/ice-chart').size, 1);
  check(
    '[自测A] 应报出 1 个重复包（ice-render）',
    findDuplicates(a).map((d) => d.name),
    ['ice-render'],
  );

  // 用例 B：带 scope 的包同时存在"alias 进来的那份"与"嵌套的另一份"。
  // 只按包名（/@damoqiongqiu/ice-chart/dist/）匹配时看不到 alias 那份 → 会漏判成 1 份。
  const caseB = [
    { resource: '/w/ice-render/ice-render/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-chart/dist/index.umd.js' },
    { resource: '/w/ice-render/node_modules/@damoqiongqiu/ice-chart/dist/index.umd.js' },
  ];
  const b = collectCopies(caseB, markers);
  check('[自测B] 带 scope 的包应数出 2 份（只按包名匹配会错数成 1）', b.get('@damoqiongqiu/ice-chart').size, 2);
  check(
    '[自测B] 应报出 @damoqiongqiu/ice-chart 重复',
    findDuplicates(b).map((d) => d.name),
    ['@damoqiongqiu/ice-chart'],
  );

  // 用例 A'：祖先目录里也出现 `ice-render/dist/` —— 这条才真正区分 indexOf 与 lastIndexOf。
  // indexOf 取到外层 `/a/ice-render/dist`（不是包目录），两份内层副本会被折叠成同一份 → 漏判。
  const caseAp = [
    { resource: '/a/ice-render/dist/lib/node_modules/ice-render/dist/index.cjs' },
    { resource: '/a/ice-render/dist/lib/nested/node_modules/ice-render/dist/index.cjs' },
  ];
  const ap = collectCopies(caseAp, markers);
  check('[自测A\u2032] 祖先目录同名时仍应数出 2 份（indexOf 会错数成 1）', ap.get('ice-render').size, 2);

  // 用例 C：全是干净路径 → 一个重复都不该报（防误报）
  const caseC = [
    { resource: '/w/ice-render/ice-render/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-web-components/dist/index.umd.js' },
    { resource: '/w/ice-render/ice-chart/dist/index.umd.js' },
    { resource: undefined },
  ];
  check('[自测C] 干净路径不该报重复', findDuplicates(collectCopies(caseC, markers)), []);

  return failures;
}

problems.push(...selfTestFamilyGuard().map((f) => `判据自测失败：${f}`));

/* ---------------------------- ① 静态：tsconfig paths ---------------------------- */

const tsconfig = readJsonc(path.join(ROOT, 'tsconfig.json'));
const paths = (tsconfig.compilerOptions && tsconfig.compilerOptions.paths) || {};
const baseUrl = (tsconfig.compilerOptions && tsconfig.compilerOptions.baseUrl) || '.';

for (const name of FAMILY) {
  const entry = paths[name];
  if (!entry || !entry.length) {
    problems.push(`tsconfig.json 的 paths 缺 ${name} —— tsc 会解析出两份 .d.ts（名义类型不兼容）`);
    continue;
  }
  const target = path.resolve(ROOT, baseUrl, entry[0]);
  if (!fs.existsSync(target)) {
    // 这个是最阴的失败：路径写错 → tsc 把相关类型全当 any → 门禁静默失效
    problems.push(`tsconfig.json 的 paths["${name}"] 指向不存在的文件：${target}（类型会静默退化成 any）`);
  }
}

/* ------------------- ① 静态：node_modules 必须是指向兄弟仓的软链 ------------------- */

for (const name of FAMILY) {
  const installed = path.join(ROOT, 'node_modules', name);
  if (!fs.existsSync(installed)) {
    problems.push(`node_modules/${name} 不存在 —— 先跑 npm install`);
    continue;
  }
  if (!fs.lstatSync(installed).isSymbolicLink()) {
    problems.push(
      `node_modules/${name} 不是软链 —— package.json 里的依赖应写成 "file:../<repo>"，` +
        `否则拿到的是 npm 上的另一份副本，改兄弟仓源码不会生效`,
    );
  }
}

/* ------------------------- ②③ 打包：以冒烟入口真跑一次 ------------------------- */

/** 复用主配置（因此 alias 与 SingleEnginePlugin 都是真的那一套），只换入口与产物位置。 */
function smokeConfig() {
  const base = require(path.join(ROOT, 'webpack.config.js'));
  const cfg = base({}, { mode: 'production' });
  cfg.entry = { 'family-smoke': path.join(ROOT, 'tests/wiring/family-smoke.ts') };
  cfg.plugins = cfg.plugins.filter((p) => p.constructor.name !== 'HtmlWebpackPlugin');
  cfg.output = {
    path: path.join(os.tmpdir(), 'ice-game-wiring'),
    // 必须用 [name] 模板：主配置现在会抽一份 `family` 共享 chunk，冒烟打包会有
    // `family-smoke` 入口 chunk + `family` 共享 chunk 两个产物；写死成同一个固定名
    // 会让两个 chunk 抢同一个文件名而冲突（以前 splitChunks 关闭时只有一个 chunk 才没问题）。
    filename: '[name].js',
    publicPath: '',
    clean: true,
  };
  return cfg;
}

function runWebpack() {
  return new Promise((resolve) => {
    webpack(smokeConfig(), (err, stats) => {
      if (err) return resolve({ ok: false, message: String(err && err.stack ? err.stack : err) });
      const info = stats.toJson({ all: false, errors: true, assets: true });
      if (stats.hasErrors()) {
        return resolve({ ok: false, message: (info.errors || []).map((e) => e.message || String(e)).join('\n\n') });
      }
      // 模块清单直接读插件挂在 compilation 上的结果 —— 判据只有一份实现
      // （`scripts/lib/family-guard.cjs`），脚本不自己再数一遍，免得两处各错一种。
      const copies = stats.compilation.__iceFamilyCopies;
      resolve({
        ok: true,
        copies: copies ? Object.fromEntries([...copies].map(([k, v]) => [k, [...v]])) : {},
        assets: (info.assets || []).map((a) => ({ name: a.name, size: a.size })),
      });
    });
  });
}

(async () => {
  const res = await runWebpack();
  if (!res.ok) {
    problems.push(`接线冒烟打包失败（编译错误或 SingleEnginePlugin 判定重复）：\n${res.message}`);
  }
  if (res.ok) {
    // 二次确认：脚本自己也对"份数"表态（插件那层若被误删，这里仍然会红）
    for (const [name, dirs] of Object.entries(res.copies)) {
      if (dirs.length !== 1) {
        problems.push(`${name} 打进 ${dirs.length} 份：\n${dirs.map((d) => `      - ${d}`).join('\n')}`);
      }
    }
  }

  if (problems.length) {
    console.error('✗ 家族接线检查未通过：\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\n修法见 webpack.config.js 顶部注释与 AGENTS.md「铁律 2」。');
    process.exit(1);
  }

  console.log('✓ 家族接线正常');
  console.log(`  依赖 ${FAMILY.length} 个 : ${FAMILY.join(' / ')}`);
  console.log(`  tsconfig paths : ${FAMILY.map((n) => paths[n][0]).join(' / ')}`);
  console.log(`  node_modules   : ${FAMILY.length}/${FAMILY.length} 为软链`);
  console.log('  每个家族包打进产物的份数（应各为 1）:');
  for (const name of FAMILY) {
    const dirs = res.copies[name] || [];
    console.log(`    ${name} × ${dirs.length}${dirs[0] ? `  ← ${path.relative(path.resolve(ROOT, '..'), dirs[0])}` : ''}`);
  }
  for (const a of res.assets) console.log(`  产物 ${a.name}: ${(a.size / 1024).toFixed(0)} KiB`);
})();
