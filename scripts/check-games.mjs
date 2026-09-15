#!/usr/bin/env node
/**
 * 一致性门禁：断言「**目录** ↔ **目录生成物** ↔ **构建产物**」三者对齐。
 *
 * 三者本该永远一致，但它们由不同环节产生，各自都可能漏：
 *
 * | 来源 | 怎么来的 | 漏了会怎样 |
 * |---|---|---|
 * | 目录集合 | `src/games/*` + `src/ported/*`（含 meta.json 的） | ——（这是源头） |
 * | 生成物 | `npm run gen:catalog` → `src/domain/catalog.generated.json` | 首页少一张卡片 / 点进去 404 |
 * | 产物 | webpack 扫目录生成的 `dist/<slug>.html` | 玩不到 / 链接失效 |
 *
 * 所以三道断言各抓一类：生成物是否最新（改了 meta 没重新生成）、产物是否齐备
 * （构建没跑到 / 入口名写错）、有没有"登记了但目录不存在"的幽灵条目。
 *
 * 用法：`node scripts/check-games.mjs`（在 `npm run verify` 里，**build 之后**跑）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from './lib/scan-games.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CATALOG_FILE = path.join(ROOT, 'src', 'domain', 'catalog.generated.json');
const DIST_DIR = path.join(ROOT, 'dist');

const problems = [];

/* --------------------------- ① 目录 ↔ 目录生成物 --------------------------- */

const { items, skipped, errors } = scanAll(ROOT);
problems.push(...errors);

const dirSlugs = items.map((item) => item.slug).sort();

let catalogSlugs = [];
if (!fs.existsSync(CATALOG_FILE)) {
  problems.push(`缺少 ${path.relative(ROOT, CATALOG_FILE)}（跑 npm run gen:catalog）`);
} else {
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    catalogSlugs = (Array.isArray(parsed.pages) ? parsed.pages : []).map((page) => page.slug).sort();
  } catch (err) {
    problems.push(`${path.relative(ROOT, CATALOG_FILE)} 不是合法 JSON：${err.message}`);
  }
}

if (catalogSlugs.length) {
  const missing = dirSlugs.filter((slug) => !catalogSlugs.includes(slug));
  const ghost = catalogSlugs.filter((slug) => !dirSlugs.includes(slug));
  if (missing.length) problems.push(`这些目录没被登记进生成物：${missing.join('、')}（跑 npm run gen:catalog）`);
  if (ghost.length) problems.push(`生成物里有幽灵条目（目录已不存在）：${ghost.join('、')}`);
}

/* --------------------------- ② 目录 ↔ 构建产物 --------------------------- */

/** `dist/` 下的页面 slug；dist 不存在时返回 null。 */
function collectDistSlugs() {
  if (!fs.existsSync(DIST_DIR)) return null;
  return fs
    .readdirSync(DIST_DIR)
    .filter((name) => name.endsWith('.html'))
    .map((name) => name.replace(/\.html$/, ''))
    .sort();
}

const distSlugs = collectDistSlugs();

if (distSlugs === null) {
  problems.push('缺少 dist/（先 npm run build；本脚本应当在构建之后跑）');
} else {
  const missing = dirSlugs.filter((slug) => !distSlugs.includes(slug));
  // `index` 是游戏厅首页，不属于任何游戏目录，单独放行
  const extra = distSlugs.filter((slug) => slug !== 'index' && !dirSlugs.includes(slug));
  if (missing.length) problems.push(`这些页面没有构建产物 dist/<slug>.html：${missing.join('、')}`);
  if (extra.length) problems.push(`dist/ 里有不在目录中的页面：${extra.join('、')}（残留的旧产物？）`);
}

/* -------------------------------- 汇总 -------------------------------- */

if (problems.length) {
  console.error('✗ 页面一致性检查未通过：\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n修法：');
  console.error('  · 登记 / 改文案 → 改 src/games/<slug>/meta.json，然后 npm run gen:catalog');
  console.error('  · 产物缺失      → npm run build');
  console.error('  · 新建游戏      → npm run new:game <slug>');
  process.exit(1);
}

console.log('✓ 页面一致性正常');
console.log(`  目录      ${dirSlugs.length} 个：${dirSlugs.join('、')}`);
console.log(`  生成物    ${catalogSlugs.length} 个（与目录一致）`);
console.log(`  构建产物  ${(distSlugs || []).length} 个 html（含首页 index）`);
if (skipped.length) {
  console.log(`\n提醒：下列目录没有 meta.json，未纳入构建（半成品？还是忘了注册？）：`);
  for (const item of skipped) console.log(`  - ${path.relative(ROOT, item.dir)}`);
}
